#!/usr/bin/env python3
"""rotns 素材后处理（PLAN §8.1/§8.2 规格）：
chroma 抠绿（四角众数色→阈值内 alpha=0→despill→1px 腐蚀→trim→LANCZOS 缩放）
additive 黑底（保留 RGB，引擎以 lighter 混合；trim 黑边→缩放）
opaque 不透明（直接缩放）
白弹母图由本脚本预染色出多色成品（运行时零染色代码）。
用法: python3 scripts/rotns_postprocess.py --manifest scripts/rotns_assets_manifest.json
"""
import argparse
import json
import math
import os
import sys
from collections import Counter

from PIL import Image, ImageFilter

CHROMA_THRESHOLD = 60
ERODE_PX = 1


def corner_key_color(im: Image.Image) -> tuple[int, int, int]:
    """取四角 8x8 块的众数色作为绿幕键色。"""
    w, h = im.size
    px = im.convert("RGB").load()
    votes: Counter = Counter()
    for ox in (0, w - 8):
        for oy in (0, h - 8):
            for y in range(oy, oy + 8):
                for x in range(ox, ox + 8):
                    votes[px[x, y]] += 1
    return votes.most_common(1)[0][0]


def chroma_key(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    key = corner_key_color(im)
    datas = im.getdata()
    out = []
    kr, kg, kb = key
    for r, g, b, a in datas:
        d = math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2)
        if d < CHROMA_THRESHOLD:
            out.append((0, 0, 0, 0))
        else:
            # despill：绿溢出抑制
            if g > max(r, b):
                g = max(r, b)
            out.append((r, g, b, a))
    im.putdata(out)
    if ERODE_PX > 0:
        alpha = im.getchannel("A").filter(ImageFilter.MinFilter(ERODE_PX * 2 + 1))
        im.putalpha(alpha)
    return im


def trim_bbox(im: Image.Image, threshold: int = 8) -> Image.Image:
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    # chroma 模式按 alpha；additive 模式按亮度
    if im.getchannel("A").getextrema()[0] < 255:
        bbox = im.getchannel("A").getbbox()
    else:
        gray = im.convert("L").point(lambda v: 255 if v > threshold else 0)
        bbox = gray.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im


def fit_size(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """缩放至目标盒内（保持纵横比，居中贴到精确画布）。"""
    tw, th = size
    im2 = im.copy()
    im2.thumbnail((tw, th), Image.LANCZOS)
    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    canvas.alpha_composite(im2, ((tw - im2.width) // 2, (th - im2.height) // 2))
    return canvas


def tint(im: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    im = im.convert("RGBA")
    tr, tg, tb = rgb
    r = im.getchannel("R").point(lambda v: v * tr // 255)
    g = im.getchannel("G").point(lambda v: v * tg // 255)
    b = im.getchannel("B").point(lambda v: v * tb // 255)
    a = im.getchannel("A")
    return Image.merge("RGBA", (r, g, b, a))


def process(item: dict, src_dir: str, out_dir: str, strict: bool) -> list[str]:
    src_path = os.path.join(src_dir, item["src"])
    if not os.path.isfile(src_path):
        msg = f"MISSING SRC {item['id']}: {src_path}"
        if strict:
            raise FileNotFoundError(msg)
        print("  skip:", msg)
        return []
    im = Image.open(src_path)
    mode = item["mode"]
    if mode == "chroma":
        im = chroma_key(im)
    elif mode == "additive":
        im = im.convert("RGBA")
    elif mode == "opaque":
        im = im.convert("RGB")
    else:
        raise ValueError(f"unknown mode {mode}")
    if item.get("trim") and mode != "opaque":
        im = trim_bbox(im)
    size = tuple(item["size"])
    written: list[str] = []
    tints = item.get("tints")
    if tints:
        for t in tints:
            colored = tint(im, tuple(t["rgb"]))
            if mode == "additive":
                colored = fit_size(colored, size)
            else:
                colored = colored.resize(size, Image.LANCZOS)
            out_path = os.path.join(out_dir, f"{t['suffix']}.png")
            colored.save(out_path)
            written.append(out_path)
    else:
        if mode == "opaque":
            im = im.resize(size, Image.LANCZOS)
        else:
            im = fit_size(im, size)
        out_path = os.path.join(out_dir, item["out"])
        im.save(out_path)
        written.append(out_path)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--src-dir", default="output/imagegen/inb")
    ap.add_argument("--out-dir", default="assets/rotns-img")
    ap.add_argument("--strict", action="store_true", help="任一源缺失即失败")
    args = ap.parse_args()
    with open(args.manifest) as f:
        manifest = json.load(f)
    os.makedirs(args.out_dir, exist_ok=True)
    total = 0
    for item in manifest["items"]:
        written = process(item, args.src_dir, args.out_dir, args.strict)
        for w in written:
            with Image.open(w) as check:
                check.verify()
            print(f"  ok: {os.path.basename(w)}")
            total += 1
    print(f"done: {total} files -> {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
