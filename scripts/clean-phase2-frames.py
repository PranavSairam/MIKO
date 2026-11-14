"""Remove the colored cutout halo from the Phase 2 frames.

The source PNGs keep a red, yellow, and white fringe in pixels whose alpha is
under about 40. Fur-colored partial alpha, including soft edges, is left
alone. Contaminated pixels near the body keep their alpha and take the
nearest solid fur color. Floating specks farther out lose only their alpha.
"""

from __future__ import annotations

import struct
import zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/renderer/src/assets/miko-phase2-frames"
TARGET = ROOT / "src/renderer/src/assets/miko-phase2-cleaned"
NAMES = ("rest.png", "blink.png", "pet.png", "curious.png")
SOLID_ALPHA = 200
SPECK_DISTANCE = 14


def read_png(path: Path) -> tuple[int, int, list[bytearray]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    pos = 8
    width = height = None
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color = struct.unpack(">IIBB", chunk[:10])
            if bit_depth != 8 or color != 6:
                raise SystemExit(f"{path} must be 8-bit RGBA")
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    if width is None or height is None:
        raise SystemExit(f"{path} has no header")
    raw = zlib.decompress(idat)
    rows: list[bytearray] = []
    stride = width * 4
    index = 0
    previous = bytearray(stride)
    for _y in range(height):
        filter_type = raw[index]
        index += 1
        row = bytearray(raw[index : index + stride])
        index += stride
        if filter_type == 1:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                row[x] = (row[x] + left) & 255
        elif filter_type == 2:
            for x in range(stride):
                row[x] = (row[x] + previous[x]) & 255
        elif filter_type == 3:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                row[x] = (row[x] + ((left + previous[x]) // 2)) & 255
        elif filter_type == 4:
            for x in range(stride):
                left = row[x - 4] if x >= 4 else 0
                up = previous[x]
                up_left = previous[x - 4] if x >= 4 else 0
                estimate = left + up - up_left
                distance_left = abs(estimate - left)
                distance_up = abs(estimate - up)
                distance_up_left = abs(estimate - up_left)
                if distance_left <= distance_up and distance_left <= distance_up_left:
                    predictor = left
                elif distance_up <= distance_up_left:
                    predictor = up
                else:
                    predictor = up_left
                row[x] = (row[x] + predictor) & 255
        elif filter_type != 0:
            raise SystemExit(f"unsupported PNG filter {filter_type}")
        rows.append(row)
        previous = row
    return width, height, rows


def write_png(path: Path, width: int, height: int, rows: list[bytearray]) -> None:
    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw.extend(row)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def contaminated(red: int, green: int, blue: int, alpha: int) -> bool:
    if alpha == 0 or alpha > 40:
        return False
    if red > 160 and red > green + 70 and red > blue + 70:
        return True
    if red > 180 and green > 140 and blue < 110 and red > blue + 80:
        return True
    if min(red, green, blue) > 200:
        return True
    return False


def clean(width: int, height: int, rows: list[bytearray]) -> tuple[int, int]:
    nearest = [None] * (width * height)
    distance = [99] * (width * height)
    queue: deque[int] = deque()
    for y, row in enumerate(rows):
        for x in range(width):
            red, green, blue, alpha = row[x * 4 : x * 4 + 4]
            if alpha >= SOLID_ALPHA:
                index = y * width + x
                nearest[index] = (red, green, blue)
                distance[index] = 0
                queue.append(index)
    while queue:
        index = queue.popleft()
        current = distance[index]
        if current >= SPECK_DISTANCE:
            continue
        color = nearest[index]
        x = index % width
        y = index // width
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if next_x < 0 or next_y < 0 or next_x >= width or next_y >= height:
                continue
            next_index = next_y * width + next_x
            if distance[next_index] <= current + 1:
                continue
            distance[next_index] = current + 1
            nearest[next_index] = color
            queue.append(next_index)

    recolored = 0
    removed = 0
    for y, row in enumerate(rows):
        for x in range(width):
            offset = x * 4
            red, green, blue, alpha = row[offset : offset + 4]
            if not contaminated(red, green, blue, alpha):
                continue
            color = nearest[y * width + x]
            if color is None:
                row[offset + 3] = 0
                removed += 1
            else:
                row[offset] = color[0]
                row[offset + 1] = color[1]
                row[offset + 2] = color[2]
                recolored += 1
    return recolored, removed


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        width, height, rows = read_png(SOURCE / name)
        recolored, removed = clean(width, height, rows)
        write_png(TARGET / name, width, height, rows)
        print(f"{name}: recolored {recolored}, removed specks {removed}")


if __name__ == "__main__":
    main()
