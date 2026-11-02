"""Draw report charts from data as SVG, with a text-free PNG fallback.

Pure Python on purpose: the server image has python3 without packages. SVG is
what PowerPoint 2016+/365 and the web preview show; the PNG is only the
fallback Office requires for applications that cannot read SVG.
"""

import math
import struct
import zlib
from html import escape

FONT = "Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif"
DOUYIN, DOUYIN_LIGHT, WECHAT, WECHAT_LIGHT = "#FF2222", "#E6A3AB", "#0B9A46", "#93D39F"
DOUYIN_LINE, WECHAT_LINE = "#E60012", "#1A8A3C"


def nice_axis(maximum, intervals, headroom):
    """Axis top and step: about `intervals` steps of 1/2/2.5/4/5 x 10^n above maximum*headroom."""
    wanted = max(float(maximum or 0), 1.0) * headroom
    raw = wanted / intervals
    magnitude = 10 ** math.floor(math.log10(raw))
    step = min((factor * magnitude for factor in (1, 2, 2.5, 4, 5, 10)), key=lambda value: abs(math.log(value / raw)))
    return math.ceil(wanted / step) * step, step


def text_width(value, size, bold=False):
    """Generous width estimate so labels that would touch are treated as overlapping."""
    return sum(size * (1.0 if ord(char) > 0x2E80 else 0.62 if bold else 0.58) for char in value)


def label_box(x, baseline, value, size, bold=False, anchor="middle"):
    width = text_width(value, size, bold)
    left = x - width / 2 if anchor == "middle" else x - width if anchor == "end" else x
    return (left - 1, baseline - size * 0.82, left + width + 1, baseline + size * 0.22)


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def crosses(box, polyline, margin=3):
    """Whether a polyline passes through a box (checked along the box's width)."""
    for (ax, ay), (bx, by) in zip(polyline, polyline[1:]):
        left, right = max(box[0], min(ax, bx)), min(box[2], max(ax, bx))
        if left > right:
            continue
        ys = [ay + (by - ay) * ((x - ax) / (bx - ax) if bx != ax else 0) for x in (left, right)]
        if min(ys) - margin < box[3] and max(ys) + margin > box[1]:
            return True
    return False


def number(value, decimals):
    text = f"{value:,.{decimals}f}"
    return text


