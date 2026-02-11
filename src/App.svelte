<script lang="ts">
	import { onMount, tick } from 'svelte'
	import ControlsLegend from './lib/Counter.svelte'
	import { defaultPuzzle, generateRandomPuzzle, type Puzzle } from './lib/puzzle'

	type CellState = 'blank' | 'filled' | 'pencil' | 'crossed'
	type Theme = 'dark' | 'light'
	type BoardScale = 'small' | 'medium' | 'large'
	type CellError = 'missing' | 'overfill'

	const keyboardControls = [
		{ label: 'Arrow Keys / WASD', description: 'Move the focused cell' },
		{ label: 'Enter or F', description: 'Fill or unfill the focused cell' },
		{ label: 'Space or  \' ', description: 'Toggle a pencil mark' },
		{ label: 'X or /', description: 'Add or remove a cross mark' },
		{ label: 'Z', description: 'Undo last move' },
		{ label: 'Shift + Z', description: 'Redo last move' }
	]

	const mouseControls = [
		{ label: 'Click', description: 'Fill or unfill a cell' },
		{ label: 'Shift + Click', description: 'Toggle a pencil mark' },
		{ label: 'Right Click', description: 'Toggle a cross mark' }
	]

	const sizeOptions = [5, 10, 15, 20]
	const boardScaleOptions: BoardScale[] = ['small', 'medium', 'large']
	const boardScaleLabels: Record<BoardScale, string> = {
		small: 'Small',
		medium: 'Medium',
		large: 'Large'
	}

	const createGrid = (size: number): CellState[][] =>
		Array.from({ length: size }, () => Array<CellState>(size).fill('blank'))

	const createErrorMap = (size: number): (CellError | null)[][] =>
		Array.from({ length: size }, () => Array<CellError | null>(size).fill(null))

	type Run = { start: number; end: number; length: number }

	const isFinalizedCell = (cell: CellState) => cell === 'filled' || cell === 'crossed'

	const cellClass = (row: number, col: number, state: CellState, error: CellError | null) => {
		const focusClass = cursor.row === row && cursor.col === col ? 'focused' : ''
		const errorClass = error ? `error-${error}` : ''
		return ['cell', state, focusClass, errorClass].filter(Boolean).join(' ')
	}

	const getSeparatorIndices = (size: number) => {
		const indices: number[] = []
		for (let idx = 5; idx < size; idx += 5) {
			indices.push(idx)
		}
		return indices
	}

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

	const isRunSatisfied = (line: CellState[], solutionLine: boolean[], run: Run) => {
		for (let idx = run.start; idx <= run.end; idx += 1) {
			if (line[idx] !== 'filled') {
				return false
			}
		}
		if (run.start > 0 && line[run.start - 1] === 'filled') {
			return false
		}
		if (run.end < line.length - 1 && line[run.end + 1] === 'filled') {
			return false
		}
		for (let idx = 0; idx < run.start; idx += 1) {
			if (line[idx] === 'filled' && !solutionLine[idx]) {
				return false
			}
		}
		return true
	}

	const shouldSkipGlobalKey = (target: EventTarget | null) => {
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

	const moveMap = {
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
	} as const

	type MoveKey = keyof typeof moveMap

	let puzzle: Puzzle = defaultPuzzle
	let lastPuzzle: Puzzle = defaultPuzzle
	let grid = createGrid(puzzle.size)
	let cursor = { row: 0, col: 0 }
	let solved = false
	let completionPopup: 'solved' | 'mistakes' | null = null
	let lastCompletionState: 'solved' | 'mistakes' | null = null
	let gameTimerStart = 0
	let gameTimerElapsed = 0
	let gameTimerRunning = false
	let gameTimerInterval: ReturnType<typeof setInterval> | null = null
	let boardElement: HTMLDivElement | null = null
	let selectedSize = puzzle.size
	let generating = false
	let generatorError = ''
	let boardScale: BoardScale = 'medium'
	let theme: Theme = 'dark'
	let isHydrated = false
	let ensureUniqueness = true
	let boardComplete = false
	let hasErrors = false
	let showMistakes = false
	let mismatchMap: (CellError | null)[][] = createErrorMap(puzzle.size)
	let workerPool: Worker[] = []
	let workerPoolSize = 0
	let maxWorkerCount = 4
	let workerCount = 4
	let workerGenerationMap = new Map<number, number>()
	let workerById = new Map<number, Worker>()
	let pendingGeneration: {
		resolve: (puzzle: Puzzle) => void
		reject: (reason?: string) => void
		remaining: number
		generationId: number
		maxAttemptsPerWorker: number
	} | null = null
	let activeWorkerIds: number[] = []
	let generationId = 0
	let workerRequestId = 0
	let progressAttempt = 0
	let progressMaxAttempts = 0
	let progressElapsed = 0
	let progressMessage = ''
	let progressStart = 0
	let progressTimer: ReturnType<typeof setInterval> | null = null
	let totalAttempts = 0
	let workerStatuses: Array<{ index: number; attempts: number; elapsed: number; message: string }> = []
	let showGenerationLogs = true
	let undoStack: CellState[][][] = []
	let redoStack: CellState[][][] = []
	const maxHistory = 200

	const STORAGE_KEYS = {
		theme: 'picross:theme',
		puzzle: 'picross:puzzle',
		grid: 'picross:grid'
	}

	$: dimension = puzzle.size
	$: rowHints = puzzle.rows
	$: columnHints = puzzle.cols
	$: solutionGrid = puzzle.solution.map((row) => row.map((value) => Boolean(value)))
	$: focusedCellId = cellId(cursor.row, cursor.col)
	$: cellSize = computeCellSize(dimension, boardScale)
	$: cellGap = computeCellGap(dimension)
	$: separatorIndices = getSeparatorIndices(dimension)
	$: solutionRowRuns = solutionGrid.map((row) => computeRuns(row))
	$: solutionColumnRuns = Array.from({ length: dimension }, (_value, col) =>
		computeRuns(solutionGrid.map((row) => row[col]))
	)
	$: rowClueSatisfied = solutionRowRuns.map((runs, rowIdx) => {
		const line = grid[rowIdx] ?? []
		const solutionLine = solutionGrid[rowIdx] ?? []
		return runs.map((run) => isRunSatisfied(line, solutionLine, run))
	})
	$: columnClueSatisfied = solutionColumnRuns.map((runs, colIdx) => {
		const line = grid.map((row) => row[colIdx])
		const solutionLine = solutionGrid.map((row) => row[colIdx])
		return runs.map((run) => isRunSatisfied(line, solutionLine, run))
	})
	$: boardComplete = grid.every((row) => row.every(isFinalizedCell))
	$: hasIncorrectFill = grid.some((row, rIdx) =>
		row.some((cell, cIdx) => cell === 'filled' && !solutionGrid[rIdx]?.[cIdx])
	)
	$: hasMissingFill = solutionGrid.some((row, rIdx) =>
		row.some((shouldFill, cIdx) => shouldFill && grid[rIdx]?.[cIdx] !== 'filled')
	)
	$: mismatchMap = boardComplete || showMistakes
		? grid.map((row, rIdx) =>
			row.map((cell, cIdx) => {
				const shouldFill = solutionGrid[rIdx]?.[cIdx] ?? false
				const isMarked = cell === 'filled' || cell === 'crossed'
				if (!isMarked) {
					return null
				}
				if (!shouldFill && cell === 'filled') {
					return 'overfill'
				}
				if (shouldFill && cell === 'crossed') {
					return 'missing'
				}
				return null
			})
		)
		: createErrorMap(dimension)
	$: hasErrors = mismatchMap.some((row) => row.some(Boolean))
	$: solved = !hasIncorrectFill && !hasMissingFill
	$: if (solved) {
		const nextState = 'solved'
		if (nextState !== lastCompletionState) {
			completionPopup = nextState
			lastCompletionState = nextState
		}
	} else if (boardComplete && hasErrors) {
		const nextState = 'mistakes'
		if (nextState !== lastCompletionState) {
			completionPopup = nextState
			lastCompletionState = nextState
		}
	} else {
		completionPopup = null
		lastCompletionState = null
	}
	$: if (solved && gameTimerRunning) {
		stopGameTimer()
	}
	$: hasGenerationLogs = Boolean(progressMessage) || progressAttempt > 0 || workerStatuses.length > 0
	$: focusRingStyle = `--focus-x: calc(${cursor.col} * (var(--cell-size) + var(--cell-gap)));
		--focus-y: calc(${cursor.row} * (var(--cell-size) + var(--cell-gap)));`
	$: if (isHydrated) {
		saveTheme(theme)
	}
	$: if (isHydrated) {
		savePuzzleState(puzzle, grid)
	}

	const focusBoard = async () => {
		await tick()
		boardElement?.focus()
	}

	const formatElapsedTime = (value: number) => {
		const totalSeconds = Math.max(0, Math.floor(value))
		const minutes = Math.floor(totalSeconds / 60)
		const seconds = totalSeconds % 60
		return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${value.toFixed(1)}s`
	}

	const startGameTimer = () => {
		gameTimerStart = performance.now()
		gameTimerElapsed = 0
		gameTimerRunning = true
		if (gameTimerInterval) {
			clearInterval(gameTimerInterval)
		}
		gameTimerInterval = setInterval(() => {
			gameTimerElapsed = (performance.now() - gameTimerStart) / 1000
		}, 100)
	}

	const stopGameTimer = () => {
		if (gameTimerInterval) {
			clearInterval(gameTimerInterval)
			gameTimerInterval = null
		}
		if (gameTimerRunning) {
			gameTimerElapsed = (performance.now() - gameTimerStart) / 1000
		}
		gameTimerRunning = false
	}

	const waitForNextFrame = () =>
		new Promise<void>((resolve) => {
			if (typeof requestAnimationFrame === 'undefined') {
				setTimeout(() => resolve(), 0)
				return
			}
			requestAnimationFrame(() => resolve())
		})

	const startProgressTimer = () => {
		progressStart = performance.now()
		progressElapsed = 0
		progressTimer = setInterval(() => {
			progressElapsed = (performance.now() - progressStart) / 1000
		}, 100)
	}

	const stopProgressTimer = () => {
		if (progressTimer) {
			clearInterval(progressTimer)
			progressTimer = null
		}
		progressElapsed = (performance.now() - progressStart) / 1000
	}

	const resetGenerationState = () => {
		pendingGeneration = null
		activeWorkerIds = []
		workerGenerationMap.clear()
		workerById.clear()
	}

	const cancelActiveWorkers = () => {
		for (const id of activeWorkerIds) {
			const worker = workerById.get(id)
			if (worker) {
				worker.postMessage({ id, cancel: true })
			}
		}
		resetGenerationState()
	}

	const handleWorkerMessage = (event: MessageEvent) => {
		const data = event.data as
			| { id: number; type: 'progress'; attempt: number; maxAttempts: number; elapsed: number; workerIndex: number }
			| { id: number; type: 'result'; ok: boolean; puzzle?: Puzzle; message?: string }
		if (!pendingGeneration) {
			return
		}
		const workerGen = workerGenerationMap.get(data.id)
		if (workerGen !== pendingGeneration.generationId) {
			return
		}
		if (data.type === 'progress') {
			totalAttempts += 1
			progressAttempt = totalAttempts
			progressMaxAttempts = pendingGeneration.maxAttemptsPerWorker * workerPoolSize
			progressMessage = `Attempting to find a puzzle: ${Math.max(0, totalAttempts - 1)} failed checks across ${workerPoolSize} workers…`
			workerStatuses = workerStatuses.map((status) =>
				status.index === data.workerIndex
					? {
						...status,
						attempts: data.attempt,
						elapsed: data.elapsed,
						message: `Worker ${data.workerIndex + 1}: attempt ${data.attempt}/${data.maxAttempts}`
					}
					: status
			)
			return
		}
		if (data.type === 'result' && data.ok && data.puzzle) {
			pendingGeneration.resolve(data.puzzle)
			cancelActiveWorkers()
			return
		}
		pendingGeneration.remaining -= 1
		if (pendingGeneration.remaining <= 0) {
			pendingGeneration.reject(data.message ?? 'Unable to build puzzle.')
			resetGenerationState()
		}
	}

	const rebuildWorkerPool = (count: number) => {
		workerPool.forEach((worker) => worker.terminate())
		workerPool = []
		workerPoolSize = 0
		if (typeof Worker === 'undefined') {
			return
		}
		const safeCount = Math.max(1, Math.min(count, maxWorkerCount))
		workerPoolSize = safeCount
		workerPool = Array.from({ length: safeCount }, () => {
			const worker = new Worker(new URL('./lib/puzzleWorker.ts', import.meta.url), { type: 'module' })
			worker.addEventListener('message', handleWorkerMessage)
			worker.addEventListener('error', () => {
				if (!pendingGeneration) {
					return
				}
				pendingGeneration.remaining -= 1
				if (pendingGeneration.remaining <= 0) {
					pendingGeneration.reject('Puzzle generator worker failed.')
					resetGenerationState()
				}
			})
			return worker
		})
	}

	const clamp = (value: number) => Math.min(Math.max(value, 0), dimension - 1)
	const cellId = (row: number, col: number) => `cell-${row}-${col}`

	const computeCellSize = (size: number, scale: BoardScale) => {
		const base = scale === 'small' ? 28 : scale === 'large' ? 48 : 36
		const dimensionFactor = size >= 20 ? 0.8 : size >= 15 ? 0.9 : size >= 10 ? 0.95 : 1
		const px = Math.max(16, Math.round(base * dimensionFactor))
		return `${px}px`
	}

	const computeCellGap = (size: number) => (size >= 15 ? '2px' : size >= 10 ? '3px' : '4px')

	const applyTheme = (next: Theme) => {
		theme = next
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.theme = next
		}
	}

	const saveTheme = (nextTheme: Theme) => {
		if (!isHydrated || typeof localStorage === 'undefined') {
			return
		}
		try {
			localStorage.setItem(STORAGE_KEYS.theme, nextTheme)
		} catch {
			// ignore storage errors
		}
	}

	const savePuzzleState = (nextPuzzle: Puzzle, nextGrid: CellState[][]) => {
		if (!isHydrated || typeof localStorage === 'undefined') {
			return
		}
		try {
			localStorage.setItem(STORAGE_KEYS.puzzle, JSON.stringify(nextPuzzle))
			localStorage.setItem(STORAGE_KEYS.grid, JSON.stringify(nextGrid))
		} catch {
			// ignore storage errors
		}
	}

	const isValidPuzzle = (value: unknown): value is Puzzle => {
		if (!value || typeof value !== 'object') {
			return false
		}
		const candidate = value as Puzzle
		return (
			typeof candidate.name === 'string' &&
			typeof candidate.size === 'number' &&
			Array.isArray(candidate.rows) &&
			Array.isArray(candidate.cols) &&
			Array.isArray(candidate.solution)
		)
	}

	const isValidGrid = (value: unknown, size: number): value is CellState[][] => {
		if (!Array.isArray(value) || value.length !== size) {
			return false
		}
		return value.every(
			(row) =>
				Array.isArray(row) &&
				row.length === size &&
				row.every((cell) => ['blank', 'filled', 'pencil', 'crossed'].includes(cell as string))
		)
	}

	const toggleTheme = () => {
		applyTheme(theme === 'dark' ? 'light' : 'dark')
	}

	const cloneGrid = (source: CellState[][]) => source.map((row) => [...row])

	const pushUndoState = () => {
		undoStack = [...undoStack, cloneGrid(grid)]
		if (undoStack.length > maxHistory) {
			undoStack = undoStack.slice(undoStack.length - maxHistory)
		}
		redoStack = []
	}

	const clearHistory = () => {
		undoStack = []
		redoStack = []
	}

	const undoMove = () => {
		if (!undoStack.length) {
			return
		}
		const previous = undoStack[undoStack.length - 1]
		undoStack = undoStack.slice(0, -1)
		redoStack = [...redoStack, cloneGrid(grid)]
		grid = cloneGrid(previous)
	}

	const redoMove = () => {
		if (!redoStack.length) {
			return
		}
		const next = redoStack[redoStack.length - 1]
		redoStack = redoStack.slice(0, -1)
		undoStack = [...undoStack, cloneGrid(grid)]
		grid = cloneGrid(next)
	}

	const mutateCell = (row: number, col: number, transformer: (current: CellState) => CellState) => {
		const current = grid[row]?.[col]
		if (current === undefined) {
			return
		}
		const next = transformer(current)
		if (next === current) {
			return
		}
		pushUndoState()
		grid = grid.map((cells, rIdx) =>
			rIdx === row
				? cells.map((cell, cIdx) => (cIdx === col ? next : cell))
				: cells
		)
	}

	const toggleFill = (row: number, col: number) => {
		mutateCell(row, col, (current) => (current === 'filled' ? 'blank' : 'filled'))
	}

	const togglePencil = (row: number, col: number) => {
		mutateCell(row, col, (current) => (current === 'pencil' ? 'blank' : 'pencil'))
	}

	const toggleCross = (row: number, col: number) => {
		mutateCell(row, col, (current) => (current === 'crossed' ? 'blank' : 'crossed'))
	}

	const focusCell = (row: number, col: number) => {
		const nextRow = (row + dimension) % dimension
		const nextCol = (col + dimension) % dimension
		cursor = { row: nextRow, col: nextCol }
	}

	const handleKeydown = (event: KeyboardEvent) => {
		void focusBoard()
		const keyLower = event.key.toLowerCase()
		if (keyLower === 'z' && event.shiftKey) {
			event.preventDefault()
			redoMove()
			return
		}
		if (keyLower === 'z') {
			event.preventDefault()
			undoMove()
			return
		}
		const key = event.key as MoveKey
		if (moveMap[key]) {
			event.preventDefault()
			const move = moveMap[key]
			focusCell(cursor.row + move.row, cursor.col + move.col)
			return
		}

		if (event.key === 'Enter' || event.key.toLowerCase() === 'f') {
			event.preventDefault()
			toggleFill(cursor.row, cursor.col)
			return
		}

		if (event.key === ' ' || event.key === 'Spacebar' || event.key === "'") {
			event.preventDefault()
			togglePencil(cursor.row, cursor.col)
			return
		}

		if (event.key.toLowerCase() === 'x' || event.key === '/') {
			event.preventDefault()
			toggleCross(cursor.row, cursor.col)
		}
	}

	const handleCellClick = (event: MouseEvent, row: number, col: number) => {
		focusCell(row, col)
		if (event.shiftKey || event.metaKey || event.altKey) {
			togglePencil(row, col)
		} else {
			toggleFill(row, col)
		}
		void focusBoard()
	}

	const handleCellContextMenu = (event: MouseEvent, row: number, col: number) => {
		event.preventDefault()
		focusCell(row, col)
		toggleCross(row, col)
		void focusBoard()
	}

	const resetBoard = () => {
		grid = createGrid(dimension)
		cursor = { row: 0, col: 0 }
		completionPopup = null
		lastCompletionState = null
		showMistakes = false
		clearHistory()
		startGameTimer()
		void focusBoard()
	}

	onMount(() => {
		if (typeof window === 'undefined') {
			return
		}

		if (typeof localStorage !== 'undefined') {
			const storedTheme = localStorage.getItem(STORAGE_KEYS.theme)
			if (storedTheme === 'light' || storedTheme === 'dark') {
				applyTheme(storedTheme)
			}

			const storedPuzzle = localStorage.getItem(STORAGE_KEYS.puzzle)
			const storedGrid = localStorage.getItem(STORAGE_KEYS.grid)
			try {
				const parsedPuzzle = storedPuzzle ? JSON.parse(storedPuzzle) : null
				const parsedGrid = storedGrid ? JSON.parse(storedGrid) : null
				if (isValidPuzzle(parsedPuzzle)) {
					puzzle = parsedPuzzle
					lastPuzzle = parsedPuzzle
					selectedSize = parsedPuzzle.size
					if (isValidGrid(parsedGrid, parsedPuzzle.size)) {
						grid = parsedGrid
					} else {
						grid = createGrid(parsedPuzzle.size)
					}
				}
			} catch {
				// ignore storage errors
			}
		}

		if (typeof Worker !== 'undefined') {
			maxWorkerCount = Math.max(1, navigator.hardwareConcurrency ?? 4)
			workerCount = Math.max(1, Math.min(maxWorkerCount, Math.max(2, maxWorkerCount - 1)))
			rebuildWorkerPool(workerCount)
		}

		if (!localStorage.getItem(STORAGE_KEYS.theme)) {
			const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches
			applyTheme(prefersLight ? 'light' : 'dark')
		}

		const handleWindowKeydown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return
			}
			if (shouldSkipGlobalKey(event.target)) {
				return
			}
			const key = event.key as MoveKey
			if (moveMap[key]) {
				handleKeydown(event)
				return
			}
			const lower = event.key.toLowerCase()
			if (lower === 'z' || lower === 'x' || event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
				handleKeydown(event)
			}
		}

		window.addEventListener('keydown', handleWindowKeydown)
		void focusBoard()
		isHydrated = true
		startGameTimer()

		return () => {
			window.removeEventListener('keydown', handleWindowKeydown)
			workerPool.forEach((worker) => worker.terminate())
			stopGameTimer()
		}
	})

	$: if (!generating && workerPoolSize && workerCount !== workerPoolSize) {
		rebuildWorkerPool(workerCount)
	}

	const generatePuzzleAsync = (size: number) => {
		if (workerPool.length > 0) {
			return new Promise<Puzzle>((resolve, reject) => {
				if (pendingGeneration) {
					reject('Puzzle generation already in progress.')
					return
				}
				generationId += 1
				const maxAttemptsPerWorker = 300
				const requireUnique = ensureUniqueness
				pendingGeneration = {
					resolve,
					reject,
					remaining: workerPool.length,
					generationId,
					maxAttemptsPerWorker
				}
				totalAttempts = 0
				progressAttempt = 0
				progressMaxAttempts = workerPool.length * maxAttemptsPerWorker
				progressElapsed = 0
				progressMessage = 'Starting parallel puzzle search…'
				activeWorkerIds = []
				workerStatuses = workerPool.map((_worker, index) => ({
					index,
					attempts: 0,
					elapsed: 0,
					message: `Worker ${index + 1}: starting…`
				}))
				workerPool.forEach((worker, index) => {
					const id = workerRequestId++
					workerGenerationMap.set(id, generationId)
					workerById.set(id, worker)
					activeWorkerIds.push(id)
					worker.postMessage({ id, size, maxAttempts: maxAttemptsPerWorker, workerIndex: index, requireUnique })
				})
			})
		}
		return Promise.resolve(generateRandomPuzzle(size, 600, ensureUniqueness))
	}

	const cancelGeneration = () => {
		if (!generating) {
			return
		}
		cancelActiveWorkers()
		loadPuzzle(lastPuzzle)
		generatorError = ''
		generating = false
		stopProgressTimer()
		resetGenerationState()
	}

	const loadPuzzle = (next: Puzzle) => {
		lastPuzzle = puzzle
		puzzle = next
		selectedSize = next.size
		grid = createGrid(next.size)
		cursor = { row: 0, col: 0 }
		completionPopup = null
		lastCompletionState = null
		showMistakes = false
		clearHistory()
		startGameTimer()
		void focusBoard()
	}

	const buildPuzzleForSize = async (size: number) => {
		if (generating) {
			return
		}
		generating = true
		generatorError = ''
		startProgressTimer()
		await tick()
		await waitForNextFrame()
		try {
			const nextPuzzle = await generatePuzzleAsync(size)
			loadPuzzle(nextPuzzle)
		} catch (error) {
			generatorError = error instanceof Error ? error.message : 'Unable to build puzzle.'
		} finally {
			generating = false
			progressMessage = 'Finished parallel puzzle search.'
			stopProgressTimer()
		}
	}

	const handleSizeChange = async (event: Event) => {
		const target = event.currentTarget as HTMLSelectElement
		const value = Number(target.value)
		selectedSize = value
		await buildPuzzleForSize(value)
	}

	const handleGenerateClick = async () => {
		await buildPuzzleForSize(selectedSize)
	}

	const toggleMistakes = () => {
		showMistakes = !showMistakes
	}
</script>

<main>
	<section class="hero">
		<div class="hero-header">
			<div class="hero-text">
				<h1>Picross Studio</h1>
			</div>
			<button class="theme-toggle" type="button" on:click={toggleTheme} aria-pressed={theme === 'dark'}>
				<span class="theme-toggle__icon" aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
				{theme === 'dark' ? 'Dark' : 'Light'} mode
			</button>
		</div>
		<div class="hero-actions">
			<button class="secondary" on:click={resetBoard}>Reset board</button>
			<button class="primary" on:click={handleGenerateClick} disabled={generating}>
				{generating ? 'Building puzzle…' : 'Generate another'}
			</button>
			<button class="secondary" on:click={cancelGeneration} disabled={!generating}>
				Stop building puzzle
			</button>
		</div>
		<div class="uniqueness-toggle">
			<label class="uniqueness-option">
				<input type="checkbox" bind:checked={ensureUniqueness} />
				<span>ensure uniqueness</span>
			</label>
			<label class="worker-input">
				<span>workers</span>
				<input
					type="number"
					min="1"
					max={maxWorkerCount}
					bind:value={workerCount}
					disabled={generating}
					inputmode="numeric"
				/>
				<span class="worker-max">/ {maxWorkerCount}</span>
			</label>
		</div>
	</section>

	{#if completionPopup}
		<div class="completion-popup" role="status" aria-live="polite">
			<span>
				{completionPopup === 'solved'
					? 'Congratulations! You have completed the puzzle.'
					: 'You have mistakes!'}
			</span>
			<button type="button" class="popup-dismiss" on:click={() => (completionPopup = null)}>
				Dismiss
			</button>
		</div>
	{/if}

	<section class="generator-panel">
		<div class="generator-toolbar">
			<label class="size-picker">
				<span>Board size</span>
				<select
					bind:value={selectedSize}
					on:change={handleSizeChange}
					aria-label="Select board size"
					disabled={generating}
				>
					{#each sizeOptions as size}
						<option value={size}>
							{size}
							×
							{size}
						</option>
					{/each}
				</select>
			</label>
			<label class="size-picker">
				<span>Cell scale</span>
				<select bind:value={boardScale} aria-label="Select board scale">
					{#each boardScaleOptions as option}
						<option value={option}>{boardScaleLabels[option]}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if generatorError}
			<p class="error">{generatorError}</p>
		{/if}
		{#if generating || hasGenerationLogs}
			<div class="log-header">
				<h3>Generation logs</h3>
				<button class="log-toggle" type="button" on:click={() => (showGenerationLogs = !showGenerationLogs)}>
					{showGenerationLogs ? 'Hide logs' : 'Show logs'}
				</button>
			</div>
			{#if showGenerationLogs}
				<div class="loading-indicator" role="status" aria-live="polite">
					{#if generating}
						<span class="spinner" aria-hidden="true"></span>
					{/if}
					<span>
						{progressMessage || 'Searching for a unique puzzle configuration…'}
						{#if progressMaxAttempts > 0}
							<span class="loading-meta">Attempt {progressAttempt} of {progressMaxAttempts}</span>
						{/if}
					</span>
				</div>
				<div class="loading-timer" aria-live="polite">Elapsed: {progressElapsed.toFixed(1)}s</div>
				{#if workerStatuses.length > 0}
					<ul class="worker-status" aria-live="polite">
						{#each workerStatuses as status}
							<li>
								<span>{status.message}</span>
								<span class="worker-time">{status.elapsed.toFixed(1)}s</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		{/if}
	</section>

	{#if boardComplete && hasErrors}
		<div class="completion-banner completion-banner--error">You have mistakes!</div>
	{:else if solved}
		<div class="completion-banner">Congratulations! You have completed the puzzle.</div>
	{/if}
	<section class="puzzle-shell" style={`--dimension: ${dimension}; --cell-size: ${cellSize}; --cell-gap: ${cellGap};`}>
		<div class="puzzle-meta">
			<span>{puzzle.name}</span>
			<span>{dimension} × {dimension}</span>
			<button class="mistakes-toggle" type="button" on:click={toggleMistakes} aria-pressed={showMistakes}>
				{showMistakes ? 'Hide mistakes' : 'Check mistakes'}
			</button>
			<span class="puzzle-timer">Time: {formatElapsedTime(gameTimerElapsed)}</span>
		</div>
		<div class="column-hints" aria-hidden="true">
			{#each columnHints as column, col}
				<div class={`column-hint ${cursor.col === col ? 'highlight' : ''}`}>
					{#each column as number, clueIdx}
						<span class={columnClueSatisfied[col]?.[clueIdx] ? 'clue-satisfied' : ''}>{number}</span>
					{/each}
				</div>
			{/each}
		</div>
		<div class="row-hints" aria-hidden="true">
			{#each rowHints as row, rowIdx}
				<div class={`row-hint ${cursor.row === rowIdx ? 'highlight' : ''}`}>
					{#each row as number, clueIdx}
						<span class={rowClueSatisfied[rowIdx]?.[clueIdx] ? 'clue-satisfied' : ''}>{number}</span>
					{/each}
				</div>
			{/each}
		</div>
		<div
			class={`board ${solved ? 'board-solved' : ''} ${boardComplete && hasErrors ? 'board-error' : ''} ${generating ? 'board-loading' : ''}`.trim()}
			tabindex="0"
			role="grid"
			aria-label={`Picross board ${dimension} by ${dimension}`}
			aria-activedescendant={focusedCellId}
			on:keydown={handleKeydown}
			on:mousedown={() => void focusBoard()}
			bind:this={boardElement}
		>
			<div class="board-grid">
				{#each grid as row, rowIdx}
					{#each row as cell, colIdx}
						<button
							type="button"
							class={cellClass(rowIdx, colIdx, cell, mismatchMap?.[rowIdx]?.[colIdx] ?? null)}
							data-state={cell}
							data-error={mismatchMap?.[rowIdx]?.[colIdx] ?? undefined}
							aria-label={`Cell ${rowIdx + 1}, ${colIdx + 1}`}
							aria-pressed={cell === 'filled'}
							tabindex="-1"
							id={cellId(rowIdx, colIdx)}
							on:click={(event) => handleCellClick(event, rowIdx, colIdx)}
							on:contextmenu={(event) => handleCellContextMenu(event, rowIdx, colIdx)}
						>
						</button>
					{/each}
				{/each}
				{#each separatorIndices as index}
					<div class="block-separator block-separator-row" style={`--separator-index: ${index};`}></div>
					<div class="block-separator block-separator-col" style={`--separator-index: ${index};`}></div>
				{/each}
				<div class="focus-ring" aria-hidden="true" style={focusRingStyle}></div>
			</div>
		</div>
	</section>

	<section class="controls-panel">
		<h2>Controls</h2>
		<div class="controls-grid">
			<ControlsLegend title="Keyboard" controls={keyboardControls} />
			<ControlsLegend title="Mouse" controls={mouseControls} />
		</div>
	</section>
</main>
