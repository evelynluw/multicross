import type { Puzzle } from './puzzle'

type WorkerProgress = {
  type: 'progress'
  attempt: number
  maxAttempts: number
  elapsed: number
  workerIndex: number
}

type WorkerResult = {
  type: 'result'
  puzzle: Puzzle
}

type WorkerError = {
  type: 'error'
  message: string
}

export type WorkerEvent = WorkerProgress | WorkerResult | WorkerError

type PendingGeneration = {
  resolve: (puzzle: Puzzle) => void
  reject: (reason?: string) => void
  remaining: number
  generationId: number
  maxAttemptsPerWorker: number
}

export class PuzzleWorkerPool {
  private workerPool: Worker[] = []
  private workerById = new Map<number, Worker>()
  private workerGenerationMap = new Map<number, number>()
  private pendingGeneration: PendingGeneration | null = null
  private activeWorkerIds: number[] = []
  private generationId = 0
  private requestId = 0
  private desiredCount = 0
  private onEvent?: (event: WorkerEvent) => void

  constructor(workerCount: number, onEvent?: (event: WorkerEvent) => void) {
    this.onEvent = onEvent
    this.setWorkerCount(workerCount)
  }

  setWorkerCount(count: number) {
    this.desiredCount = count
    this.terminateAll()
    if (typeof Worker === 'undefined') {
      return
    }
    this.workerPool = Array.from({ length: count }, () => {
      const worker = new Worker(new URL('./puzzleWorker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', this.handleWorkerMessage)
      worker.addEventListener('error', () => {
        if (!this.pendingGeneration) {
          return
        }
        this.pendingGeneration.remaining -= 1
        if (this.pendingGeneration.remaining <= 0) {
          this.pendingGeneration.reject('Puzzle generator worker failed.')
          this.resetGenerationState()
        }
      })
      return worker
    })
  }

  get size() {
    return this.workerPool.length
  }

  generate(size: number, maxAttemptsPerWorker: number, requireUnique: boolean): Promise<Puzzle> {
    if (!this.workerPool.length) {
      return Promise.reject('Puzzle generator worker not available.')
    }
    return new Promise<Puzzle>((resolve, reject) => {
      if (this.pendingGeneration) {
        reject('Puzzle generation already in progress.')
        return
      }
      this.generationId += 1
      this.pendingGeneration = {
        resolve,
        reject,
        remaining: this.workerPool.length,
        generationId: this.generationId,
        maxAttemptsPerWorker
      }
      this.activeWorkerIds = []
      this.workerPool.forEach((worker, index) => {
        const id = this.requestId++
        this.workerGenerationMap.set(id, this.generationId)
        this.workerById.set(id, worker)
        this.activeWorkerIds.push(id)
        worker.postMessage({ id, size, maxAttempts: maxAttemptsPerWorker, workerIndex: index, requireUnique })
      })
    })
  }

  cancel() {
    this.cancelActiveWorkers()
    this.restartWorkers()
  }

  dispose() {
    this.terminateAll()
  }

  private handleWorkerMessage = (event: MessageEvent) => {
    const data = event.data as
      | { id: number; type: 'progress'; attempt: number; maxAttempts: number; elapsed: number; workerIndex: number }
      | { id: number; type: 'result'; ok: boolean; puzzle?: Puzzle; message?: string }
    if (!this.pendingGeneration) {
      return
    }
    const workerGen = this.workerGenerationMap.get(data.id)
    if (workerGen !== this.pendingGeneration.generationId) {
      return
    }
    if (data.type === 'progress') {
      this.onEvent?.({
        type: 'progress',
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
        elapsed: data.elapsed,
        workerIndex: data.workerIndex
      })
      return
    }
    if (data.type === 'result' && data.ok && data.puzzle) {
      this.onEvent?.({ type: 'result', puzzle: data.puzzle })
      this.pendingGeneration.resolve(data.puzzle)
      this.cancelActiveWorkers()
      this.restartWorkers()
      return
    }
    this.pendingGeneration.remaining -= 1
    if (this.pendingGeneration.remaining <= 0) {
      const message = data.message ?? 'Unable to build puzzle.'
      this.onEvent?.({ type: 'error', message })
      this.pendingGeneration.reject(message)
      this.resetGenerationState()
    }
  }

  private cancelActiveWorkers() {
    for (const id of this.activeWorkerIds) {
      const worker = this.workerById.get(id)
      if (worker) {
        worker.postMessage({ id, cancel: true })
      }
    }
    this.resetGenerationState()
  }

  private resetGenerationState() {
    this.pendingGeneration = null
    this.activeWorkerIds = []
    this.workerGenerationMap.clear()
    this.workerById.clear()
  }

  private restartWorkers() {
    const count = this.desiredCount
    this.terminateAll()
    if (count > 0) {
      this.setWorkerCount(count)
    }
  }

  private terminateAll() {
    this.workerPool.forEach((worker) => worker.terminate())
    this.workerPool = []
    this.workerById.clear()
    this.workerGenerationMap.clear()
    this.pendingGeneration = null
    this.activeWorkerIds = []
  }
}
