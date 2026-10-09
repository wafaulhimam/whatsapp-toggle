#!/usr/bin/env python3
"""Generate the extension's PNG icons.

Pure stdlib - no Pillow needed. Each icon is a rounded green tile with a white
"hidden eye" glyph, drawn with 4x4 supersampling for clean edges.

Run from the repo root:  python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

BG = (0x00, 0xA8, 0x84)          # WhatsApp-ish green
FG = (0xFF, 0xFF, 0xFF)
SS = 4                            # supersampling factor

# Glyph geometry, in 0..1 normalised coordinates.
# An outlined eye with a slash cut through it.
EYE_CX, EYE_CY = 0.500, 0.505
EYE_RX, EYE_RY = 0.345, 0.225
RING_HALF = 0.038                 # half stroke thickness of the eye outline
PUPIL_R = 0.088
PUPIL_HALF = 0.026                # half stroke thickness of the pupil outline

SLASH_AX, SLASH_AY = 0.150, 0.845
SLASH_BX, SLASH_BY = 0.850, 0.175
SLASH_HALF = 0.060

CORNER_R = 0.225


def _rounded_square_inside(u, v):
    dx = max(abs(u - 0.5) - (0.5 - CORNER_R), 0.0)
    dy = max(abs(v - 0.5) - (0.5 - CORNER_R), 0.0)
    return (dx * dx + dy * dy) <= CORNER_R * CORNER_R


def _is_white(u, v):
    # Eye outline: a roughly constant-thickness elliptical ring. The distance to
    # the ellipse is approximated with the level-set gradient, which keeps the
    # stroke from bulging at the ends the way a raw d-threshold would.
    d = ((u - EYE_CX) / EYE_RX) ** 2 + ((v - EYE_CY) / EYE_RY) ** 2
    grad = math.hypot((u - EYE_CX) / (EYE_RX ** 2), (v - EYE_CY) / (EYE_RY ** 2))
    white = grad > 0 and abs(d - 1.0) / grad <= RING_HALF

    # Pupil, drawn as an outline so the slash reads as passing over it rather
    # than chopping a solid disc into two crescents.
    pupil_distance = math.hypot(u - EYE_CX, v - EYE_CY)
    if abs(pupil_distance - PUPIL_R) <= PUPIL_HALF:
        white = True

    # Slash punched out in the background colour, which is what makes the glyph
    # read as "hidden" rather than just "eye".
    vx, vy = SLASH_BX - SLASH_AX, SLASH_BY - SLASH_AY
    t = ((u - SLASH_AX) * vx + (v - SLASH_AY) * vy) / (vx * vx + vy * vy)
    t = min(1.0, max(0.0, t))
    px, py = SLASH_AX + vx * t, SLASH_AY + vy * t
    if math.hypot(u - px, v - py) <= SLASH_HALF:
        white = False

    return white


def _sample(u, v):
    """Return (r, g, b, a) for one point, premultiplied-free."""
    if not _rounded_square_inside(u, v):
        return (0, 0, 0, 0)
    return (*FG, 255) if _is_white(u, v) else (*BG, 255)


def render(size):
    """Return raw RGBA bytes for a size x size icon."""
    rows = bytearray()
    step = 1.0 / (size * SS)
    for y in range(size):
        rows.append(0)  # PNG filter type 0
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    u = (x * SS + sx + 0.5) * step
                    v = (y * SS + sy + 0.5) * step
                    pr, pg, pb, pa = _sample(u, v)
                    alpha = pa / 255.0
                    # Accumulate premultiplied so transparent pixels do not
                    # darken the edge.
                    r += pr * alpha
                    g += pg * alpha
                    b += pb * alpha
                    a += alpha
            n = SS * SS
            if a == 0:
                rows += bytes((0, 0, 0, 0))
            else:
                rows += bytes((
                    int(round(r / a)),
                    int(round(g / a)),
                    int(round(b / a)),
                    int(round(a / n * 255)),
                ))
    return bytes(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)
    return len(png)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "images")
    os.makedirs(out, exist_ok=True)

    for size in (16, 32, 48, 128):
        path = os.path.join(out, "icon%d.png" % size)
        written = write_png(path, size, render(size))
        print("wrote %s (%d bytes)" % (os.path.relpath(path, root), written))


if __name__ == "__main__":
    main()
