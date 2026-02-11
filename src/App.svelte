<script lang="ts">
	import { onMount, tick } from 'svelte'
	import { defaultPuzzle, generateRandomPuzzle, type Puzzle } from './lib/puzzle'
	import { PuzzleWorkerPool, type WorkerEvent } from './lib/puzzleWorkerPool'
	import { computeClueSatisfaction, type CellState, type ClueHintMode } from './lib/clueHinting'
	import PuzzlePanel from './lib/components/PuzzlePanel.svelte'
	import ControlsPanel from './lib/components/ControlsPanel.svelte'

	type Theme = 'dark' | 'light'
	type BoardScale = 'small' | 'medium' | 'large'
	type CellError = 'missing' | 'overfill'

	const keyboardControls = [
		{ label: 'Arrow Keys / WASD', description: 'Move the focused cell' },
		{ label: 'Enter or F or C', description: 'Fill or unfill the focused cell' },
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
	const clueHintOptions: Array<{ value: ClueHintMode; label: string }> = [
		{ value: 'aggressive', label: 'Aggressive' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'mild', label: 'Mild' }
	]

	const createGrid = (size: number): CellState[][] =>
		Array.from({ length: size }, () => Array<CellState>(size).fill('blank'))

	const createErrorMap = (size: number): (CellError | null)[][] =>
		Array.from({ length: size }, () => Array<CellError | null>(size).fill(null))

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
	let clueHintMode: ClueHintMode = 'mild'
	let theme: Theme = 'dark'
	let isHydrated = false
	let ensureUniqueness = true
	let boardComplete = false
	let hasErrors = false
	let showMistakes = false
	let mismatchMap: (CellError | null)[][] = createErrorMap(puzzle.size)
	let workerPool: PuzzleWorkerPool | null = null
	let workerPoolSize = 0
	let maxWorkerCount = 4
	let workerCount = 4
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
	// Boolean solution grid used by hinting and completion rules.
	$: solutionGrid = puzzle.solution.map((row) => row.map((value) => Boolean(value)))
	$: focusedCellId = cellId(cursor.row, cursor.col)
	$: cellSize = computeCellSize(dimension, boardScale)
	$: cellGap = computeCellGap(dimension)
	$: separatorIndices = getSeparatorIndices(dimension)
	// Per-row clue dimming state based on selected hint mode.
	$: rowClueSatisfied = rowHints.map((clues, rowIdx) => {
		const line = grid[rowIdx] ?? []
		const solutionLine = solutionGrid[rowIdx] ?? []
		return computeClueSatisfaction(clueHintMode, clues, line, solutionLine)
	})
	// Per-column clue dimming state based on selected hint mode.
	$: columnClueSatisfied = columnHints.map((clues, colIdx) => {
		const line = grid.map((row) => row[colIdx])
		const solutionLine = solutionGrid.map((row) => row[colIdx])
		return computeClueSatisfaction(clueHintMode, clues, line, solutionLine)
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

	const handleWorkerEvent = (event: WorkerEvent) => {
		if (event.type === 'progress') {
			totalAttempts += 1
			progressAttempt = totalAttempts
			progressMaxAttempts = event.maxAttempts * workerPoolSize
			progressMessage = `Attempting to find a puzzle: ${Math.max(0, totalAttempts - 1)} failed checks across ${workerPoolSize} workers…`
			workerStatuses = workerStatuses.map((status) =>
				status.index === event.workerIndex
					? {
						...status,
						attempts: event.attempt,
						elapsed: event.elapsed,
						message: `Worker ${event.workerIndex + 1}: attempt ${event.attempt}/${event.maxAttempts}`
					}
					: status
			)
			return
		}
		if (event.type === 'error') {
			generatorError = event.message
		}
	}

	const rebuildWorkerPool = (count: number) => {
		const safeCount = Math.max(1, Math.min(count, maxWorkerCount))
		workerPoolSize = safeCount
		if (typeof Worker === 'undefined') {
			workerPool = null
			workerPoolSize = 0
			return
		}
		if (!workerPool) {
			workerPool = new PuzzleWorkerPool(safeCount, handleWorkerEvent)
			return
		}
		workerPool.setWorkerCount(safeCount)
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

		if (event.key === 'Enter' || event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'c') {
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
			workerPool?.dispose()
			stopGameTimer()
		}
	})

	$: if (!generating && workerCount !== workerPoolSize) {
		rebuildWorkerPool(workerCount)
	}

	const generatePuzzleAsync = (size: number) => {
		if (workerPool && workerPoolSize > 0) {
			const maxAttemptsPerWorker = 300
			const requireUnique = ensureUniqueness
			totalAttempts = 0
			progressAttempt = 0
			progressMaxAttempts = workerPoolSize * maxAttemptsPerWorker
			progressElapsed = 0
			progressMessage = 'Starting parallel puzzle search…'
			workerStatuses = Array.from({ length: workerPoolSize }, (_worker, index) => ({
				index,
				attempts: 0,
				elapsed: 0,
				message: `Worker ${index + 1}: starting…`
			}))
			return workerPool.generate(size, maxAttemptsPerWorker, requireUnique)
		}
		return Promise.resolve(generateRandomPuzzle(size, 600, ensureUniqueness))
	}

	const cancelGeneration = () => {
		if (!generating) {
			return
		}
		workerPool?.cancel()
		loadPuzzle(lastPuzzle)
		generatorError = ''
		generating = false
		stopProgressTimer()
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
			<label class="size-picker">
				<span>
					Clue hints
					<span
						class="hint-info"
						title="Aggressive: dims as soon as a run matches the solution position. 
            Medium: dims only closed runs (surrounded by X/border) and non-ambiguous lengths. 
            Mild: dims only when the entire row/column is solved."
						aria-label="Clue hint modes info"
					>
						ⓘ
					</span>
				</span>
				<select bind:value={clueHintMode} aria-label="Select clue hint mode">
					{#each clueHintOptions as option}
						<option value={option.value}>{option.label}</option>
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

	<PuzzlePanel
		puzzleName={puzzle.name}
		dimension={dimension}
		cellSize={cellSize}
		cellGap={cellGap}
		solved={solved}
		boardComplete={boardComplete}
		hasErrors={hasErrors}
		generating={generating}
		rowHints={rowHints}
		columnHints={columnHints}
		rowClueSatisfied={rowClueSatisfied}
		columnClueSatisfied={columnClueSatisfied}
		cursor={cursor}
		grid={grid}
		mismatchMap={mismatchMap}
		separatorIndices={separatorIndices}
		focusedCellId={focusedCellId}
		focusRingStyle={focusRingStyle}
		bind:boardElement
		showMistakes={showMistakes}
		timerLabel={formatElapsedTime(gameTimerElapsed)}
		cellClass={cellClass}
		onKeydown={handleKeydown}
		onMouseDown={() => void focusBoard()}
		onCellClick={handleCellClick}
		onCellContextMenu={handleCellContextMenu}
		onToggleMistakes={toggleMistakes}
	/>

	<ControlsPanel keyboardControls={keyboardControls} mouseControls={mouseControls} />
</main>
