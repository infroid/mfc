from __future__ import annotations

from pathlib import Path

from dagster import build_op_context

from routine.jobs.pdf_text import PdfConfig, extract

FIXTURES = Path(__file__).parent / "fixtures"


def test_extract_uses_direct_path_when_text_present(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context()
    text = extract(ctx, PdfConfig(pdf_path=str(FIXTURES / "text.pdf")))
    assert "BLOOD TEST DEMO TEXT" in text
    out = tmp_path / "routine" / "artifacts" / ctx.run_id / "text.txt"
    assert "BLOOD TEST DEMO TEXT" in out.read_text()


def test_extract_falls_back_to_ocr_for_scanned(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        "routine.jobs.pdf_text.convert_from_path",
        lambda _p: ["fake-image"],
    )
    monkeypatch.setattr(
        "routine.jobs.pdf_text.pytesseract.image_to_string",
        lambda _img: "OCR FALLBACK TEXT",
    )
    ctx = build_op_context()
    text = extract(ctx, PdfConfig(pdf_path=str(FIXTURES / "scanned.pdf")))
    assert text == "OCR FALLBACK TEXT"
