"""Pruebas de cada etapa del pipeline contra la verdad de terreno sintética."""

from __future__ import annotations

import math

import cv2
import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from plano3d.infrastructure.cv.context import CVContext, PxOpening, Segment
from plano3d.infrastructure.cv.imageio import ImageDecodeError, decode
from plano3d.infrastructure.cv.stages.openings import classify_gap, merge_openings
from plano3d.infrastructure.cv.stages.preprocess import (
    binarize,
    dominant_skew,
    normalize_illumination,
    rotate,
)
from plano3d.infrastructure.cv.stages.rectify import RectifyStage, find_paper_quad, order_corners
from plano3d.infrastructure.cv.stages.scale import estimate_scale
from plano3d.infrastructure.cv.stages.topology import dangling_endpoints, snap_endpoints
from plano3d.infrastructure.cv.stages.walls import estimate_stroke_thickness
from tests.pipeline.conftest import PHOTO_SEEDS, Case, photo_case
from tests.synth.plan_generator import apartment, encode, mask_iou, photograph, polygon_iou, render

# ----------------------------------------------------------------------------- ingest


def test_decode_rejects_garbage() -> None:
    with pytest.raises(ImageDecodeError):
        decode(b"not an image", "image/png")


def test_decode_downscales_huge_images() -> None:
    big = np.full((3000, 5000, 3), 255, np.uint8)
    img = decode(encode(big), "image/png", max_side=1000)
    assert max(img.shape[:2]) == 1000


def test_decode_pdf() -> None:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(render(apartment()).image).save(buf, format="PDF")
    img = decode(buf.getvalue(), "application/pdf")
    assert img.ndim == 3 and min(img.shape[:2]) > 200


# ----------------------------------------------------------------------------- rectify


@given(st.permutations(range(4)))
def test_order_corners_is_permutation_invariant(perm: list[int]) -> None:
    quad = np.array([[10, 12], [200, 5], [210, 150], [3, 160]], np.float64)
    assert np.allclose(order_corners(quad[perm]), quad)


@pytest.mark.parametrize("seed", PHOTO_SEEDS)
def test_paper_corners_found_in_photo(seed: int) -> None:
    photo = photograph(render(apartment()), seed=seed)
    quad = find_paper_quad(photo.image)
    assert quad is not None
    diag = math.hypot(*photo.image.shape[:2])
    err = np.linalg.norm(quad - photo.corners, axis=1).max()
    assert err < 0.01 * diag, f"error de esquina {err:.1f}px"


def test_clean_scan_is_not_warped() -> None:
    img = render(apartment()).image
    assert find_paper_quad(img) is None


def test_user_corners_override_detection() -> None:
    photo = photograph(render(apartment()), seed=1)
    h, w = photo.image.shape[:2]
    corners = [(float(x / w), float(y / h)) for x, y in photo.corners]
    ctx = CVContext("p", b"", "image/jpeg", corners=corners)
    ctx.original = photo.image
    ctx = RectifyStage().run(ctx)
    assert ctx.paper_detected
    ph, _pw = photo.paper_size
    assert ctx.rectified is not None
    assert abs(ctx.rectified.shape[1] - ph) / ph < 0.15


# ----------------------------------------------------------------------------- preprocess


def test_illumination_normalization_flattens_shadows() -> None:
    gray = np.full((300, 400), 230, np.float64)
    gray *= np.linspace(0.55, 1.0, 400)[None, :]  # sombra lateral fuerte
    norm = normalize_illumination(gray.astype(np.uint8))
    assert norm[:, 20:-20].std() < 6


def test_binarize_marks_ink(clean: Case) -> None:
    gray = cv2.cvtColor(clean.rendered.image, cv2.COLOR_BGR2GRAY)
    ink = binarize(normalize_illumination(gray))
    # todo muro de la verdad de terreno debe ser tinta
    walls = clean.rendered.wall_mask > 0
    assert (ink[walls] > 0).mean() > 0.97


@pytest.mark.parametrize("angle", [-4.0, -1.5, 2.0, 5.0])
def test_dominant_skew_detects_rotation(angle: float) -> None:
    gray = cv2.cvtColor(render(apartment()).image, cv2.COLOR_BGR2GRAY)
    ink = binarize(normalize_illumination(gray))
    rotated = rotate(ink, angle, border=0)
    assert dominant_skew(rotated) == pytest.approx(-angle, abs=0.5)


# ----------------------------------------------------------------------------- walls


def test_wall_thickness_estimate(case: Case) -> None:
    ctx = case.run(until="walls")
    true_px = 0.2 * case.rendered.px_per_m
    if case.photo is not None:  # la foto cambia la resolución
        true_px *= abs(np.linalg.det(case.to_rectified[:2, :2])) ** 0.5
    assert ctx.wall_thickness_px == pytest.approx(true_px, rel=0.3)


def test_wall_mask_iou(case: Case) -> None:
    ctx = case.run(until="walls")
    assert ctx.wall_mask is not None
    gt = case.gt_mask(case.rendered.wall_mask, ctx.wall_mask.shape)
    iou = mask_iou(ctx.wall_mask, gt)
    assert iou >= (0.85 if case.photo is None else 0.75), f"IoU muros {iou:.3f}"


