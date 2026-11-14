import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resources = join(root, 'resources')

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 4 + 1)
    raw[start] = 0
    rgba.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function bean(nx, ny, cx, cy, rx, ry) {
  const dx = (nx - cx) / rx
  const dy = (ny - cy) / ry
  const distance = Math.hypot(dx, dy)
  if (distance >= 1) return 0
  if (distance <= 0.78) return 1
  return (1 - distance) / 0.22
}

function pawAlpha(x, y, size) {
  const nx = (x + 0.5) / size
  const ny = (y + 0.5) / size
  return Math.max(
    bean(nx, ny, 0.48, 0.64, 0.23, 0.2),
    bean(nx, ny, 0.32, 0.34, 0.11, 0.13),
    bean(nx, ny, 0.48, 0.24, 0.12, 0.14),
    bean(nx, ny, 0.66, 0.32, 0.11, 0.13),
    bean(nx, ny, 0.76, 0.48, 0.095, 0.11)
  )
}

function render(size, color) {
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = Math.round(pawAlpha(x, y, size) * 255)
      const offset = (y * size + x) * 4
      rgba[offset] = color[0]
      rgba[offset + 1] = color[1]
      rgba[offset + 2] = color[2]
      rgba[offset + 3] = alpha
    }
  }
  return encodePng(size, size, rgba)
}

mkdirSync(resources, { recursive: true })
writeFileSync(join(resources, 'tray-mac.png'), render(22, [0, 0, 0]))
writeFileSync(join(resources, 'tray-win.png'), render(32, [166, 98, 58]))
