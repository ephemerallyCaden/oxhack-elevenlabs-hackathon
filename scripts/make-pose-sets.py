#!/usr/bin/env python3
"""Build the courtroom pose sets from the source art in art/poses/src/.

Source: headless Ace Attorney-style bodies on 2010x1675 canvases. Each frame carries a
15px head marker: red #ff0000 = side-facing head, blue #1600ff = front-facing head.
Names: <role>_<pose>[-<frame>].png (frames were "pose:N" in the original art).

Outputs public/assets/poses/{prosecution,defense,judge}/*.webp + poses.json:
- trimmed to one shared box per role, downscaled, marker pixels erased
- defense = the prosecutor art mirrored with the suit recoloured blue -> red
- per pose: frames, head type, head centre per frame (output px), animation

Usage: python3 scripts/make-pose-sets.py
"""
import colorsys
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art/poses/src'
OUT = ROOT / 'public/assets/poses'
SCALE = 0.5
FRAME_MS = 200
# Animated poses: once-hold plays through and holds the last frame; loop repeats.
ANIM = {'neutral2': 'loop', 'confident2': 'once-hold', 'shocked1': 'once-hold'}
# Suit recolour for the defense: blue hues -> red, everything else (skin, shirt, tie) untouched.
SUIT_HUE = (190 / 360, 255 / 360)
RED_HUE = 0 / 360


def marker(a):
    r, g, b, al = (a[..., i].astype(int) for i in range(4))
    for kind, m in (('side', (r > 230) & (g < 30) & (b < 30)), ('front', (r < 40) & (g < 40) & (b > 230))):
        ys, xs = np.where(m & (al > 200))
        if len(xs):
            return kind, (float(xs.mean()), float(ys.mean())), m
    raise ValueError('no head marker')


def recolour_suit(rgba):
    """Rotate the suit's blue hue band to red, keeping each pixel's lightness/saturation."""
    a = rgba.astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a[..., :3].max(-1), a[..., :3].min(-1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    s = d / (mx + 1e-6)
    suit = (h >= SUIT_HUE[0]) & (h <= SUIT_HUE[1]) & (s > 0.18) & (rgba[..., 3] > 0)
    out = rgba.copy()
    ys, xs = np.where(suit)
    for y, x in zip(ys, xs):
        hh, ll, ss = colorsys.rgb_to_hls(r[y, x], g[y, x], b[y, x])
        rr, gg, bb = colorsys.hls_to_rgb(RED_HUE + (hh - 220 / 360) * 0.3, ll, ss)
        out[y, x, :3] = (np.array([rr, gg, bb]) * 255).round().astype(np.uint8)
    return out


def load(prefix):
    frames = {}
    for f in sorted(SRC.glob(f'{prefix}_*.png')):
        m = re.match(rf'{prefix}_([a-z]+\d+)(?:-(\d+))?\.png$', f.name)
        pose, n = m.group(1), int(m.group(2) or 1)
        a = np.array(Image.open(f).convert('RGBA'))
        kind, centre, mask = marker(a)
        a[mask, 3] = 0  # erase the marker
        frames.setdefault(pose, []).append((n, a, kind, centre))
    return {p: sorted(v, key=lambda t: t[0]) for p, v in frames.items()}


def build(role, frames, mirror=False, recolour=False):
    # One shared trim box for the role, so every frame lines up.
    boxes = [Image.fromarray(a).getbbox() for fr in frames.values() for _, a, _, _ in fr]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    W, H = round((x1 - x0) * SCALE), round((y1 - y0) * SCALE)
    out_dir = OUT / role
    out_dir.mkdir(parents=True, exist_ok=True)
    poses = {}
    for pose, fr in frames.items():
        files, centres, kinds = [], [], set()
        for n, a, kind, (cx, cy) in fr:
            crop = a[y0:y1, x0:x1]
            if recolour:
                crop = recolour_suit(crop)
            im = Image.fromarray(crop).resize((W, H), Image.LANCZOS)
            hx, hy = (cx - x0) * SCALE, (cy - y0) * SCALE
            if mirror:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
                hx = W - hx
            name = f'{pose}-{n}.webp' if len(fr) > 1 else f'{pose}.webp'
            im.save(out_dir / name, quality=90, method=6)
            files.append(f'/assets/poses/{role}/{name}')
            centres.append([round(hx, 1), round(hy, 1)])
            kinds.add(kind)
        assert len(kinds) == 1, f'{role}/{pose}: mixed head types'
        poses[pose] = {
            'frames': files,
            'head': kinds.pop(),
            'centres': centres,
            'anim': ANIM.get(pose, 'static') if len(fr) > 1 else 'static',
        }
    print(f'{role:11s} {W}x{H}  poses: {", ".join(f"{p}({len(v["frames"])})" for p, v in poses.items())}')
    return {'width': W, 'height': H, 'faces': 'left' if mirror else 'right', 'poses': poses}


def main():
    pros = load('prosecutor')
    meta = {
        'frameMs': FRAME_MS,
        'roles': {
            'prosecution': build('prosecution', pros),
            'defense': build('defense', pros, mirror=True, recolour=True),
            'judge': build('judge', load('judge')),
        },
    }
    (OUT / 'poses.json').write_text(json.dumps(meta, indent=2))
    print('wrote', OUT / 'poses.json')


if __name__ == '__main__':
    main()
