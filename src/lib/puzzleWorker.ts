import { buildPuzzleFromGrid, hasUniqueSolution, randomGrid, type Puzzle } from './puzzle'

type WorkerRequest = {
  id: number
  size: number
  maxAttempts: number
  workerIndex: number
}

type WorkerCancel = {
  id: number
  cancel: true
}

type WorkerResponse =
  | { id: number; type: 'result'; ok: true; puzzle: Puzzle }
  | { id: number; type: 'result'; ok: false; message: string }
  | { id: number; type: 'progress'; attempt: number; maxAttempts: number; elapsed: number; workerIndex: number }

type WorkerContext = {
  postMessage: (message: WorkerResponse) => void
  addEventListener: (
    type: 'message' | 'error',
    listener: (event: MessageEvent<WorkerRequest>) => void
  ) => void
}

const ctx = self as unknown as WorkerContext
let activeTaskId: number | null = null
let cancelled = false

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest | WorkerCancel>) => {
  const data = event.data
  if ('cancel' in data && data.cancel) {
    if (activeTaskId === data.id) {
      cancelled = true
    }
    return
  }

  if (!('size' in data)) {
    return
  }

  const { id, size, maxAttempts, workerIndex } = data
  try {
    activeTaskId = id
    cancelled = false
    const densityRange: Record<number, [number, number]> = {
      5: [0.35, 0.65],
      10: [0.3, 0.55],
      15: [0.28, 0.48],
      20: [0.26, 0.45]
    }
    const range = densityRange[size] ?? [0.25, 0.5]
    const start = performance.now()

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancelled) {
        const response: WorkerResponse = {
          id,
          type: 'result',
          ok: false,
          message: 'Puzzle generation cancelled.'
        }
        ctx.postMessage(response)
        return
      }
      const grid = randomGrid(size, range)
      const candidate = buildPuzzleFromGrid(grid, `Random practice ${size}x${size}`)
      if (hasUniqueSolution(candidate.rows, candidate.cols, size)) {
        const response: WorkerResponse = { id, type: 'result', ok: true, puzzle: candidate }
        ctx.postMessage(response)
        return
      }

      const elapsed = (performance.now() - start) / 1000
      const progress: WorkerResponse = {
        id,
        type: 'progress',
        attempt,
        maxAttempts,
        elapsed,
        workerIndex
      }
      ctx.postMessage(progress)
    }

    const response: WorkerResponse = {
      id,
      type: 'result',
      ok: false,
      message: `Unable to find a unique ${size}x${size} puzzle after ${maxAttempts} attempts.`
    }
    ctx.postMessage(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build puzzle.'
    const response: WorkerResponse = { id, type: 'result', ok: false, message }
    ctx.postMessage(response)
  } finally {
    if (activeTaskId === id) {
      activeTaskId = null
      cancelled = false
    }
  }
})
