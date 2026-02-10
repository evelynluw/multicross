import { generateRandomPuzzle, type Puzzle } from './puzzle'

type WorkerRequest = {
  id: number
  size: number
}

type WorkerResponse =
  | { id: number; ok: true; puzzle: Puzzle }
  | { id: number; ok: false; message: string }

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, size } = event.data
  try {
    const puzzle = generateRandomPuzzle(size)
    const response: WorkerResponse = { id, ok: true, puzzle }
    ctx.postMessage(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build puzzle.'
    const response: WorkerResponse = { id, ok: false, message }
    ctx.postMessage(response)
  }
})
