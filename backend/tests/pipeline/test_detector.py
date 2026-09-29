"""La estrategia ClassicCVDetector completa, con su secuencia de eventos de progreso."""

from __future__ import annotations

import pytest

from plano3d.application.dto import ProgressEventDTO
from plano3d.application.pipeline import Pipeline, PipelineStage, StageFailedError
from plano3d.application.ports import DetectionRequest, ImageQuality, ProgressPublisher
from plano3d.infrastructure.cv.classic_cv_detector import ClassicCVDetector, default_stages
from plano3d.infrastructure.cv.imageio import OpenCVImageInspector
from tests.synth.plan_generator import encode, l_house, photograph, render


class Recorder(ProgressPublisher):
    def __init__(self) -> None:
        self.events: list[ProgressEventDTO] = []

    async def publish(self, event: ProgressEventDTO) -> None:
        self.events.append(event)


async def test_detect_emits_ordered_progress_and_valid_model() -> None:
    photo = photograph(render(l_house()), seed=4)
    rec = Recorder()
    result = await ClassicCVDetector().detect(
        DetectionRequest("p1", encode(photo.image, ".jpg"), "image/jpeg"), rec
    )
    keys = [s.key for s in default_stages()]
    assert [e.stage for e in rec.events if e.status == "started"] == keys
    assert [e.stage for e in rec.events if e.status == "completed"] == keys
    assert all(e.elapsed_ms is not None for e in rec.events if e.status == "completed")
    previews = [e.stage for e in rec.events if e.preview is not None]
    assert previews == ["topology", "rooms"]

    lv = result.model.levels[0]
    assert len(lv.rooms) == 4
    assert result.model.scale.source == "estimated"
    assert result.rectified_png.startswith(b"\x89PNG")
    assert result.model.source_image is not None


def test_classic_cv_rejects_tiny_images() -> None:
    assert not ClassicCVDetector().supports(ImageQuality(100, 100, 1, 1))
    assert ClassicCVDetector().supports(ImageQuality(800, 600, 1, 1))


def test_inspector_measures_quality() -> None:
    q = OpenCVImageInspector().inspect(encode(render(l_house()).image), "image/png")
    assert q.width > 200 and q.sharpness > 0 and q.contrast > 0


class _Boom(PipelineStage[dict]):  # type: ignore[type-arg]
    key = "boom"
    title = "Falla"

    def run(self, ctx: dict) -> dict:  # type: ignore[type-arg]
        raise ValueError("kaput")


async def test_pipeline_wraps_stage_errors() -> None:
    rec = Recorder()
    with pytest.raises(StageFailedError) as info:
        await Pipeline([_Boom()]).run({}, "p", rec)
    assert info.value.stage == "boom"
    assert [e.status for e in rec.events] == ["started", "failed"]


def test_pipeline_validates_stages() -> None:
    with pytest.raises(ValueError):
        Pipeline([])
    with pytest.raises(ValueError):
        Pipeline([_Boom(), _Boom()])
