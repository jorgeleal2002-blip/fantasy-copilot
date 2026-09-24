#!/usr/bin/env python3
"""Render the app icon to the PNGs the home screen actually uses.

iOS reads `apple-touch-icon`, which is a PNG, so an identity change that only
touches `public/icon.svg` leaves every installed copy showing the old mark.
There is no rasteriser on this machine and none in the dependency tree, so
this is one: flatten the curves, scanline-fill with a non-zero winding rule,
supersample, and write the PNG with zlib, which is in the standard library.

THE GEOMETRY HERE MIRRORS `public/icon.svg` AND MUST BE KEPT IN STEP WITH IT.
That is two sources for one drawing, which is a cost; it buys an icon that can
be regenerated from the repository instead of one pasted in from a design tool
that nobody here can run.

    python3 scripts/render-icons.py
"""

import struct
import zlib
from pathlib import Path

W = 512                      # the drawing's own coordinate box
SS = 3                       # supersampling factor per axis

# ── The palette, off the league's own colours ───────────────────────────────
BLACK = (0x0B, 0x0B, 0x0F)
BLUE = (0x00, 0x85, 0xCA)    # the Doctor's side
GOLD = (0xFF, 0xB6, 0x12)    # Epstein's side
WHITE = (0xFF, 0xFF, 0xFF)
STEEL = (0xE4, 0xE4, 0xEA)
SKIN = (0xC9, 0x8A, 0x55)
SHADE = (0xB6, 0x78, 0x46)
BROW = (0x4A, 0x2C, 0x17)
EYE = (0x2B, 0x2B, 0x33)
LIP = (0x8B, 0x5A, 0x32)
SKIN_B = (0xE2, 0xB0, 0x8A)  # stein's side
SHADE_B = (0xD0, 0x9B, 0x74)
LIP_B = (0xA8, 0x74, 0x4E)
HAIR = (0xF0, 0xF0, 0xF4)   # white, a shade off the cap so the two read apart
BROW_B = (0x9A, 0x9A, 0xA4)


# ── Path building ───────────────────────────────────────────────────────────

def bezier(p0, p1, p2, p3, steps=24):
    """Cubic, flattened. 24 steps is past the point where more of them move a
    pixel at 512×512, let alone at the 180 the phone asks for."""
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


def quad(p0, p1, p2, steps=24):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def ellipse(cx, cy, rx, ry, steps=192):
    from math import cos, pi, sin
    return [(cx + rx * cos(2 * pi * i / steps), cy + ry * sin(2 * pi * i / steps))
            for i in range(steps)]


def circle(cx, cy, r, steps=192):
    return ellipse(cx, cy, r, r, steps)


def mirror(pts):
    """The moustache is drawn once and reflected, the way the SVG does it."""
    return [(W - x, y) for x, y in pts]


def thick(pts, width):
    """A stroked polyline as a filled shape: offset both ways along the normal.
    Only used for the mouth, which is one shallow curve."""
    from math import hypot
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        px, py = pts[max(i - 1, 0)]
        nx, ny = pts[min(i + 1, len(pts) - 1)]
        dx, dy = nx - px, ny - py
        n = hypot(dx, dy) or 1
        ox, oy = -dy / n * width / 2, dx / n * width / 2
        left.append((x + ox, y + oy))
        right.append((x - ox, y - oy))
    return left + right[::-1]


# ── The drawing ─────────────────────────────────────────────────────────────
#
# Two of them, because the league is two of them. The badge splits down the
# middle — Carolina blue for the Doctor, Steelers gold for stein — and each
# side carries its own face. What tells them apart at sixty pixels on a home
# screen is not a likeness, which is mud at that size, but two silhouettes:
# a white surgical cap and a moustache against blond hair and a bare lip.

def xform(pts, cx, cy, s):
    """The original drawing is one head at (256, 266) with rx 100. Every part
    of a face is placed by moving that head, so a second one is the same
    shapes at another centre rather than a second set of coordinates."""
    return [(cx + (x - 256) * s, cy + (y - 266) * s) for x, y in pts]


def head_at(cx, cy, s):
    return xform(ellipse(256, 266, 100, 119), cx, cy, s)


def cap_at(cx, cy, s):
    p = [(149, 130), (363, 130), (363, 205)]
    p += quad((363, 205), (256, 227), (149, 205))
    return xform(p, cx, cy, s)


def hair_at(cx, cy, s):
    """Same band, parted rather than flat: a fringe swept to one side is what
    reads as hair where a straight edge reads as a cap."""
    p = [(149, 120), (363, 120), (363, 212)]
    p += quad((363, 212), (300, 232), (286, 196))
    p += quad((286, 196), (250, 236), (149, 214))
    return xform(p, cx, cy, s)


def tache_at(cx, cy, s):
    p = [(256, 285)]
    p += bezier((256, 285), (280, 283), (298, 276), (315, 266))
    p += bezier((315, 266), (327, 259), (342, 258), (344, 268))
    p += bezier((344, 268), (345, 279), (338, 289), (326, 297))
    p += bezier((326, 297), (309, 306), (285, 313), (256, 313))
    return xform(p, cx, cy, s)


def flip(pts, cx):
    return [(2 * cx - x, y) for x, y in pts]


def nose_at(cx, cy, s):
    p = [(256, 249)]
    p += bezier((256, 249), (263, 263), (269, 278), (269, 286))
    p += bezier((269, 286), (269, 291), (243, 291), (243, 286))
    p += bezier((243, 286), (243, 278), (249, 263), (256, 249))
    return xform(p, cx, cy, s)


def mouth_at(cx, cy, s, width=6):
    return xform(thick(quad((234, 327), (256, 333), (278, 327)), width), cx, cy, s)


