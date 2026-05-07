"""Tests for ops/image_processing.square_pad."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from mfc.ops import image_processing as ip


def _make_solid_color_image(path: Path, size: tuple[int, int], color: tuple[int, int, int]) -> None:
    Image.new("RGB", size, color).save(path, "JPEG", quality=92)


def _open(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def test_square_pad_landscape_to_square(tmp_path):
    src = tmp_path / "landscape.jpg"
    dst = tmp_path / "out.jpg"
    _make_solid_color_image(src, (300, 200), (255, 255, 255))  # white
    ip.square_pad(src, dst)
    img = _open(dst)
    assert img.size == (300, 300)


def test_square_pad_portrait_to_square(tmp_path):
    src = tmp_path / "portrait.jpg"
    dst = tmp_path / "out.jpg"
    _make_solid_color_image(src, (200, 400), (255, 255, 255))
    ip.square_pad(src, dst)
    img = _open(dst)
    assert img.size == (400, 400)


def test_square_pad_already_square_passes_through(tmp_path):
    src = tmp_path / "square.jpg"
    dst = tmp_path / "out.jpg"
    _make_solid_color_image(src, (250, 250), (255, 255, 255))
    ip.square_pad(src, dst)
    img = _open(dst)
    assert img.size == (250, 250)


def test_square_pad_uses_edge_pixel_color_for_fill(tmp_path):
    """Image with red border + green center -> padding should be red-ish."""
    src = tmp_path / "bordered.jpg"
    dst = tmp_path / "out.jpg"
    # 100w x 60h: red top/bottom rows and side columns, green interior
    img = Image.new("RGB", (100, 60), (200, 30, 30))
    inner = Image.new("RGB", (60, 20), (30, 200, 30))
    img.paste(inner, (20, 20))
    img.save(src, "JPEG", quality=95)
    ip.square_pad(src, dst)
    out = _open(dst)
    assert out.size == (100, 100)
    # The top and bottom strips of the output should be predominantly red.
    top_pixel = out.getpixel((50, 5))
    bottom_pixel = out.getpixel((50, 95))
    # JPEG-quantized red — allow a wide tolerance
    for px in (top_pixel, bottom_pixel):
        assert px[0] > 150, f"R channel too low: {px}"
        assert px[1] < 90, f"G channel too high: {px}"
        assert px[2] < 90, f"B channel too high: {px}"


def test_square_pad_centers_original_image(tmp_path):
    """A 200w x 100h white image padded to 200x200 should keep white in the
    middle-row strip and a non-white (sampled-edge) top/bottom strip."""
    src = tmp_path / "centered.jpg"
    dst = tmp_path / "out.jpg"
    img = Image.new("RGB", (200, 100), (255, 255, 255))
    # paint a non-white border so edge sampling picks something distinct
    for x in range(200):
        img.putpixel((x, 0), (0, 0, 0))
        img.putpixel((x, 99), (0, 0, 0))
    img.save(src, "JPEG", quality=95)
    ip.square_pad(src, dst)
    out = _open(dst)
    assert out.size == (200, 200)
    # Original content should now sit between rows 50 and 149.
    middle = out.getpixel((100, 100))
    assert middle == (255, 255, 255) or sum(abs(c - 255) for c in middle) < 30
    # The padding rows (above 50) should be the sampled edge colour (black-ish)
    top_pad = out.getpixel((100, 25))
    assert sum(top_pad) < 90  # near black


def test_square_pad_preserves_jpeg_format(tmp_path):
    src = tmp_path / "x.jpg"
    dst = tmp_path / "out.jpg"
    _make_solid_color_image(src, (300, 200), (240, 240, 240))
    ip.square_pad(src, dst)
    with Image.open(dst) as img:
        assert img.format == "JPEG"


def test_square_pad_handles_rgba_png(tmp_path):
    """An RGBA PNG with transparency should be flattened against the edge fill
    when written to JPEG."""
    src = tmp_path / "icon.png"
    dst = tmp_path / "out.jpg"
    img = Image.new("RGBA", (100, 100), (200, 0, 0, 255))
    img.save(src, "PNG")
    ip.square_pad(src, dst)
    out = _open(dst)
    assert out.size == (100, 100)
