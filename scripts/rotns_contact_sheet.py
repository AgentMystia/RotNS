#!/usr/bin/env python3
"""素材拼板质检图（PLAN §8.1）：assets/rotns-img 全件缩略拼到一张板。"""
import math
import os
import sys

from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/rotns-img"
OUT = sys.argv[2] if len(sys.argv) > 2 else "output/imagegen/inb/contact-sheet.png"
CELL = 128
COLS = 7

files = sorted(f for f in os.listdir(SRC) if f.endswith(".png"))
rows = math.ceil(len(files) / COLS)
sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + 16)), (24, 16, 36))
draw = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(SRC, f)).convert("RGBA")
    im.thumbnail((CELL - 8, CELL - 8), Image.LANCZOS)
    x = (i % COLS) * CELL
    y = (i // COLS) * (CELL + 16)
    # additive 件（黑底）直接贴；chroma 件垫棋盘底
    bg = Image.new("RGBA", (im.width, im.height), (40, 40, 40, 255))
    bg.alpha_composite(im)
    sheet.paste(bg.convert("RGB"), (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
    draw.text((x + 4, y + CELL - 2), f.replace(".png", ""), fill=(200, 180, 220))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT)
print(f"wrote {OUT} ({len(files)} items)")
