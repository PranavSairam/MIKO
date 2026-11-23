import { parentPort, workerData } from 'node:worker_threads'
import { extractFile } from './knowledge-extract'

/** One file per worker thread: parsing never blocks MIKO's main process, and a stuck file can be stopped. */
const { path, kind } = workerData as { path: string; kind: 'txt' | 'md' | 'pdf' | 'docx' }
extractFile(path, kind)
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((error) => parentPort?.postMessage({ ok: false, error: String((error as Error)?.message || error).slice(0, 200) }))