def eyes_at(cx, cy, s):
    return [xform(ellipse(225, 256, 11, 9), cx, cy, s),
            xform(ellipse(287, 256, 11, 9), cx, cy, s)]


def brows_at(cx, cy, s):
    return [xform([(204, 236), (240, 231), (240, 241), (204, 245)], cx, cy, s),
            xform([(308, 236), (272, 231), (272, 241), (308, 245)], cx, cy, s)]


def face(cx, cy, s, kind):
    """One manager. `kind` is the only thing that differs, and it differs in
    the two places a small icon can still show: what is on his head, and
    whether anything is under his nose."""
    doc = kind == 'doctor'
    skin = SKIN if doc else SKIN_B
    shade = SHADE if doc else SHADE_B
    head = head_at(cx, cy, s)
    out = [
        ([head], skin, None),
        ([nose_at(cx, cy, s)], shade, head),
        ([mouth_at(cx, cy, s)], LIP if doc else LIP_B, head),
        ([cap_at(cx, cy, s) if doc else hair_at(cx, cy, s)], WHITE if doc else HAIR, head),
        (brows_at(cx, cy, s), BROW if doc else BROW_B, None),
        (eyes_at(cx, cy, s), EYE, None),
    ]
    if doc:
        t = tache_at(cx, cy, s)
        out.append(([t, flip(t, cx)], WHITE, None))
    return out


def half(side):
    """A half-plane the size of the box. One colour per manager, which is the
    whole idea of the name."""
    return ([(0, 0), (256, 0), (256, W), (0, W)] if side == 'left'
            else [(256, 0), (W, 0), (W, W), (256, W)])


# Two heads inside a 202 badge: 0.86 of the original fills it with an even
# margin all round and leaves them a hair apart at the split line rather than
# overlapping it.
SCALE = 0.86
LEFT, RIGHT, MID = 164, 348, 263


def scene():
    """(polygons, colour, clip) in paint order. `clip` is a polygon the shape
    is confined to, which is how the SVG's clip paths are expressed."""
    badge = circle(256, 256, 202)
    return [
        ([[(0, 0), (W, 0), (W, W), (0, W)]], BLACK, None),
        ([circle(256, 256, 212)], WHITE, None),
        ([badge], BLUE, half('left')),
        ([badge], GOLD, half('right')),
        *face(LEFT, MID, SCALE, 'doctor'),
        *face(RIGHT, MID, SCALE, 'stein'),
    ]


# ── Rasteriser ──────────────────────────────────────────────────────────────

def edges_of(polys, scale):
    out = []
    for poly in polys:
        pts = [(x * scale, y * scale) for x, y in poly]
        for i, (x0, y0) in enumerate(pts):
            x1, y1 = pts[(i + 1) % len(pts)]
            if y0 != y1:
                out.append((x0, y0, x1, y1))
    return out


def spans(edges, y):
    """Crossings on one scanline, with winding direction, non-zero rule."""
    hits = []
    for x0, y0, x1, y1 in edges:
        if (y0 <= y < y1) or (y1 <= y < y0):
            t = (y - y0) / (y1 - y0)
            hits.append((x0 + t * (x1 - x0), 1 if y1 > y0 else -1))
    hits.sort()
    out, wind, start = [], 0, 0.0
    for x, d in hits:
        if wind == 0:
            start = x
        wind += d
        if wind == 0:
            out.append((start, x))
    return out


def fill(buf, size, polys, colour, clip):
    """Paint one shape, supersampled. Coverage is counted per subpixel row and
    blended, which is what keeps a 180px moustache from turning into stairs."""
    scale = size / W
    n = size * SS
    edges = edges_of(polys, scale * SS)
    cedges = edges_of([clip], scale * SS) if clip else None
    if not edges:
        return
    ys = [y for e in edges for y in (e[1], e[3])]
    top = max(int(min(ys)), 0)
    bottom = min(int(max(ys)) + 1, n)

    cover = [0.0] * (size * size)
    for sy in range(top, bottom):
        row = spans(edges, sy + 0.5)
        if not row:
            continue
        if cedges is not None:
            row = clipped(row, spans(cedges, sy + 0.5))
        py = sy // SS
        for a, b in row:
            a = max(a, 0.0)
            b = min(b, float(n))
            if b <= a:
                continue
            for sx in range(int(a), min(int(b) + 1, n)):
                part = min(b, sx + 1.0) - max(a, float(sx))
                if part > 0:
                    cover[py * size + sx // SS] += part

    full = SS * SS
    r, g, bl = colour
    for i, c in enumerate(cover):
        if c <= 0:
            continue
        alpha = min(c / full, 1.0)
        j = i * 3
        buf[j] = round(buf[j] * (1 - alpha) + r * alpha)
        buf[j + 1] = round(buf[j + 1] * (1 - alpha) + g * alpha)
        buf[j + 2] = round(buf[j + 2] * (1 - alpha) + bl * alpha)


def clipped(row, mask):
    out = []
    for a, b in row:
        for c, d in mask:
            lo, hi = max(a, c), min(b, d)
            if hi > lo:
                out.append((lo, hi))
    return out


def png(path, size):
    buf = bytearray([0] * (size * size * 3))
    for polys, colour, clip in scene():
        fill(buf, size, polys, colour, clip)

    raw = bytearray()
    for y in range(size):
        raw.append(0)                                   # filter: none
        raw += buf[y * size * 3:(y + 1) * size * 3]

    def chunk(kind, data):
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF))

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    Path(path).write_bytes(out)
    print(path, size, len(out), 'bytes')


if __name__ == '__main__':
    here = Path(__file__).resolve().parent.parent / 'public'
    png(here / 'icon-180.png', 180)
    png(here / 'icon-512.png', 512)
