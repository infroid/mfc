"""Extract text from a PDF.

Strategy:
  1. pdfplumber direct extract; concat per-page text.
  2. If empty/whitespace, rasterize with pdf2image and OCR each page with Tesseract.
"""

from pathlib import Path

import pdfplumber
import pytesseract
from dagster import Config, OpExecutionContext, job, op
from pdf2image import convert_from_path

from ..lib.paths import artifact_dir


class PdfConfig(Config):
    pdf_path: str


def _direct_extract(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        chunks = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(chunks).strip()


def _ocr_extract(path: Path) -> str:
    pages = convert_from_path(str(path))
    return "\n".join(pytesseract.image_to_string(p) for p in pages).strip()


@op
def extract(context: OpExecutionContext, config: PdfConfig) -> str:
    src = Path(config.pdf_path)
    if not src.exists():
        raise FileNotFoundError(src)
    text = _direct_extract(src)
    if text:
        context.log.info("pdf_text: direct extraction succeeded")
    else:
        context.log.info("pdf_text: direct extraction empty, falling back to OCR")
        text = _ocr_extract(src)
    dest = artifact_dir(context) / (src.stem + ".txt")
    dest.write_text(text)
    return text


@job
def pdf_text_job() -> None:
    extract()