def test_text_and_arcs_are_not_walls(clean: Case) -> None:
    ctx = clean.run(until="walls")
    assert ctx.wall_mask is not None and ctx.ink is not None
    # tolerancia de 3 px: el antialiasing engorda el borde del muro, eso no es un falso muro
    near_wall = cv2.dilate(clean.rendered.wall_mask, np.ones((7, 7), np.uint8))
    false_walls = (ctx.wall_mask > 0) & (near_wall == 0)
    assert false_walls.sum() / (ctx.wall_mask > 0).sum() < 0.01


def test_thickness_of_blank_page_is_zero() -> None:
    assert estimate_stroke_thickness(np.zeros((100, 100), np.uint8)) == 0.0


# ----------------------------------------------------------------------------- scale


def test_scale_estimate_is_in_plausible_range(case: Case) -> None:
    ctx = case.run(until="scale")
    extent_m = max(case.plan.width_m, case.plan.height_m)
    xs = [x for s in ctx.segments for x in (s.x1, s.x2)]
    est_extent = (max(xs) - min(xs)) * ctx.meters_per_pixel
    assert 0.6 * extent_m < est_extent < 1.5 * extent_m


def test_scale_falls_back_when_walls_are_hairlines() -> None:
    segs = [Segment(0, 0, 1000, 0, 1.0), Segment(0, 0, 0, 800, 1.0)]
    mpp, conf = estimate_scale(segs)
    assert mpp == pytest.approx(12 / 1000) and conf < 0.2


# ----------------------------------------------------------------------------- openings


def test_opening_counts_match_ground_truth(case: Case) -> None:
    ctx = case.run(until="openings")
    ops = [o for s in ctx.segments for o in s.openings]
    doors = sum(o.kind == "door" for o in ops)
    windows = sum(o.kind == "window" for o in ops)
    assert (doors, windows) == (case.plan.door_count, case.plan.window_count)


def test_small_gaps_are_merged_without_opening() -> None:
    ink = np.zeros((100, 400), np.uint8)
    segs = [Segment(10, 50, 200, 50, 10), Segment(205, 50, 390, 50, 10)]
    out = merge_openings(segs, 10, mpp=0.02, ink=ink)
    assert len(out) == 1 and out[0].openings == []


def test_far_apart_walls_stay_separate() -> None:
    ink = np.zeros((100, 800), np.uint8)
    segs = [Segment(10, 50, 100, 50, 10), Segment(400, 50, 790, 50, 10)]
    assert len(merge_openings(segs, 10, mpp=0.02, ink=ink)) == 2


def test_gap_with_parallel_lines_is_window() -> None:
    ink = np.zeros((100, 300), np.uint8)
    for y in (45, 50, 55):
        cv2.line(ink, (100, y), (200, y), 255, 2)
    assert classify_gap(ink, (100, 50), (200, 50), 12)[0] == "window"
    assert classify_gap(np.zeros_like(ink), (100, 50), (200, 50), 12)[0] == "door"


# ----------------------------------------------------------------------------- topology


def test_l_corner_is_snapped() -> None:
    # tramos que se pasan de la esquina media pared (como salen de la vectorización)
    segs = [Segment(-5, 0, 200, 0, 10), Segment(0, -5, 0, 150, 10)]
    out = snap_endpoints(segs, 10)
    assert (out[0].x1, out[0].y1) == pytest.approx((0, 0))
    assert (out[1].x1, out[1].y1) == pytest.approx((0, 0))


def test_snap_shifts_openings_with_start_point() -> None:
    s = Segment(-6, 0, 200, 0, 10, [PxOpening(50, 30, "door", 0.8)])
    out = snap_endpoints([s, Segment(0, -5, 0, 150, 10)], 10)
    assert out[0].openings[0].offset == pytest.approx(44)


def test_all_endpoints_are_connected(case: Case) -> None:
    ctx = case.run(until="topology")
    # en un plano cerrado sin muros sueltos, todo extremo toca otro muro (esquina o unión en T)
    assert dangling_endpoints(ctx.segments, tol=1.5) == 0


# ----------------------------------------------------------------------------- rooms


def test_room_count_and_iou(case: Case) -> None:
    ctx = case.run(until="rooms")
    assert len(ctx.rooms) == len(case.plan.rooms)
    assert ctx.rectified is not None
    shape = ctx.rectified.shape[:2]
    for gt in case.rendered.rooms_px:
        gt_rect = case.gt_points(gt)
        best = max(polygon_iou(r.polygon, gt_rect, shape) for r in ctx.rooms)
        assert best >= 0.80, f"IoU habitación {best:.3f}"


def test_rooms_have_confidence_between_0_and_1(clean: Case) -> None:
    ctx = clean.run(until="rooms")
    assert all(0 < r.confidence <= 1 for r in ctx.rooms)


def test_heavy_shadow_photo_still_finds_rooms() -> None:
    case = photo_case("apartment", 7, shadow=0.6, noise=10)
    ctx = case.run(until="rooms")
    assert len(ctx.rooms) == 3
