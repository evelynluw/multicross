// ==================================================
// Types
// ==================================================
// Cursor delta used for movement inputs.
export type MoveDelta = { row: number; col: number }

// Describes a control label used in the UI.
type ControlDescriptor = { label: string; description: string }

// ==================================================
// UI control labels
// ==================================================
// Keyboard control list shown in the controls panel.
export const keyboardControls: ControlDescriptor[] = [
  { label: 'Arrow Keys / WASD', description: 'Move the focused cell' },
  { label: 'Enter or F or C', description: 'Fill or unfill the focused cell' },
  { label: "Space or  ' ", description: 'Toggle a pencil mark' },
  { label: 'X or /', description: 'Add or remove a cross mark' },
  { label: 'Z', description: 'Undo last move' },
  { label: 'Shift + Z', description: 'Redo last move' }
]

// Mouse control list shown in the controls panel.
export const mouseControls: ControlDescriptor[] = [
  { label: 'Click', description: 'Fill or unfill a cell' },
  { label: 'Shift + Click', description: 'Toggle a pencil mark' },
  { label: 'Right Click', description: 'Toggle a cross mark' }
]

// ==================================================
// Movement helpers
// ==================================================
// Maps movement keys to cursor deltas.
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

// Return the movement delta for a key, if it is a move key.
export const getMoveDelta = (key: string): MoveDelta | null => moveMap[key] ?? null

// ==================================================
// Key classification
// ==================================================
// True when the event represents an undo command.
export const isUndoKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'z' && !event.shiftKey

// True when the event represents a redo command.
export const isRedoKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'z' && event.shiftKey

// True when the event represents a fill action.
export const isFillKey = (event: KeyboardEvent) =>
  event.key === 'Enter' || event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'c'

// True when the event represents a pencil action.
export const isPencilKey = (event: KeyboardEvent) =>
  event.key === ' ' || event.key === 'Spacebar' || event.key === "'"

// True when the event represents a cross action.
export const isCrossKey = (event: KeyboardEvent) => event.key.toLowerCase() === 'x' || event.key === '/'

// Canonical action keys used for consecutive actions.
export type ActionKey = 'fill' | 'pencil' | 'cross'

// Map an input event to its corresponding action key, if any.
export const getActionKey = (event: KeyboardEvent): ActionKey | null => {
    if (isFillKey(event)) {
        return 'fill'
    }
    if (isPencilKey(event)) {
        return 'pencil'
    }
    if (isCrossKey(event)) {
        return 'cross'
    }
    return null
}

// ==================================================
// Consecutive action handler
// ==================================================
// Dependencies required to run consecutive action input logic.
export type ConsecutiveActionContext = {
    getCursor: () => { row: number; col: number }
    focusCell: (row: number, col: number) => void
    toggleFill: (row: number, col: number) => void
    togglePencil: (row: number, col: number) => void
    toggleCross: (row: number, col: number) => void
    getDimension: () => number
    cellId: (row: number, col: number) => string
}

// Create a handler for consecutive action + arrow behavior.
export const createConsecutiveActionHandler = (context: ConsecutiveActionContext) => {
    // Track which action keys are currently held.
    let heldActionKeys = new Set<ActionKey>()
    // Remember the most recently held action key.
    let lastHeldAction: ActionKey | null = null
    // Track the last applied action + cell to prevent reapplying.
    let lastActionApplied: { action: ActionKey | null; cellId: string | null } = {
        action: null,
        cellId: null
    }

    // Record action keys on keydown for held input tracking.
    const noteActionKeyDown = (event: KeyboardEvent) => {
        const action = getActionKey(event)
        if (!action) {
            return
        }
        heldActionKeys = new Set(heldActionKeys)
        heldActionKeys.add(action)
        lastHeldAction = action
    }

    // Clear action keys on keyup and reset last action state.
    const noteActionKeyUp = (event: KeyboardEvent) => {
        const action = getActionKey(event)
        if (!action) {
            return
        }
        heldActionKeys = new Set(heldActionKeys)
        heldActionKeys.delete(action)
        if (lastHeldAction === action) {
            lastHeldAction = null
        }
        if (heldActionKeys.size === 0) {
            lastActionApplied = { action: null, cellId: null }
        }
    }

    // Resolve the current held action, preferring the latest.
    const getHeldAction = () => {
        if (lastHeldAction && heldActionKeys.has(lastHeldAction)) {
            return lastHeldAction
        }
        const [fallback] = heldActionKeys
        return fallback ?? null
    }

    // Apply a held action to the next cell, once per cell.
    const applyHeldAction = (action: ActionKey, row: number, col: number) => {
        const dimension = context.getDimension()
        const nextRow = (row + dimension) % dimension
        const nextCol = (col + dimension) % dimension
        const nextCellId = context.cellId(nextRow, nextCol)
        if (lastActionApplied.action === action && lastActionApplied.cellId === nextCellId) {
            return
        }
        if (action === 'fill') {
            context.toggleFill(nextRow, nextCol)
        } else if (action === 'pencil') {
            context.togglePencil(nextRow, nextCol)
        } else {
            context.toggleCross(nextRow, nextCol)
        }
        lastActionApplied = { action, cellId: nextCellId }
    }

    // Handle a keydown and return true when it consumed a move.
    const handleKeydown = (event: KeyboardEvent) => {
        noteActionKeyDown(event)
        const move = getMoveDelta(event.key)
        const heldAction = getHeldAction()
        if (move && heldAction) {
            event.preventDefault()
            const cursor = context.getCursor()
            const nextRow = cursor.row + move.row
            const nextCol = cursor.col + move.col
            context.focusCell(nextRow, nextCol)
            applyHeldAction(heldAction, nextRow, nextCol)
            return true
        }
        return false
    }

    return {
        handleKeydown,
        handleKeyup: noteActionKeyUp
    }
}

// ==================================================
// Keydown handler integration
// ==================================================
// Dependencies required to run the shared keydown handler.
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

// Interpret keyboard input into puzzle actions and movement.
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

// Skip global keyboard handling when typing in inputs.
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
