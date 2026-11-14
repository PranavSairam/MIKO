import { screen } from 'electron'
import { IPC } from '../shared/api'
import { POINTER_INTERVAL_MS, pointerWatch } from '../shared/look'
import { isPetVisible, petContentFrame, postToPet } from './pet-window'

let timer: NodeJS.Timeout | null = null

function publish(): void {
  if (!isPetVisible()) {
    watchPointer(false)
    return
  }
  const frame = petContentFrame()
  if (!frame) return
  const cursor = screen.getCursorScreenPoint()
  postToPet(IPC.pointer, {
    x: cursor.x,
    y: cursor.y,
    windowX: frame.x,
    windowY: frame.y,
    scaleFactor: frame.scaleFactor
  })
}

/** One poll for the whole process. A second show does not start another timer. */
export function watchPointer(visible: boolean): void {
  const next = pointerWatch(timer !== null, visible)
  if (next === 'keep') return
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (next === 'stop') return
  publish()
  timer = setInterval(publish, POINTER_INTERVAL_MS)
}
