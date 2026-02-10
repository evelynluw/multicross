export type Puzzle = {
  name: string
  size: number
  rows: number[][]
  cols: number[][]
  solution: number[][]
}

const deriveLineHints = (line: number[]): number[] => {
  const hints: number[] = []
  let count = 0
  for (const cell of line) {
    if (cell) {
      count += 1
    } else if (count) {
      hints.push(count)
      count = 0
    }
  }
  if (count) {
    hints.push(count)
  }
  return hints
}

const transpose = (grid: number[][]) =>
  grid[0].map((_, colIndex) => grid.map((row) => row[colIndex]))

const buildLineMasks = (length: number, hints: number[]): number[] => {
  if (hints.length === 0) {
    return [0]
  }
  const options: number[] = []
  const remainingSums: number[] = []
  let suffix = 0
  for (let i = hints.length - 1; i >= 0; i--) {
    suffix += hints[i]
    remainingSums[i] = suffix
  }

  const place = (hintIndex: number, start: number, mask: number) => {
    const blockLength = hints[hintIndex]
    const trailingSpace = hintIndex === hints.length - 1 ? 0 : hints.length - hintIndex - 1
    const remaining = hintIndex === hints.length - 1 ? 0 : remainingSums[hintIndex + 1] + trailingSpace
    for (let position = start; position <= length - blockLength - remaining; position++) {
      let nextMask = mask
      for (let offset = 0; offset < blockLength; offset++) {
        nextMask |= 1 << (position + offset)
      }
      if (hintIndex === hints.length - 1) {
        options.push(nextMask)
      } else {
        place(hintIndex + 1, position + blockLength + 1, nextMask)
      }
    }
  }

  place(0, 0, 0)
  return options
}

const countSolutions = (rows: number[][], cols: number[][], size: number, limit = 2): number => {
  const rowOptions = rows.map((hintLine) => buildLineMasks(size, hintLine))
  const columnOptions = cols.map((hintLine) => buildLineMasks(size, hintLine))
  if (rowOptions.some((options) => options.length === 0) || columnOptions.some((options) => options.length === 0)) {
    return 0
  }
  const columnState = columnOptions.map((options) => options.slice())
  const rowOrder = [...Array(size).keys()].sort((a, b) => rowOptions[a].length - rowOptions[b].length)
  const assigned = new Array<boolean>(size).fill(false)
  let found = 0

  const backtrack = (depth: number) => {
    if (found >= limit) {
      return
    }
    if (depth === size) {
      found += 1
      return
    }

    let rowIndex = -1
    for (const row of rowOrder) {
      if (!assigned[row]) {
        rowIndex = row
        break
      }
    }
    if (rowIndex === -1) {
      return
    }

    assigned[rowIndex] = true
    for (const mask of rowOptions[rowIndex]) {
      const snapshots = new Array<(number[] | null)>(size).fill(null)
      let valid = true
      for (let col = 0; col < size; col++) {
        const bit = (mask >> col) & 1
        const filtered = columnState[col].filter((candidate) => ((candidate >> rowIndex) & 1) === bit)
        snapshots[col] = columnState[col]
        if (filtered.length === 0) {
          valid = false
          break
        }
        columnState[col] = filtered
      }

      if (valid) {
        backtrack(depth + 1)
      }

      for (let col = 0; col < size; col++) {
        if (snapshots[col]) {
          columnState[col] = snapshots[col] as number[]
        }
      }

      if (found >= limit) {
        break
      }
    }
    assigned[rowIndex] = false
  }

  backtrack(0)
  return found
}

const hasUniqueSolution = (rows: number[][], cols: number[][], size: number) =>
  countSolutions(rows, cols, size, 2) === 1

const buildPuzzleFromGrid = (grid: number[][], name: string): Puzzle => {
  const rows = grid.map((line) => deriveLineHints(line))
  const cols = transpose(grid).map((line) => deriveLineHints(line))
  return {
    name,
    size: grid.length,
    rows,
    cols,
    solution: grid
  }
}

export const defaultPuzzle: Puzzle = {
  name: 'Cozy Meadow 5x5',
  size: 5,
  rows: [[2], [1, 1, 1], [5], [1, 1], [1, 1]],
  cols: [[2, 1], [1, 2], [3], [2], [1, 1, 1]],
  solution: [
    [0, 1, 1, 0, 0],
    [1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1]
  ]
}

const randomGrid = (size: number, densityRange: [number, number]): number[][] => {
  const [minDensity, maxDensity] = densityRange
  const density = minDensity + Math.random() * (maxDensity - minDensity)
  let filled = 0
  const grid = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => {
      const cell = Math.random() < density ? 1 : 0
      filled += cell
      return cell
    })
  )
  if (filled === 0) {
    const row = Math.floor(Math.random() * size)
    const col = Math.floor(Math.random() * size)
    grid[row][col] = 1
  }
  return grid
}

export const generateRandomPuzzle = (size: number, maxAttempts = 600): Puzzle => {
  const densityRange: Record<number, [number, number]> = {
    5: [0.35, 0.65],
    10: [0.3, 0.55],
    15: [0.28, 0.48],
    20: [0.26, 0.45]
  }
  const range = densityRange[size] ?? [0.25, 0.5]
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const grid = randomGrid(size, range)
    const candidate = buildPuzzleFromGrid(grid, `Random practice ${size}x${size}`)
    if (hasUniqueSolution(candidate.rows, candidate.cols, size)) {
      return candidate
    }
  }
  throw new Error(`Unable to find a unique ${size}x${size} puzzle after ${maxAttempts} attempts.`)
}
