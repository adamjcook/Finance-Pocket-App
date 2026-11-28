"""Draws the page background's contour lines (src/assets/bg-contours.svg).

An abstract topographic map: a few smooth hills summed into one height field,
traced at evenly spaced heights with marching squares. Strokes are white; the
app uses the file as a mask and colours it from the theme, so one file serves
both light and dark. Run: python3 scripts/gen-contours.py
"""
import math
from pathlib import Path

W, H = 900, 1600          # portrait, like the phone it fills
STEP = 10                 # grid spacing for tracing
LEVELS = 26

# (x, y, radius, height): a main rise off the top-right, a shoulder lower left,
# and a soft hollow, so the lines bunch and spread rather than ring evenly.
HILLS = [
    (760, 180, 520, 1.00),
    (120, 1180, 460, 0.62),
    (560, 860, 300, -0.28),
    (300, 420, 260, 0.22),
]


def height(x: float, y: float) -> float:
    h = 0.12 * (1 - y / H)  # the land rises gently toward the top
    for cx, cy, r, a in HILLS:
        h += a * math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r))
    # A slow ripple keeps the lines from looking machined.
    h += 0.025 * math.sin(x / 140 + y / 210) * math.cos(y / 170 - x / 330)
    return h


cols, rows = W // STEP + 1, H // STEP + 1
grid = [[height(i * STEP, j * STEP) for i in range(cols)] for j in range(rows)]
lo = min(min(r) for r in grid)
hi = max(max(r) for r in grid)


def lerp(p, q, vp, vq, lvl):
    t = (lvl - vp) / (vq - vp)
    return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))


def trace(level):
    segs = []
    for j in range(rows - 1):
        for i in range(cols - 1):
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            v = [grid[y][x] for x, y in c]
            pts = [(x * STEP, y * STEP) for x, y in c]
            cross = []
            for k in range(4):
                a, b = k, (k + 1) % 4
                if (v[a] >= level) != (v[b] >= level):
                    cross.append(lerp(pts[a], pts[b], v[a], v[b], level))
            if len(cross) == 2:
                segs.append(tuple(cross))
            elif len(cross) == 4:
                segs.append((cross[0], cross[1]))
                segs.append((cross[2], cross[3]))
    # Join segments that share ends into lines.
    key = lambda p: (round(p[0], 3), round(p[1], 3))
    ends = {}
    for n, (a, b) in enumerate(segs):
        ends.setdefault(key(a), []).append(n)
        ends.setdefault(key(b), []).append(n)
    used = [False] * len(segs)
    lines = []
    for n in range(len(segs)):
        if used[n]:
            continue
        used[n] = True
        line = list(segs[n])
        for forward in (True, False):
            while True:
                tip = line[-1] if forward else line[0]
                nxt = next((m for m in ends.get(key(tip), []) if not used[m]), None)
                if nxt is None:
                    break
                used[nxt] = True
                a, b = segs[nxt]
                far = b if key(a) == key(tip) else a
                line.append(far) if forward else line.insert(0, far)
        if len(line) > 6:
            lines.append(line[::2] + ([line[-1]] if len(line) % 2 == 0 else []))
    return lines


def smooth(line):
    """Catmull-Rom through the points, as cubic Béziers."""
    p = line
    d = f"M{p[0][0]:.0f} {p[0][1]:.0f}"
    for k in range(len(p) - 1):
        p0 = p[k - 1] if k else p[k]
        p1, p2 = p[k], p[k + 1]
        p3 = p[k + 2] if k + 2 < len(p) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {p2[0]:.0f} {p2[1]:.0f}"
    return d


paths = []
for n in range(1, LEVELS):
    level = lo + (hi - lo) * n / LEVELS
    # Every fifth line is an index contour, a touch heavier, as on a real map.
    width = 1.6 if n % 5 == 0 else 0.9
    for line in trace(level):
        paths.append(f'<path d="{smooth(line)}" stroke-width="{width}"/>')

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">'
    f'<g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">{"".join(paths)}</g></svg>\n'
)
out = Path(__file__).resolve().parent.parent / "src" / "assets" / "bg-contours.svg"
out.write_text(svg)
print(f"{out.name}: {len(paths)} lines, {len(svg) // 1024} KB")
