import pytest

from plano3d.domain import BuildingModel, Project, ProjectStatus, Scale
from plano3d.domain.errors import DomainError, InvalidStateTransitionError


def project() -> Project:
    return Project.create("  Casa  ", "originals/x.jpg", project_id="p1")


def test_create_trims_name_and_starts_pending() -> None:
    p = project()
    assert p.name == "Casa" and p.status is ProjectStatus.PENDING


@pytest.mark.parametrize("name", ["", "   "])
def test_create_requires_name(name: str) -> None:
    with pytest.raises(DomainError):
        Project.create(name, "k")


def test_create_requires_four_corners() -> None:
    with pytest.raises(DomainError):
        Project.create("x", "k", corners=[(0, 0), (1, 0), (1, 1)])


def test_happy_path() -> None:
    p = project()
    p.start_processing()
    p.complete(BuildingModel(project_id="p1", scale=Scale(0.01)))
    assert p.status is ProjectStatus.READY and p.model is not None


def test_cannot_complete_without_processing() -> None:
    with pytest.raises(InvalidStateTransitionError):
        project().complete(BuildingModel(project_id="p1", scale=Scale(0.01)))


def test_model_must_belong_to_project() -> None:
    p = project()
    p.start_processing()
    with pytest.raises(DomainError):
        p.complete(BuildingModel(project_id="other", scale=Scale(0.01)))


def test_fail_then_retry_clears_error() -> None:
    p = project()
    p.start_processing()
    p.fail("boom")
    assert p.status is ProjectStatus.FAILED and p.error == "boom"
    p.start_processing()
    assert p.error is None


def test_update_model_only_when_ready() -> None:
    p = project()
    m = BuildingModel(project_id="p1", scale=Scale(0.01))
    with pytest.raises(InvalidStateTransitionError):
        p.update_model(m)
    p.start_processing()
    p.complete(m)
    p.update_model(m.recalibrated(0.02))
    assert p.model is not None and p.model.scale.meters_per_pixel == 0.02
    with pytest.raises(DomainError):
        p.update_model(BuildingModel(project_id="x", scale=Scale(0.01)))
