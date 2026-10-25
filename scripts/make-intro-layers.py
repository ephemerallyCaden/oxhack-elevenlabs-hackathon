#!/usr/bin/env python3
"""Cut courtroom-bg-tall.png into depth planes for the crane-up intro.

Outputs public/assets/intro-layers/*.webp + layers.json (placement in
tall-image pixels; layers may extend past the image via padding).

Seamless at rest: each cut-out's opaque core covers its region and its
feathered edge only extends over pixels that the planes behind still hold in
their original form, so compositing all planes at rest reproduces the original
image. Behind the mid objects (desks, railings, stairs) the far plate is
inpainted (OpenCV Telea), so parallax reveals plausible wall/floor, not ghosts.

Floor: split into bands that move at increasing rates (an approximation of a
perspective floor). Outside the image, floor pixels are synthesized
perspective-correctly from the carpet's diamond lattice (see synth_carpet), so
planes that shrink/lift during the move never expose an edge or a mirror seam.

Usage: python3 scripts/make-intro-layers.py
"""
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public/assets/courtroom-bg-tall.png'
OUT = ROOT / 'public/assets/intro-layers'

PAD_X, PAD_TOP, PAD_BOTTOM = 300, 150, 300   # far/mid padding (reflected)
CARPET_TOP = 834                              # first row that is carpet only (below the desks)
CARPET_EXTEND = 1000                          # extra mirrored-carpet rows below the image
CORE_GROW = 3                                 # px the opaque/inpaint core extends past an outline
FEATHER_OBJ = 6                               # soft edge on objects
FEATHER_FLOOR = 24                            # soft cross-fade between floor bands

# Polygons in tall-image pixel coordinates (892×1318).
MID_OBJECTS = {
    'left_railing':  [(46, 612), (240, 614), (240, 748), (175, 762), (60, 805), (46, 805)],
    'right_railing': [(652, 614), (846, 612), (846, 805), (832, 805), (717, 762), (652, 748)],
    'left_stairs':   [(0, 750), (52, 754), (110, 810), (110, 842), (32, 888), (0, 888)],
    'right_stairs':  [(892, 750), (840, 754), (782, 810), (782, 842), (860, 888), (892, 888)],
    'left_desk':     [(168, 698), (344, 694), (344, 772), (302, 810), (168, 814)],
    'right_desk':    [(548, 694), (724, 698), (724, 814), (590, 810), (548, 772)],
    'witness_stand': [(366, 710), (524, 710), (524, 832), (366, 832)],
}
MID_FLOOR_ROWS = (745, CARPET_TOP)            # floor strip the desks stand on rides with them
# Front layers: the pose art is cut off at the waist, so the Judge stands behind the bench and
# the lawyers behind their desks. These redraw those pieces in front of the characters (same
# pixels as the plane below them, so the scene is unchanged at rest).
JUDGE_BENCH = [(232, 628), (658, 628), (658, 748), (232, 748)]
FRONT_DESKS = ('left_desk', 'right_desk', 'witness_stand')
# (name, first row, last row, depth weight). Weight 0 = far plane, 1 = nearest.
PLANES = [
    ('far', None, None, 0.0),
    ('mid', None, None, 0.30),
    ('floor1', CARPET_TOP, 930, 0.45),
    ('floor2', 930, 1050, 0.62),
    ('floor3', 1050, 1190, 0.80),
    ('floor4', 1190, None, 1.00),             # None = to the end of the extended carpet
]


def poly_mask(shape, polys):
    m = np.zeros(shape[:2], np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.array(p, np.int32)], 255)
    return m


def grow(m, px):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(m, k)


def soft_alpha(core, feather):
    """Opaque over `core`, feathered `feather` px outward."""
    outer = grow(core, feather)
    a = cv2.GaussianBlur(outer, (0, 0), feather / 2).astype(np.float32) / 255
    return np.maximum(a, core.astype(np.float32) / 255)


