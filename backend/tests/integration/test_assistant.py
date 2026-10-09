"""Chat del editor: el respaldo con IA devuelve operaciones válidas o un 503 claro."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from plano3d.api.app import create_app
from plano3d.application.ports import AssistantReply, PlanAssistant
from plano3d.config import Settings
from plano3d.container import memory_container
from plano3d.infrastructure.assistant.claude_assistant import ClaudePlanAssistant, to_plan_op
from plano3d.infrastructure.ocr.budget import ClaudeBudget, ResponseCache


class FakeAssistant(PlanAssistant):
    def __init__(self) -> None:
        self.seen: list[tuple[str, str]] = []

    async def interpret(self, message: str, context: str) -> AssistantReply:
        self.seen.append((message, context))
        return AssistantReply(
            [{"op": "add_room", "name": "Sala", "width": 4.0, "depth": 5.0}], "Listo"
        )


def _client(assistant: PlanAssistant | None) -> TestClient:
    c = memory_container()
    c.assistant = assistant
    return TestClient(create_app(Settings(mode="memory"), container=c))


def test_assistant_endpoint_returns_ops() -> None:
    fake = FakeAssistant()
    with _client(fake) as client:
        pid = client.post("/api/projects/blank", json={"name": "Chat"}).json()["id"]
        r = client.post(
            f"/api/projects/{pid}/assistant",
            json={"message": "quiero una sala grande", "context": "(vacío)"},
        )
        assert r.status_code == 200, r.text
        assert r.json() == {
            "ops": [{"op": "add_room", "name": "Sala", "width": 4.0, "depth": 5.0}],
            "reply": "Listo",
        }
        assert fake.seen == [("quiero una sala grande", "(vacío)")]


def test_without_assistant_is_503_and_unknown_project_is_404() -> None:
    with _client(None) as client:
        pid = client.post("/api/projects/blank", json={}).json()["id"]
        r = client.post(f"/api/projects/{pid}/assistant", json={"message": "hola"})
        assert r.status_code == 503
        assert "no está disponible" in r.json()["detail"]
    with _client(FakeAssistant()) as client:
        assert client.post("/api/projects/nada/assistant", json={"message": "x"}).status_code == 404


def test_to_plan_op_normalizes_flat_rows() -> None:
    nulls: dict[str, Any] = dict.fromkeys(
        ["name", "width", "depth", "next_room", "next_side", "kind", "room", "side"], None
    ) | dict.fromkeys(["between", "from_side", "to_side", "to_room", "item"], None)
    room = nulls | {"op": "add_room", "name": "Cocina", "width": 3, "depth": 3}
    room |= {"next_room": "Sala", "next_side": "este"}
    assert to_plan_op(room) == {
        "op": "add_room",
        "name": "Cocina",
        "width": 3.0,
        "depth": 3.0,
        "next_to": {"room": "Sala", "side": "este"},
    }
    door = nulls | {"op": "add_opening", "kind": "door", "room": "Sala", "between": "Cocina"}
    assert to_plan_op(door) == {
        "op": "add_opening",
        "kind": "door",
        "room": "Sala",
        "between": "Cocina",
    }
    assert to_plan_op(nulls | {"op": "add_room", "name": "x"}) is None  # sin medidas
    assert to_plan_op(nulls | {"op": "explotar"}) is None


class _FakeMessages:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls = 0

    def create(self, **kwargs: Any) -> Any:
        self.calls += 1
        assert kwargs["output_config"]["format"]["type"] == "json_schema"
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=json.dumps(self.payload))],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=500, output_tokens=100),
        )


def test_claude_adapter_parses_caches_and_records_spend(tmp_path: Path) -> None:
    row = dict.fromkeys(
        ["name", "width", "depth", "next_room", "next_side", "kind", "room", "side"], None
    ) | dict.fromkeys(["between", "from_side", "to_side", "to_room", "item"], None)
    payload = {
        "ops": [row | {"op": "rename_room", "room": "Sala", "name": "Estar"}],
        "reply": "Renombré la sala.",
    }
    messages = _FakeMessages(payload)
    budget = ClaudeBudget(tmp_path / "usage.json", limit_usd=1.0)
    bot = ClaudePlanAssistant(
        client=SimpleNamespace(messages=messages),
        budget=budget,
        cache=ResponseCache(tmp_path / "c"),
    )
    import asyncio

    r = asyncio.run(bot.interpret("ponle Estar a la sala", "Sala: 4x5"))
    assert r.ops == [{"op": "rename_room", "room": "Sala", "name": "Estar"}]
    assert r.reply == "Renombré la sala."
    assert budget.spent > 0
    asyncio.run(bot.interpret("ponle Estar a la sala", "Sala: 4x5"))
    assert messages.calls == 1  # la segunda vez sale de la caché


def test_claude_adapter_respects_budget(tmp_path: Path) -> None:
    from plano3d.application.use_cases.errors import AssistantUnavailableError

    bot = ClaudePlanAssistant(
        client=SimpleNamespace(messages=_FakeMessages({"ops": [], "reply": ""})),
        budget=ClaudeBudget(tmp_path / "usage.json", limit_usd=0.0),
        cache=ResponseCache(tmp_path / "c"),
    )
    import asyncio

    with pytest.raises(AssistantUnavailableError):
        asyncio.run(bot.interpret("algo", ""))
