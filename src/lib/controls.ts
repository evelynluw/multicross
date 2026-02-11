export type MoveDelta = { row: number; col: number }

type ControlDescriptor = { label: string; description: string }

export const keyboardControls: ControlDescriptor[] = [
  { label: 'Arrow Keys / WASD', description: 'Move the focused cell' },
  { label: 'Enter or F or C', description: 'Fill or unfill the focused cell' },
  { label: "Space or  ' ", description: 'Toggle a pencil mark' },
  { label: 'X or /', description: 'Add or remove a cross mark' },
  { label: 'Z', description: 'Undo last move' },
  { label: 'Shift + Z', description: 'Redo last move' }
]

export const mouseControls: ControlDescriptor[] = [
  { label: 'Click', description: 'Fill or unfill a cell' },
  { label: 'Shift + Click', description: 'Toggle a pencil mark' },
  { label: 'Right Click', description: 'Toggle a cross mark' }
]

const moveMap: Record<string, MoveDelta> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
  w: { row: -1, col: 0 },
  s: { row: 1, col: 0 },
  a: { row: 0, col: -1 },
  d: { row: 0, col: 1 },
  W: { row: -1, col: 0 },
  S: { row: 1, col: 0 },
  A: { row: 0, col: -1 },
  D: { row: 0, col: 1 }
}

export const getMoveDelta = (key: string): MoveDelta | null => moveMap[key] ?? null

export const isUndoKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'z' && !event.shiftKey

export const isRedoKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'z' && event.shiftKey

export const isFillKey = (event: KeyboardEvent) =>
  event.key === 'Enter' || event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'c'

export const isPencilKey = (event: KeyboardEvent) =>
  event.key === ' ' || event.key === 'Spacebar' || event.key === "'"

export const isCrossKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'x' || event.key === '/'

export type KeydownContext = {
  focusBoard: () => void | Promise<void>
  undoMove: () => void
  redoMove: () => void
  focusCell: (row: number, col: number) => void
  toggleFill: (row: number, col: number) => void
  togglePencil: (row: number, col: number) => void
  toggleCross: (row: number, col: number) => void
  getCursor: () => { row: number; col: number }
}

export const handleKeydown = (event: KeyboardEvent, context: KeydownContext) => {
  void context.focusBoard()
  if (isRedoKey(event)) {
    event.preventDefault()
    context.redoMove()
    return
  }
  if (isUndoKey(event)) {
    event.preventDefault()
    context.undoMove()
    return
  }
  const move = getMoveDelta(event.key)
  if (move) {
    event.preventDefault()
    const cursor = context.getCursor()
    context.focusCell(cursor.row + move.row, cursor.col + move.col)
    return
  }
  if (isFillKey(event)) {
    event.preventDefault()
    const cursor = context.getCursor()
    context.toggleFill(cursor.row, cursor.col)
    return
  }
  if (isPencilKey(event)) {
    event.preventDefault()
    const cursor = context.getCursor()
    context.togglePencil(cursor.row, cursor.col)
    return
  }
  if (isCrossKey(event)) {
    event.preventDefault()
    const cursor = context.getCursor()
    context.toggleCross(cursor.row, cursor.col)
  }
}

export const shouldSkipGlobalKey = (target: EventTarget | null) => {
  if (!target) {
    return false
  }
  const element = target as HTMLElement
  if (element.isContentEditable) {
    return true
  }
  const tagName = element.tagName
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA'
}