class Svg:
    def __init__(self, width, height):
        self.width, self.height, self.items = width, height, []

    def rect(self, x, y, w, h, fill):
        self.items.append(("rect", x, y, w, h, fill))

    def line(self, points, color, width, dash=None):
        self.items.append(("line", points, color, width, dash))

    def circle(self, x, y, r, fill):
        self.items.append(("circle", x, y, r, fill))

    def text(self, x, y, value, size, color="#222222", anchor="middle", bold=False, rotate=0):
        self.items.append(("text", x, y, value, size, color, anchor, bold, rotate))

    def svg(self):
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width:.0f}" height="{self.height:.0f}" '
               f'viewBox="0 0 {self.width:.2f} {self.height:.2f}" font-family="{FONT}">']
        for item in self.items:
            kind = item[0]
            if kind == "rect":
                _, x, y, w, h, fill = item
                out.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{fill}"/>')
            elif kind == "line":
                _, points, color, width, dash = item
                path = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
                extra = f' stroke-dasharray="{dash}"' if dash else ""
                out.append(f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="{width}"{extra}/>')
            elif kind == "circle":
                _, x, y, r, fill = item
                out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{fill}"/>')
            else:
                _, x, y, value, size, color, anchor, bold, rotate = item
                transform = f' transform="rotate({rotate} {x:.2f} {y:.2f})"' if rotate else ""
                weight = ' font-weight="bold"' if bold else ""
                out.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" fill="{color}" text-anchor="{anchor}"'
                           f'{weight}{transform}>{escape(value)}</text>')
        out.append("</svg>")
        return "".join(out)

    def png(self, scale=2):
        """Shapes only; text needs a font rasteriser the server does not have."""
        width, height = round(self.width * scale), round(self.height * scale)
        pixels = bytearray(b"\xff" * (width * height * 3))

        def colour(value):
            return bytes(int(value[index:index + 2], 16) for index in (1, 3, 5))

        def fill(x0, y0, x1, y1, rgb):
            x0, x1 = max(0, round(x0 * scale)), min(width, round(x1 * scale))
            for y in range(max(0, round(y0 * scale)), min(height, round(y1 * scale))):
                if x1 > x0:
                    pixels[(y * width + x0) * 3:(y * width + x1) * 3] = rgb * (x1 - x0)

        for item in self.items:
            if item[0] == "rect":
                _, x, y, w, h, value = item
                fill(x, y, x + w, y + h, colour(value))
            elif item[0] == "line":
                _, points, value, line_width, dash = item
                rgb, half = colour(value), line_width / 2
                pattern = [float(part) for part in dash.split()] if dash else None
                for (ax, ay), (bx, by) in zip(points, points[1:]):
                    length = math.hypot(bx - ax, by - ay) or 1
                    for index in range(int(length * scale) + 1):
                        t = index / (length * scale)
                        if pattern and (t * length) % sum(pattern) > pattern[0]:
                            continue
                        x, y = ax + (bx - ax) * t, ay + (by - ay) * t
                        fill(x - half, y - half, x + half, y + half, rgb)
            elif item[0] == "circle":
                _, cx, cy, r, value = item
                rgb = colour(value)
                for dy in range(-round(r * scale), round(r * scale) + 1):
                    dx = math.sqrt(max(0, (r * scale) ** 2 - dy ** 2)) / scale
                    fill(cx - dx, cy + dy / scale, cx + dx, cy + dy / scale + 1 / scale, rgb)
        raw = b"".join(b"\x00" + bytes(pixels[row * width * 3:(row + 1) * width * 3]) for row in range(height))

        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ads_trend(months, width, height):
    """Material volume (stacked bars, left axis) and advertising games (lines, right axis).

    months: [{"label", "douyin": (info, talent, total) or None, "wechat": (...) or None,
              "douyinGames", "wechatGames"}]; None means no data, the slot stays empty.
    """
    canvas = Svg(width, height)
    canvas.rect(0, 0, width, height, "#FFFFFF")
    left, right, top, bottom = 0.110 * width, 0.903 * width, 0.147 * height, 0.886 * height
    totals = [stack[2] for item in months for stack in (item["douyin"], item["wechat"]) if stack]
    games = [value for item in months for value in (item["douyinGames"], item["wechatGames"]) if value is not None]
    left_top, left_step = nice_axis(max(totals, default=0), 9, 1.08)
    right_top, right_step = nice_axis(max(games, default=0), 7, 1.2)
    y_left = lambda value: bottom - (bottom - top) * value / left_top
    y_right = lambda value: bottom - (bottom - top) * value / right_top

    tick = 0
    while tick <= left_top + 1e-9:
        y = y_left(tick)
        if tick:
            canvas.line([(left, y), (right, y)], "#E6E6E6", 0.8, "3 3")
        canvas.text(left - 6, y + 4, f"{tick:g}", 11, anchor="end")
        tick += left_step
    tick = 0
    while tick <= right_top + 1e-9:
        canvas.text(right + 6, y_right(tick) + 4, f"{tick:g}", 11, anchor="start")
        tick += right_step
    canvas.text(0.035 * width, (top + bottom) / 2, "素材数（万条）", 12, rotate=-90)
    canvas.text(0.975 * width, (top + bottom) / 2, "在投游戏数（款）", 12, rotate=90)

    slot = (right - left) / max(len(months), 1)
    bar, offset = 0.25 * slot, 0.175 * slot
    lines, segments, placed = {"douyin": [], "wechat": []}, [], []
    for index, item in enumerate(months):
        centre = left + (index + 0.5) * slot
        canvas.text(centre, bottom + 19, item["label"], 11.5)
        for name, side, dark, light in (("douyin", -1, DOUYIN, DOUYIN_LIGHT), ("wechat", 1, WECHAT, WECHAT_LIGHT)):
            stack = item[name]
            if stack:
                info, talent, total = stack
                x = centre + side * offset - bar / 2
                canvas.rect(x, y_left(info), bar, bottom - y_left(info), dark)
                canvas.rect(x, y_left(info + talent), bar, y_left(info) - y_left(info + talent), light)
                segments.append((x, info, talent, total, dark))
            value = item[name + "Games"]
            if value is not None:
                lines[name].append((centre, y_right(value), value))
    polylines = [[(x, y) for x, y, _ in points] for points in lines.values() if points]
    markers = [(x - 6, y - 6, x + 6, y + 6) for points in lines.values() for x, y, _ in points]

    def free(box, avoid_lines=True):
        return not any(overlaps(box, other) for other in placed + markers) and \
            not (avoid_lines and any(crosses(box, line) for line in polylines))

    def put(x, candidates, value, size, color, bold=False, avoid_lines=True):
        """Draw at the first free baseline; fall back to the first one."""
        for baseline in candidates:
            if free(label_box(x, baseline, value, size, bold), avoid_lines):
                break
        else:
            baseline = candidates[0]
        placed.append(label_box(x, baseline, value, size, bold))
        canvas.text(x, baseline, value, size, color, bold=bold)

    for x, info, talent, total, dark in segments:
        centre = x + bar / 2
        put(centre, [y_left(max(total, info + talent)) - 5], number(total, 1), 11, dark, True, False)
        if bottom - y_left(info) >= 15:
            put(centre, [(bottom + y_left(info)) / 2 + 4], number(info, 1), 10.5, "#FFFFFF", True, False)
    for x, info, talent, total, dark in segments:
        upper, lower = y_left(info + talent), y_left(info)
        if lower - upper >= 15:
            middle = (upper + lower) / 2 + 4
            spots = [middle + shift for shift in (0, -14, 14, -28, 28, -42, 42) if upper + 11 <= middle + shift <= lower - 2]
            put(x + bar / 2, spots or [middle], number(talent, 1), 10, "#333333")
    for name, color, dash in (("douyin", DOUYIN_LINE, None), ("wechat", WECHAT_LINE, "7 4")):
        points = lines[name]
        if len(points) > 1:
            canvas.line([(x, y) for x, y, _ in points], color, 2.4, dash)
        for x, y, value in points:
            if name == "douyin":
                canvas.circle(x, y, 4.5, color)
            else:
                canvas.rect(x - 4, y - 4, 8, 8, color)
    for name, color in (("douyin", DOUYIN_LINE), ("wechat", WECHAT_LINE)):
        for x, y, value in lines[name]:
            put(x, [y - 9, y + 19, y - 21, y + 31], number(value, 0), 11, color, True)
    canvas.line([(left, top), (left, bottom), (right, bottom), (right, top)], "#333333", 1)

    tiny = all((item["wechat"] or (0, 0, 0))[1] < 1 for item in months)
    legend = [(0.239, 0.057, "bar", DOUYIN, "抖音信息流广告"), (0.239, 0.102, "bar", DOUYIN_LIGHT, "抖音达人广告"),
              (0.397, 0.057, "bar", WECHAT, "微信信息流广告"),
              (0.397, 0.102, "bar", WECHAT_LIGHT, "微信达人广告（极少）" if tiny else "微信达人广告"),
              (0.600, 0.057, "douyin", DOUYIN_LINE, "抖音游戏数（右轴）"), (0.600, 0.102, "wechat", WECHAT_LINE, "微信游戏数（右轴）")]
    for fx, fy, kind, color, label in legend:
        x, y = fx * width, fy * height
        if kind == "bar":
            canvas.rect(x, y - 5, 22, 10, color)
        else:
            canvas.line([(x, y), (x + 22, y)], color, 2.4, "5 3" if kind == "wechat" else None)
            if kind == "douyin":
                canvas.circle(x + 11, y, 4, color)
            else:
                canvas.rect(x + 7, y - 4, 8, 8, color)
        canvas.text(x + 28, y + 4, label, 10, anchor="start")
    return canvas.svg(), canvas.png()
