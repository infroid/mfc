"""Extract text from an image using Tesseract (system: brew install tesseract)."""

from pathlib import Path

import pytesseract
from dagster import Config, OpExecutionContext, job, op
from PIL import Image

from ..lib.paths import artifact_dir


class OcrConfig(Config):
    image_path: str


@op(name="ocr_image_extract")
def extract(context: OpExecutionContext, config: OcrConfig) -> str:
    src = Path(config.image_path)
    if not src.exists():
        raise FileNotFoundError(src)
    text = pytesseract.image_to_string(Image.open(src))
    dest = artifact_dir(context) / (src.stem + ".txt")
    dest.write_text(text)
    context.log.info(f"OCR wrote {len(text)} chars to {dest}")
    return text


@job
def ocr_image_job() -> None:
    extract()
