#!/usr/bin/env python3
"""Render the app icon, and publish it under a name that cannot go stale.

iOS reads `apple-touch-icon`, which is a PNG, so an identity change that only
touches the SVG leaves every installed copy showing the old mark. There is no
rasteriser on this machine and none in the dependency tree, so this is one:
flatten the curves, scanline-fill with a non-zero winding rule, supersample,
and write the PNG with zlib, which is in the standard library.

Vite fingerprints everything it bundles, but `public/` is copied through
verbatim — so an icon at a fixed filename is the one asset in the app that can
be replaced and still be served from a cache under its old bytes. The files
are therefore published with a content hash in the name, and `index.html` and
the manifest are rewritten to point at them. A new drawing is a new URL, which
is the only version of "the icon updated" that survives a CDN.

That does not reach a home screen. iOS snapshots the icon and the name when
the app is added and never looks again; changing them means removing the app
from the home screen and adding it back. Nothing in a repository can fix that.

THE GEOMETRY HERE MIRRORS `assets/icon.svg` AND MUST BE KEPT IN STEP WITH IT.
That is two sources for one drawing, which is a cost; it buys an icon that can
be regenerated from the repository instead of one pasted in from a design tool
that nobody here can run. The hash covers both, so editing either one alone
still lands on a fresh URL.

    python3 scripts/render-icons.py
"""

import struct
import zlib
from pathlib import Path

W = 512                      # the drawing's own coordinate box
SS = 3                       # supersampling factor per axis

# ── The palette, off the badge the app opened with ─────────────────────────
NAVY = (0x00, 0x20, 0x5B)
RED = (0xC8, 0x10, 0x2E)
WHITE = (0xFF, 0xFF, 0xFF)
STEEL = (0xE4, 0xE4, 0xEA)
SKIN = (0xC9, 0x8A, 0x55)
SHADE = (0xB6, 0x78, 0x46)
BROW = (0x4A, 0x2C, 0x17)
EYE = (0x2B, 0x2B, 0x33)
LIP = (0x8B, 0x5A, 0x32)


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
# One of them, on the navy-and-red badge the app opened with. These are the
# shapes `assets/icon.svg` carries; this file draws them into the PNGs iOS
# actually uses for a home-screen icon, and the two are kept in step.

HEAD = ellipse(256, 266, 100, 119)


def cap():
    p = [(149, 130), (363, 130), (363, 205)]
    p += quad((363, 205), (256, 227), (149, 205))
    return p


def tache():
    p = [(256, 285)]
    p += bezier((256, 285), (280, 283), (298, 276), (315, 266))
    p += bezier((315, 266), (327, 259), (342, 258), (344, 268))
    p += bezier((344, 268), (345, 279), (338, 289), (326, 297))
    p += bezier((326, 297), (309, 306), (285, 313), (256, 313))
    return p


def mirror(pts):
    """The moustache is drawn once and reflected, the way the SVG does it."""
    return [(W - x, y) for x, y in pts]


def stethoscope():
    p = [(346, 189)]
    p += bezier((346, 189), (371, 201), (381, 226), (376, 248))
    p += bezier((376, 248), (368, 234), (355, 216), (338, 204))
    return p


def nose():
    p = [(256, 249)]
    p += bezier((256, 249), (263, 263), (269, 278), (269, 286))
    p += bezier((269, 286), (269, 291), (243, 291), (243, 286))
    p += bezier((243, 286), (243, 278), (249, 263), (256, 249))
    return p


def mouth():
    return thick(quad((234, 327), (256, 333), (278, 327)), 6)


def seven():
    """The number on the cap band, in the navy of the ring."""
    return [(236, 155), (276, 155), (276, 165), (257, 204), (239, 204), (258, 165), (236, 165)]


def scene():
    """(polygons, colour, clip) in paint order. `clip` is a polygon the shape
    is confined to, which is how the SVG's clip path is expressed."""
    return [
        ([[(0, 0), (W, 0), (W, W), (0, W)]], NAVY, None),
        ([circle(256, 256, 212)], WHITE, None),
        ([circle(256, 256, 202)], RED, None),

        ([circle(351, 184, 16)], STEEL, None),
        ([stethoscope()], STEEL, None),

        ([HEAD], SKIN, None),
        ([nose()], SHADE, HEAD),
        ([mouth()], LIP, HEAD),
        ([cap()], WHITE, HEAD),

        ([[(204, 236), (240, 231), (240, 241), (204, 245)]], BROW, None),
        ([[(308, 236), (272, 231), (272, 241), (308, 245)]], BROW, None),
        ([ellipse(225, 256, 11, 9)], EYE, None),
        ([ellipse(287, 256, 11, 9)], EYE, None),

        ([tache(), mirror(tache())], WHITE, None),
        ([seven()], NAVY, None),
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


def publish():
    """Write the icons under a content hash and point the app at them."""
    import hashlib
    import re
    import shutil

    root = Path(__file__).resolve().parent.parent
    pub = root / 'public'
    src = root / 'assets' / 'icon.svg'

    tmp180, tmp512 = pub / '.icon-180.tmp', pub / '.icon-512.tmp'
    png(tmp180, 180)
    png(tmp512, 512)
    stamp = hashlib.sha1(
        tmp512.read_bytes() + tmp180.read_bytes() + src.read_bytes()
    ).hexdigest()[:8]

    names = {
        'svg': 'icon-%s.svg' % stamp,
        'p180': 'icon-%s-180.png' % stamp,
        'p512': 'icon-%s-512.png' % stamp,
    }
    # Anything published by an earlier run is now unreachable; leaving it
    # behind would grow the deploy by one dead icon per edit.
    for old in list(pub.glob('icon-*.png')) + list(pub.glob('icon-*.svg')):
        if old.name not in names.values():
            old.unlink()
    tmp180.replace(pub / names['p180'])
    tmp512.replace(pub / names['p512'])
    shutil.copyfile(src, pub / names['svg'])

    for f, patterns in (
        (root / 'index.html', [
            (r'href="\./icon-[0-9a-f]+\.svg"', 'href="./%s"' % names['svg']),
            (r'href="\./icon-[0-9a-f]+-180\.png"', 'href="./%s"' % names['p180']),
        ]),
        (pub / 'manifest.webmanifest', [
            (r'"\./icon-[0-9a-f]+\.svg"', '"./%s"' % names['svg']),
            (r'"\./icon-[0-9a-f]+-180\.png"', '"./%s"' % names['p180']),
            (r'"\./icon-[0-9a-f]+-512\.png"', '"./%s"' % names['p512']),
        ]),
    ):
        text = f.read_text()
        for pat, rep in patterns:
            text, n = re.subn(pat, rep, text)
            assert n, 'no reference matched %s in %s' % (pat, f.name)
        f.write_text(text)

    for name in names.values():
        print(name, (pub / name).stat().st_size, 'bytes')


if __name__ == '__main__':
    publish()
