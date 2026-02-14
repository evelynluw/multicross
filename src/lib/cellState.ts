export enum CellState {
  Blank = 0,
  Filled = 1,
  Pencil = 2,
  Crossed = 3
}

const cellStateLabels = ['blank', 'filled', 'pencil', 'crossed'] as const

export type CellStateLabel = (typeof cellStateLabels)[number]

// Convert a cell state into its CSS/data attribute label.
export const cellStateToClass = (state: CellState): CellStateLabel => cellStateLabels[state] ?? 'blank'

// Check whether a value is a valid numeric cell state.
export const isCellStateValue = (value: unknown): value is CellState =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < cellStateLabels.length

// Coerce storage values (numbers or legacy strings) to a cell state.
export const coerceCellState = (value: unknown): CellState | null => {
  if (isCellStateValue(value)) {
    return value
  }
  if (typeof value === 'string') {
    const index = cellStateLabels.indexOf(value as CellStateLabel)
    return index >= 0 ? (index as CellState) : null
  }
  return null
}

// Shorthand check for filled cells.
export const isFilledState = (state: CellState) => state === CellState.Filled