# Floor geometry, measured from the carpet itself: both diagonal line families of the
# diamond lattice converge on the horizon y=618 (VPs at x=-719 and 1598, symmetric about
# x=439.5, so focal length = 1158.5px). Rectified to floor space (X, Z) the carpet is a
# square diamond lattice repeating every 0.2 along X and Z (autocorrelation 0.72-0.74).
YH, XH, FOCAL = 618.0, 439.5, 1158.5
PERIOD = 0.2
TILE_Z0, TILE_WZ = 1.70, 2 * PERIOD      # source window: near carpet, rows ~1170-1300
TILE_X0, TILE_WX = -2 * PERIOD, 4 * PERIOD


LIGHT_SIGMA = 30   # px; what counts as "lighting" (low frequency) vs pattern detail


def synth_carpet(img, xs, ys):
    """Perspective-correct carpet at image coords (xs, ys) (float arrays, ys > YH).

    Pattern: project to floor space, wrap into the source window by whole lattice
    periods, sample the lighting-free detail (img / blur(img)). Lighting: the photo's own
    low-frequency light, extended outward from the nearest carpet pixel. Wrapping the
    detail only (not the light) avoids banding at every tile repeat.
    """
    h, w = img.shape[:2]
    src = img.astype(np.float32)
    low = cv2.GaussianBlur(src, (0, 0), LIGHT_SIGMA)
    detail = cv2.GaussianBlur(src, (0, 0), 0.6) / (low + 1)   # light pre-blur: far rows sample a larger footprint
    Z = FOCAL / (ys - YH)
    X = (xs - XH) * Z / FOCAL
    Zs = TILE_Z0 + np.mod(Z - TILE_Z0, TILE_WZ)
    Xs = TILE_X0 + np.mod(X - TILE_X0, TILE_WX)
    mx = (XH + FOCAL * Xs / Zs).astype(np.float32)
    my = (YH + FOCAL / Zs).astype(np.float32)
    d = cv2.remap(detail, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    lx = np.clip(xs, 0, w - 1).astype(np.float32)
    ly = np.clip(ys, CARPET_TOP + LIGHT_SIGMA, h - 1).astype(np.float32)   # light from carpet, never the desks
    light = cv2.remap(low, lx, ly, cv2.INTER_LINEAR)
    return np.clip(d * (light + 1), 0, 255).astype(np.uint8)


def extended_canvas(base, img, bottom):
    """`base` padded (reflect) by PAD_X/PAD_TOP/`bottom`; every floor pixel outside the
    original image area (rows >= CARPET_TOP) is replaced with synthesized carpet."""
    h, w = base.shape[:2]
    canvas = cv2.copyMakeBorder(base, PAD_TOP, bottom, PAD_X, PAD_X, cv2.BORDER_REFLECT_101)
    ys, xs = np.mgrid[-PAD_TOP:h + bottom, -PAD_X:w + PAD_X].astype(np.float32)
    outside = (xs < 0) | (xs >= w) | (ys >= h)
    floor = (ys >= CARPET_TOP) & outside
    synth = synth_carpet(img, xs, np.maximum(ys, YH + 1))
    canvas[floor] = synth[floor]
    return canvas


def write(name, rgb, alpha, meta, weight):
    a8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    ys, xs = np.where(a8 > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([rgb[y0:y1, x0:x1], a8[y0:y1, x0:x1]])
    path = OUT / f'{name}.webp'
    cv2.imwrite(str(path), rgba, [cv2.IMWRITE_WEBP_QUALITY, 92])
    meta['layers'].append({'name': name, 'file': f'/assets/intro-layers/{name}.webp', 'weight': weight,
                           'x': int(x0 - PAD_X), 'y': int(y0 - PAD_TOP), 'w': int(x1 - x0), 'h': int(y1 - y0)})
    print(f'{name:7s} w={weight:.2f}  {x1 - x0}x{y1 - y0} at ({x0 - PAD_X},{y0 - PAD_TOP})  {path.stat().st_size // 1024} KB')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.webp'):
        old.unlink()
    img = cv2.imread(str(SRC), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    meta = {'source': '/assets/courtroom-bg-tall.png', 'width': w, 'height': h, 'layers': []}

    stair_polys = [MID_OBJECTS['left_stairs'], MID_OBJECTS['right_stairs']]
    stairs_core = grow(poly_mask(img.shape, stair_polys), CORE_GROW)
    obj_core = grow(poly_mask(img.shape, [p for k, p in MID_OBJECTS.items() if 'stairs' not in k]), CORE_GROW)

    def pad(a, mode=cv2.BORDER_REFLECT_101):
        return cv2.copyMakeBorder(a, PAD_TOP, PAD_BOTTOM, PAD_X, PAD_X, mode)

    # FAR: full opaque plate with the mid objects + stairs inpainted away (wall), and the
    # floor under the desks rebuilt as synthesized carpet (Telea from the dark desk
    # shadows reads as a smudge when revealed).
    hidden = np.maximum(obj_core, stairs_core)
    far = cv2.inpaint(img, hidden, 9, cv2.INPAINT_TELEA)            # wall behind objects
    f0, f1 = MID_FLOOR_ROWS
    ys, xs = np.mgrid[f0:h, 0:w].astype(np.float32)
    carpet = synth_carpet(img, xs, ys)
    floor_hidden = hidden[f0:] > 0
    floor_hidden[: f1 - f0] = True                                  # whole strip under the desks
    far[f0:][floor_hidden] = carpet[floor_hidden]                   # floor behind objects
    far_canvas = extended_canvas(far, img, PAD_BOTTOM)
    write('far', far_canvas, np.ones(far_canvas.shape[:2], np.float32), meta, 0.0)

    # BENCH: the Judge's bench, in front of the Judge (rides the far plane).
    bench = pad(soft_alpha(grow(poly_mask(img.shape, [JUDGE_BENCH]), CORE_GROW), FEATHER_OBJ))
    write('bench', pad(img), bench, meta, 0.0)

    # MID: desks, railings, witness stand + the floor strip they stand on.
    mid_core = obj_core.copy()
    mid_core[MID_FLOOR_ROWS[0]:MID_FLOOR_ROWS[1], :] = 255
    a = pad(soft_alpha(mid_core, FEATHER_OBJ))
    a[:PAD_TOP, :] = 0
    a[PAD_TOP + h:, :] = 0
    write('mid', pad(img), a, meta, 0.30)

    # DESKS: the lawyers' desks + witness stand, in front of the lawyers (ride the mid plane).
    desks = pad(soft_alpha(grow(poly_mask(img.shape, [MID_OBJECTS[k] for k in FRONT_DESKS]), CORE_GROW), FEATHER_OBJ))
    write('desks', pad(img), desks, meta, 0.30)

    # FLOOR BANDS: carpet canvas (extended), each band soft-edged. The side stairs ride
    # the first band (no holes cut in the floor). Later bands own their rows exclusively.
    canvas = extended_canvas(img, img, CARPET_EXTEND)
    H = canvas.shape[0]
    stairs_pad = cv2.copyMakeBorder(stairs_core, PAD_TOP, H - PAD_TOP - h, PAD_X, PAD_X, cv2.BORDER_CONSTANT, value=0)
    for name, r0, r1, weight in PLANES[2:]:
        core = np.zeros(canvas.shape[:2], np.uint8)
        core[PAD_TOP + r0: (PAD_TOP + r1) if r1 else H, :] = 255
        core = np.maximum(core, stairs_pad) if name == 'floor1' else cv2.subtract(core, stairs_pad)
        write(name, canvas, soft_alpha(core, FEATHER_OBJ if name == 'floor1' else FEATHER_FLOOR), meta, weight)

    (OUT / 'layers.json').write_text(json.dumps(meta, indent=2))
    print('wrote', OUT / 'layers.json')


if __name__ == '__main__':
    main()
