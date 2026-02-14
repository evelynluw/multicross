<script lang="ts">
	import { onMount, tick } from 'svelte'
	import { defaultPuzzle, type Puzzle } from './lib/puzzle'
	import { computeClueSatisfaction, type ClueHintMode } from './lib/clueHinting'
	import { CellState, cellStateToClass, coerceCellState } from './lib/cellState'
	import {
		createConsecutiveActionHandler,
		getMoveDelta,
		handleKeydown as handleKeydownControl,
		isCrossKey,
		isFillKey,
		isPencilKey,
		isRedoKey,
		isUndoKey,
		keyboardControls,
		mouseControls,
		shouldSkipGlobalKey
	} from './lib/controls'
	import { createPuzzleGenerationController } from './lib/puzzleGeneration'
	import PuzzlePanel from './lib/components/PuzzlePanel.svelte'
	import ControlsPanel from './lib/components/ControlsPanel.svelte'

	type Theme = 'dark' | 'light'
	type BoardScale = 'small' | 'medium' | 'large'
	type CellError = 'missing' | 'overfill'

	// ==================================================
	// Configuration
	// ==================================================
	const sizeOptions = [5, 8, 10, 12, 15, 20]
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

	// ==================================================
	// Grid helpers
	// ==================================================
	// Create an empty grid at the requested size.
	const createGrid = (size: number): CellState[][] =>
		Array.from({ length: size }, () => Array<CellState>(size).fill(CellState.Blank))

	// Create a blank error map for the grid.
	const createErrorMap = (size: number): (CellError | null)[][] =>
		Array.from({ length: size }, () => Array<CellError | null>(size).fill(null))

	// Check whether a cell is a finalized mark.
	const isFinalizedCell = (cell: CellState) => cell === CellState.Filled || cell === CellState.Crossed

	// Build the CSS class list for a cell.
	const cellClass = (row: number, col: number, state: CellState, error: CellError | null) => {
		const focusClass = cursor.row === row && cursor.col === col ? 'focused' : ''
		const errorClass = error ? `error-${error}` : ''
		return ['cell', cellStateToClass(state), focusClass, errorClass].filter(Boolean).join(' ')
	}

	// Generate the separator indices for a given grid size.
	const getSeparatorIndices = (size: number) => {
		const indices: number[] = []
		for (let idx = 5; idx < size; idx += 5) {
			indices.push(idx)
		}
		return indices
	}

	// ==================================================
	// State
	// ==================================================
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
	let boardScale: BoardScale = 'medium'
	let clueHintMode: ClueHintMode = 'mild'
	let theme: Theme = 'dark'
	let isHydrated = false
	let ensureUniqueness = true
	let boardComplete = false
	let hasErrors = false
	let showMistakes = false
	let mismatchMap: (CellError | null)[][] = createErrorMap(puzzle.size)
	let undoStack: CellState[][][] = []
	let redoStack: CellState[][][] = []
	const maxHistory = 200
	const generation = createPuzzleGenerationController({
		getEnsureUniqueness: () => ensureUniqueness,
		getLastPuzzle: () => lastPuzzle,
		onLoadPuzzle: (nextPuzzle) => loadPuzzle(nextPuzzle)
	})
	const generationState = generation.state

	const STORAGE_KEYS = {
		theme: 'picross:theme',
		puzzle: 'picross:puzzle',
		grid: 'picross:grid'
	}

	// ==================================================
	// Derived state
	// ==================================================
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
		row.some((cell, cIdx) => cell === CellState.Filled && !solutionGrid[rIdx]?.[cIdx])
	)
	$: hasMissingFill = solutionGrid.some((row, rIdx) =>
		row.some((shouldFill, cIdx) => shouldFill && grid[rIdx]?.[cIdx] !== CellState.Filled)
	)
	$: mismatchMap = boardComplete || showMistakes
		? grid.map((row, rIdx) =>
			row.map((cell, cIdx) => {
				const shouldFill = solutionGrid[rIdx]?.[cIdx] ?? false
				const isMarked = cell === CellState.Filled || cell === CellState.Crossed
				if (!isMarked) {
					return null
				}
				if (!shouldFill && cell === CellState.Filled) {
					return 'overfill'
				}
				if (shouldFill && cell === CellState.Crossed) {
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
	$: hasGenerationLogs =
		Boolean($generationState.progressMessage) ||
		$generationState.progressAttempt > 0 ||
		$generationState.workerStatuses.length > 0
	$: focusRingStyle = `--focus-x: calc(${cursor.col} * (var(--cell-size) + var(--cell-gap)));
		--focus-y: calc(${cursor.row} * (var(--cell-size) + var(--cell-gap)));`
	$: if (isHydrated) {
		saveTheme(theme)
	}
	$: if (isHydrated) {
		savePuzzleState(puzzle, grid)
	}

	// ==================================================
	// Focus & timing helpers
	// ==================================================
	// Move focus to the game board element.
	const focusBoard = async () => {
		await tick()
		boardElement?.focus()
	}

	// Format elapsed time for display.
	const formatElapsedTime = (value: number) => {
		const totalSeconds = Math.max(0, Math.floor(value))
		const minutes = Math.floor(totalSeconds / 60)
		const seconds = totalSeconds % 60
		return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${value.toFixed(1)}s`
	}

	// Start the main game timer.
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

	// Stop the main game timer.
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

	// Clamp a value to the board bounds.
	const clamp = (value: number) => Math.min(Math.max(value, 0), dimension - 1)
	// Build the DOM id for a given cell.
	const cellId = (row: number, col: number) => `cell-${row}-${col}`

	// Compute cell size CSS values from board settings.
	const computeCellSize = (size: number, scale: BoardScale) => {
		const base = scale === 'small' ? 28 : scale === 'large' ? 48 : 36
		const dimensionFactor = size >= 20 ? 0.8 : size >= 15 ? 0.9 : size >= 10 ? 0.95 : 1
		const px = Math.max(16, Math.round(base * dimensionFactor))
		return `${px}px`
	}

	// Compute cell gap CSS values from board size.
	const computeCellGap = (size: number) => (size >= 15 ? '2px' : size >= 10 ? '3px' : '4px')

	// ==================================================
	// Theme & persistence
	// ==================================================
	// Apply the selected theme to the document.
	const applyTheme = (next: Theme) => {
		theme = next
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.theme = next
		}
	}

	// Persist the selected theme.
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

	// Persist the current puzzle and grid state.
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

	// Validate a puzzle payload from storage.
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

	// Normalize a saved grid payload into the compact numeric format.
	const normalizeGrid = (value: unknown, size: number): CellState[][] | null => {
		if (!Array.isArray(value) || value.length !== size) {
			return null
		}
		const nextGrid: CellState[][] = []
		for (const row of value) {
			if (!Array.isArray(row) || row.length !== size) {
				return null
			}
			const nextRow: CellState[] = []
			for (const cell of row) {
				const normalized = coerceCellState(cell)
				if (normalized === null) {
					return null
				}
				nextRow.push(normalized)
			}
			nextGrid.push(nextRow)
		}
		return nextGrid
	}

	// Toggle the active theme.
	const toggleTheme = () => {
		applyTheme(theme === 'dark' ? 'light' : 'dark')
	}

	// ==================================================
	// Grid history
	// ==================================================
	// Clone the grid for undo/redo snapshots.
	const cloneGrid = (source: CellState[][]) => source.map((row) => [...row])

	// Push the current grid into the undo stack.
	const pushUndoState = () => {
		undoStack = [...undoStack, cloneGrid(grid)]
		if (undoStack.length > maxHistory) {
			undoStack = undoStack.slice(undoStack.length - maxHistory)
		}
		redoStack = []
	}

	// Clear the undo/redo history.
	const clearHistory = () => {
		undoStack = []
		redoStack = []
	}

	// Restore the previous grid state.
	const undoMove = () => {
		if (!undoStack.length) {
			return
		}
		const previous = undoStack[undoStack.length - 1]
		undoStack = undoStack.slice(0, -1)
		redoStack = [...redoStack, cloneGrid(grid)]
		grid = cloneGrid(previous)
	}

	// Restore the next grid state.
	const redoMove = () => {
		if (!redoStack.length) {
			return
		}
		const next = redoStack[redoStack.length - 1]
		redoStack = redoStack.slice(0, -1)
		undoStack = [...undoStack, cloneGrid(grid)]
		grid = cloneGrid(next)
	}

	// ==================================================
	// Grid mutation helpers
	// ==================================================
	// Apply a cell transform and capture history.
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

	// Toggle a fill mark at the cell.
	const toggleFill = (row: number, col: number) => {
		mutateCell(row, col, (current) => (current === CellState.Filled ? CellState.Blank : CellState.Filled))
	}

	// Toggle a pencil mark at the cell.
	const togglePencil = (row: number, col: number) => {
		mutateCell(row, col, (current) => (current === CellState.Pencil ? CellState.Blank : CellState.Pencil))
	}

	// Toggle a cross mark at the cell.
	const toggleCross = (row: number, col: number) => {
		mutateCell(row, col, (current) => (current === CellState.Crossed ? CellState.Blank : CellState.Crossed))
	}

	// ==================================================
	// Controls & input handlers
	// ==================================================
	// Move the cursor and wrap within the board.
	const focusCell = (row: number, col: number) => {
		const nextRow = (row + dimension) % dimension
		const nextCol = (col + dimension) % dimension
		cursor = { row: nextRow, col: nextCol }
	}

	// Create the consecutive action handler for held action + arrows.
	const consecutiveActions = createConsecutiveActionHandler({
		getCursor: () => cursor,
		focusCell,
		toggleFill,
		togglePencil,
		toggleCross,
		getDimension: () => dimension,
		cellId
	})

	// Handle keyboard input for board actions.
	const handleKeydown = (event: KeyboardEvent) => {
		if (consecutiveActions.handleKeydown(event)) {
			return
		}
		handleKeydownControl(event, {
			focusBoard,
			undoMove,
			redoMove,
			focusCell,
			toggleFill,
			togglePencil,
			toggleCross,
			getCursor: () => cursor
		})
	}

	// Handle left click interactions.
	const handleCellClick = (event: MouseEvent, row: number, col: number) => {
		focusCell(row, col)
		if (event.shiftKey || event.metaKey || event.altKey) {
			togglePencil(row, col)
		} else {
			toggleFill(row, col)
		}
		void focusBoard()
	}

	// Handle right click interactions.
	const handleCellContextMenu = (event: MouseEvent, row: number, col: number) => {
		event.preventDefault()
		focusCell(row, col)
		toggleCross(row, col)
		void focusBoard()
	}

	// ==================================================
	// Game lifecycle
	// ==================================================
	// Reset the board to an empty grid.
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

	// Initialize persisted state, workers, and listeners.
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
					const normalizedGrid = normalizeGrid(parsedGrid, parsedPuzzle.size)
					if (normalizedGrid) {
						grid = normalizedGrid
					} else {
						grid = createGrid(parsedPuzzle.size)
					}
				}
			} catch {
				// ignore storage errors
			}
		}

		generation.initialize()

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
			if (
				getMoveDelta(event.key) ||
				isUndoKey(event) ||
				isRedoKey(event) ||
				isFillKey(event) ||
				isPencilKey(event) ||
				isCrossKey(event)
			) {
				handleKeydown(event)
			}
		}

		const handleWindowKeyup = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return
			}
			if (shouldSkipGlobalKey(event.target)) {
				return
			}
			consecutiveActions.handleKeyup(event)
		}

		window.addEventListener('keydown', handleWindowKeydown)
		window.addEventListener('keyup', handleWindowKeyup)
		void focusBoard()
		isHydrated = true
		startGameTimer()

		return () => {
			window.removeEventListener('keydown', handleWindowKeydown)
			window.removeEventListener('keyup', handleWindowKeyup)
			generation.dispose()
			stopGameTimer()
		}
	})

	// ==================================================
	// Puzzle generation
	// ==================================================
	// Cancel an in-flight puzzle generation.
	const cancelGeneration = () => generation.cancel()

	// Load a new puzzle and reset board state.
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

	// Handle size selection changes.
	const handleSizeChange = async (event: Event) => {
		const target = event.currentTarget as HTMLSelectElement
		const value = Number(target.value)
		selectedSize = value
		await generation.generateForSize(value)
	}

	// Handle the "Generate another" click.
	const handleGenerateClick = async () => {
		await generation.generateForSize(selectedSize)
	}

	// Handle worker count changes from the input.
	const handleWorkerCountChange = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement
		const value = Number(target.value)
		generation.setWorkerCount(value)
	}

	// Toggle mistake highlighting.
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
			<button class="primary" on:click={handleGenerateClick} disabled={$generationState.generating}>
				{$generationState.generating ? 'Building puzzle…' : 'Generate another'}
			</button>
			<button class="secondary" on:click={cancelGeneration} disabled={!$generationState.generating}>
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
					max={$generationState.maxWorkerCount}
					value={$generationState.workerCount}
					on:input={handleWorkerCountChange}
					disabled={$generationState.generating}
					inputmode="numeric"
				/>
				<span class="worker-max">/ {$generationState.maxWorkerCount}</span>
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
			<label class="dropdown-board-size size-picker">
				<span>Board size</span>
				<select
					bind:value={selectedSize}
					on:change={handleSizeChange}
					aria-label="Select board size"
					disabled={$generationState.generating}
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
			<label class="dropdown-board-scale size-picker">
				<span>Cell scale</span>
				<select bind:value={boardScale} aria-label="Select board scale">
					{#each boardScaleOptions as option}
						<option value={option}>{boardScaleLabels[option]}</option>
					{/each}
				</select>
			</label>
			<label class="dropdown-clue-hints size-picker">
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
		{#if $generationState.generatorError}
			<p class="error">{$generationState.generatorError}</p>
		{/if}
		{#if $generationState.generating || hasGenerationLogs}
			<div class="log-header">
				<h3>Generation logs</h3>
				<button class="log-toggle" type="button" on:click={generation.toggleShowGenerationLogs}>
					{$generationState.showGenerationLogs ? 'Hide logs' : 'Show logs'}
				</button>
			</div>
			{#if $generationState.showGenerationLogs}
				<div class="loading-indicator" role="status" aria-live="polite">
					{#if $generationState.generating}
						<span class="spinner" aria-hidden="true"></span>
					{/if}
					<span>
						{$generationState.progressMessage || 'Searching for a unique puzzle configuration…'}
						{#if $generationState.progressMaxAttempts > 0}
							<span class="loading-meta">
								Attempt {$generationState.progressAttempt} of {$generationState.progressMaxAttempts}
							</span>
						{/if}
					</span>
				</div>
				<div class="loading-timer" aria-live="polite">
					Elapsed: {$generationState.progressElapsed.toFixed(1)}s
				</div>
				{#if $generationState.workerStatuses.length > 0}
					<ul class="worker-status" aria-live="polite">
						{#each $generationState.workerStatuses as status}
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
		generating={$generationState.generating}
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
