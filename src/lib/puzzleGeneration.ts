import { tick } from 'svelte'
import { get, writable } from 'svelte/store'
import { generateRandomPuzzle, type Puzzle } from './puzzle'
import { PuzzleWorkerPool, type WorkerEvent } from './puzzleWorkerPool'

export type WorkerStatus = { index: number; attempts: number; elapsed: number; message: string }

export type PuzzleGenerationState = {
  generating: boolean
  generatorError: string
  workerPoolSize: number
  maxWorkerCount: number
  workerCount: number
  progressAttempt: number
  progressMaxAttempts: number
  progressElapsed: number
  progressMessage: string
  totalAttempts: number
  workerStatuses: WorkerStatus[]
  showGenerationLogs: boolean
}

type PuzzleGenerationOptions = {
  getEnsureUniqueness: () => boolean
  getLastPuzzle: () => Puzzle
  onLoadPuzzle: (nextPuzzle: Puzzle) => void
}

// Build the default generation state snapshot.
const createInitialState = (): PuzzleGenerationState => ({
  generating: false,
  generatorError: '',
  workerPoolSize: 0,
  maxWorkerCount: 1,
  workerCount: 1,
  progressAttempt: 0,
  progressMaxAttempts: 0,
  progressElapsed: 0,
  progressMessage: '',
  totalAttempts: 0,
  workerStatuses: [],
  showGenerationLogs: true
})

// Yield to the next animation frame for smoother UI updates.
const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      setTimeout(() => resolve(), 0)
      return
    }
    requestAnimationFrame(() => resolve())
  })

