import { CellState } from './cellState'
export type ClueHintMode = 'aggressive' | 'medium' | 'mild'

// A contiguous run used for clue/hint evaluation.
type Run = { start: number; end: number; length: number }

// Builds solution runs from a boolean solution line.
const computeRuns = (line: boolean[]): Run[] => {
	const runs: Run[] = []
	let start = -1
	for (let idx = 0; idx <= line.length; idx += 1) {
		const value = line[idx]
		if (value && start === -1) {
			start = idx
		}
		if ((!value || idx === line.length) && start !== -1) {
			const end = idx - 1
			runs.push({ start, end, length: end - start + 1 })
			start = -1
		}
	}
	return runs
}

// Builds player-filled runs and marks if they are closed by crosses or borders.
const computeFilledRuns = (line: CellState[]) => {
	const runs: Array<Run & { closed: boolean }> = []
	let start = -1
	for (let idx = 0; idx <= line.length; idx += 1) {
		const value = line[idx] === CellState.Filled
		if (value && start === -1) {
			start = idx
		}
		if ((!value || idx === line.length) && start !== -1) {
			const end = idx - 1
			const left = start === 0 || line[start - 1] === CellState.Crossed
			const right = end === line.length - 1 || line[end + 1] === CellState.Crossed
			runs.push({ start, end, length: end - start + 1, closed: left && right })
			start = -1
		}
	}
	return runs
}

// Checks whether a given solution run is matched by the player's fills.
const isRunSatisfied = (line: CellState[], solutionLine: boolean[], run: Run) => {
	for (let idx = run.start; idx <= run.end; idx += 1) {
		if (line[idx] !== CellState.Filled) {
			return false
		}
	}
	if (run.start > 0 && line[run.start - 1] === CellState.Filled) {
		return false
	}
	if (run.end < line.length - 1 && line[run.end + 1] === CellState.Filled) {
		return false
	}
	for (let idx = 0; idx < run.start; idx += 1) {
		if (line[idx] === CellState.Filled && !solutionLine[idx]) {
			return false
		}
	}
	return true
}

// Determines which clues should dim based on the current hint mode.
export const computeClueSatisfaction = (
	mode: ClueHintMode,
	clues: number[],
	line: CellState[],
	solutionLine: boolean[]
): boolean[] => {
	if (!clues.length) {
		return []
	}
	if (mode === 'mild') {
		// Mild: only dim when the entire line is solved.
		const lineSolved = clues.every((clue) => clue > 0) &&
			!line.some((cell, idx) => cell === CellState.Filled && !solutionLine[idx]) &&
			solutionLine.every((shouldFill, idx) => !shouldFill || line[idx] === CellState.Filled)
		return clues.map(() => lineSolved)
	}
	if (mode === 'aggressive') {
		// Aggressive: dim a clue as soon as its solution run is satisfied.
		const solutionRuns = computeRuns(solutionLine)
		return solutionRuns.map((run) => isRunSatisfied(line, solutionLine, run))
	}
	// WIP - not working correctly yet! Medium: dim closed runs only if the clue length is non-ambiguous.
	const closedRuns = computeFilledRuns(line).filter((run) => run.closed)
	if (!closedRuns.length) {
		return clues.map(() => false)
	}
	const clueCounts = clues.reduce<Record<number, number>>((acc, clue) => {
		acc[clue] = (acc[clue] ?? 0) + 1
		return acc
	}, {})
	return clues.map((clue) => {
		if ((clueCounts[clue] ?? 0) > 1) {
			return false
		}
		return closedRuns.some((run) => run.length === clue)
	})
}
