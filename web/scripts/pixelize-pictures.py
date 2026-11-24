"""Turn every picture in public/pictures into a 32-color dot board.

Drop jpg or png files in public/pictures, then run:

    npm run pictures

The game reads src/game/pictures.ts.
"""

import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "pictures"
OUTPUT = ROOT / "src" / "game" / "pictures.ts"
LONG_SIDE = 26
COLORS = 32


def title_from(path: Path) -> str:
    stem = re.sub(r"[-_]+", " ", path.stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem.title() or "Masterpiece"


def target_size(width: int, height: int) -> tuple[int, int]:
    if width >= height:
        cols = LONG_SIDE
        rows = max(15, round(LONG_SIDE * height / width))
    else:
        rows = LONG_SIDE
        cols = max(10, round(LONG_SIDE * width / height))
    return max(10, cols), max(15, rows)


def pixelize(path: Path) -> dict:
    image = Image.open(path).convert("RGB")
    cols, rows = target_size(image.width, image.height)
    small = image.resize((cols, rows), Image.Resampling.BOX)
    quantized = small.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = quantized.getpalette() or []
    samples = list(quantized.get_flattened_data())
    used = sorted(set(samples))
    remap = {old: index for index, old in enumerate(used)}
    swatches = []
    for old in used:
        red, green, blue = palette[old * 3 : old * 3 + 3]
        swatches.append(f"#{red:02x}{green:02x}{blue:02x}")
    return {
        "id": re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-"),
        "title": title_from(path),
        "cols": cols,
        "rows": rows,
        "palette": swatches,
        "cells": [remap[sample] for sample in samples],
    }


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    pictures = []
    for path in sorted(SOURCE.iterdir()):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        pictures.append(pixelize(path))
        print(f"{path.name} -> {pictures[-1]['cols']}x{pictures[-1]['rows']} {len(pictures[-1]['palette'])} colors")
    body = json.dumps(pictures, separators=(",", ":"))
    OUTPUT.write_text(f"export const PICTURES = {body} as const;\n")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({len(pictures)} pictures)")


if __name__ == "__main__":
    main()