// Create a controller that encapsulates all puzzle generation state and actions.
export const createPuzzleGenerationController = (options: PuzzleGenerationOptions) => {
  const state = writable<PuzzleGenerationState>(createInitialState())
  let workerPool: PuzzleWorkerPool | null = null
  let progressTimer: ReturnType<typeof setInterval> | null = null
  let progressStart = 0

  // Merge partial state updates into the generation store.
  const updateState = (partial: Partial<PuzzleGenerationState>) =>
    state.update((current) => ({ ...current, ...partial }))

  // Begin the elapsed-time timer for generation progress.
  const startProgressTimer = () => {
    progressStart = performance.now()
    updateState({ progressElapsed: 0 })
    progressTimer = setInterval(() => {
      updateState({ progressElapsed: (performance.now() - progressStart) / 1000 })
    }, 100)
  }

  // Stop the progress timer and store the final elapsed time.
  const stopProgressTimer = () => {
    if (progressTimer) {
      clearInterval(progressTimer)
      progressTimer = null
    }
    updateState({ progressElapsed: (performance.now() - progressStart) / 1000 })
  }

  // Handle worker progress and error events by updating state.
  const handleWorkerEvent = (event: WorkerEvent) => {
    if (event.type === 'progress') {
      const current = get(state)
      const totalAttempts = current.totalAttempts + 1
      const progressMaxAttempts = event.maxAttempts * current.workerPoolSize
      updateState({
        totalAttempts,
        progressAttempt: totalAttempts,
        progressMaxAttempts,
        progressMessage: `Attempting to find a puzzle: ${Math.max(0, totalAttempts - 1)} failed checks across ${current.workerPoolSize} workers…`,
        workerStatuses: current.workerStatuses.map((status) =>
          status.index === event.workerIndex
            ? {
                ...status,
                attempts: event.attempt,
                elapsed: event.elapsed,
                message: `Worker ${event.workerIndex + 1}: attempt ${event.attempt}/${event.maxAttempts}`
              }
            : status
        )
      })
      return
    }
    if (event.type === 'error') {
      updateState({ generatorError: event.message })
    }
  }

  // Create or resize the worker pool and keep counts in sync.
  const rebuildWorkerPool = (count: number) => {
    const current = get(state)
    const safeCount = Math.max(1, Math.min(count, current.maxWorkerCount))
    updateState({ workerPoolSize: safeCount, workerCount: safeCount })
    if (typeof Worker === 'undefined') {
      workerPool = null
      updateState({ workerPoolSize: 0 })
      return
    }
    if (!workerPool) {
      workerPool = new PuzzleWorkerPool(safeCount, handleWorkerEvent)
      return
    }
    workerPool.setWorkerCount(safeCount)
  }

  // Generate a puzzle via workers or fall back to the sync generator.
  const generatePuzzleAsync = (size: number) => {
    const current = get(state)
    if (workerPool && current.workerPoolSize > 0) {
      const maxAttemptsPerWorker = 300
      const requireUnique = options.getEnsureUniqueness()
      updateState({
        totalAttempts: 0,
        progressAttempt: 0,
        progressMaxAttempts: current.workerPoolSize * maxAttemptsPerWorker,
        progressElapsed: 0,
        progressMessage: 'Starting parallel puzzle search…',
        workerStatuses: Array.from({ length: current.workerPoolSize }, (_worker, index) => ({
          index,
          attempts: 0,
          elapsed: 0,
          message: `Worker ${index + 1}: starting…`
        }))
      })
      return workerPool.generate(size, maxAttemptsPerWorker, requireUnique)
    }
    return Promise.resolve(generateRandomPuzzle(size, 600, options.getEnsureUniqueness()))
  }

  // Initialize the worker pool with a safe default worker count.
  const initialize = () => {
    if (typeof Worker !== 'undefined') {
      const maxWorkerCount = Math.max(1, navigator.hardwareConcurrency ?? 4)
      const workerCount = Math.max(1, Math.min(maxWorkerCount, Math.max(2, maxWorkerCount - 1)))
      updateState({ maxWorkerCount, workerCount })
      rebuildWorkerPool(workerCount)
      return
    }
    updateState({ maxWorkerCount: 1, workerCount: 1, workerPoolSize: 0 })
  }

  // Dispose of workers and timers when the controller is torn down.
  const dispose = () => {
    workerPool?.dispose()
    workerPool = null
    stopProgressTimer()
  }

  // Update the requested worker count and rebuild if idle.
  const setWorkerCount = (count: number) => {
    const current = get(state)
    const safeCount = Math.max(1, Math.min(count, current.maxWorkerCount))
    if (safeCount === current.workerCount) {
      return
    }
    updateState({ workerCount: safeCount })
    if (!current.generating) {
      rebuildWorkerPool(safeCount)
    }
  }

  // Explicitly set the generation log visibility flag.
  const setShowGenerationLogs = (value: boolean) => {
    updateState({ showGenerationLogs: value })
  }

  // Toggle the generation log visibility flag.
  const toggleShowGenerationLogs = () => {
    const current = get(state)
    updateState({ showGenerationLogs: !current.showGenerationLogs })
  }

  // Run the async generation flow with progress tracking and state updates.
  const generateForSize = async (size: number) => {
    const current = get(state)
    if (current.generating) {
      return
    }
    updateState({ generating: true, generatorError: '' })
    startProgressTimer()
    await tick()
    await waitForNextFrame()
    try {
      const nextPuzzle = await generatePuzzleAsync(size)
      options.onLoadPuzzle(nextPuzzle)
    } catch (error) {
      updateState({
        generatorError: error instanceof Error ? error.message : 'Unable to build puzzle.'
      })
    } finally {
      updateState({ generating: false, progressMessage: 'Finished parallel puzzle search.' })
      stopProgressTimer()
      const nextState = get(state)
      if (nextState.workerCount !== nextState.workerPoolSize) {
        rebuildWorkerPool(nextState.workerCount)
      }
    }
  }

  // Cancel an in-flight generation and revert to the last puzzle.
  const cancel = () => {
    const current = get(state)
    if (!current.generating) {
      return
    }
    workerPool?.cancel()
    options.onLoadPuzzle(options.getLastPuzzle())
    updateState({ generatorError: '', generating: false })
    stopProgressTimer()
  }

  return {
    state,
    initialize,
    dispose,
    setWorkerCount,
    setShowGenerationLogs,
    toggleShowGenerationLogs,
    generateForSize,
    cancel
  }
}
