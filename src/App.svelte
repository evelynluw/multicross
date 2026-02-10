<script lang="ts">
	import { onMount, tick } from 'svelte'
	import ControlsLegend from './lib/Counter.svelte'
	import { defaultPuzzle, generateRandomPuzzle, type Puzzle } from './lib/puzzle'

	type CellState = 'blank' | 'filled' | 'pencil' | 'crossed'
	type Theme = 'dark' | 'light'
	type BoardScale = 'small' | 'medium' | 'large'
	type CellError = 'missing' | 'overfill'

	const keyboardControls = [
		{ label: 'Arrow Keys', description: 'Move the focused cell' },
		{ label: 'Enter', description: 'Fill or unfill the focused cell' },
		{ label: 'Space', description: 'Toggle a pencil mark' },
		{ label: 'X', description: 'Add or remove a cross mark' }
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

	const isFinalizedCell = (cell: CellState) => cell === 'filled' || cell === 'crossed'

	const getCellErrorState = (row: number, col: number): CellError | null =>
		mismatchMap?.[row]?.[col] ?? null

	const cellClass = (row: number, col: number, state: CellState) => {
		const focusClass = cursor.row === row && cursor.col === col ? 'focused' : ''
		const error = getCellErrorState(row, col)
		const errorClass = error ? `error error-${error}` : ''
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
		ArrowRight: { row: 0, col: 1 }
	} as const

	type MoveKey = keyof typeof moveMap

	let puzzle: Puzzle = defaultPuzzle
	let lastPuzzle: Puzzle = defaultPuzzle
	let grid = createGrid(puzzle.size)
	let cursor = { row: 0, col: 0 }
	let solved = false
	let boardElement: HTMLDivElement | null = null
	let selectedSize = puzzle.size
	let generating = false
	let generatorError = ''
	let boardScale: BoardScale = 'medium'
	let theme: Theme = 'dark'
	let boardComplete = false
	let hasErrors = false
	let mismatchMap: (CellError | null)[][] = createErrorMap(puzzle.size)
	let workerPool: Worker[] = []
	let workerPoolSize = 0
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

	$: dimension = puzzle.size
	$: rowHints = puzzle.rows
	$: columnHints = puzzle.cols
	$: solutionGrid = puzzle.solution.map((row) => row.map((value) => Boolean(value)))
	$: focusedCellId = cellId(cursor.row, cursor.col)
	$: cellSize = computeCellSize(dimension, boardScale)
	$: cellGap = computeCellGap(dimension)
	$: separatorIndices = getSeparatorIndices(dimension)
	$: boardComplete = grid.every((row) => row.every(isFinalizedCell))
	$: mismatchMap = boardComplete
		? grid.map((row, rIdx) =>
			row.map((cell, cIdx) => {
				const shouldFill = solutionGrid[rIdx]?.[cIdx] ?? false
				if (!shouldFill && cell === 'filled') {
					return 'overfill'
				}
				if (shouldFill && cell !== 'filled') {
					return 'missing'
				}
				return null
			})
		)
		: createErrorMap(dimension)
	$: hasErrors = mismatchMap.some((row) => row.some(Boolean))
	$: solved = boardComplete && !hasErrors
	$: statusText = solved
		? 'Puzzle solved! Every filled cell satisfies the clues.'
		: boardComplete && hasErrors
			? 'Check the highlighted cells—they contain mistakes.'
			: 'Match the edge clues without guessing.'
	$: focusRingStyle = `--focus-x: calc(${cursor.col} * (var(--cell-size) + var(--cell-gap)));
		--focus-y: calc(${cursor.row} * (var(--cell-size) + var(--cell-gap)));`

	const focusBoard = async () => {
		await tick()
		boardElement?.focus()
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

	const toggleTheme = () => {
		applyTheme(theme === 'dark' ? 'light' : 'dark')
	}

	const mutateCell = (row: number, col: number, transformer: (current: CellState) => CellState) => {
		grid = grid.map((cells, rIdx) =>
			rIdx === row
				? cells.map((cell, cIdx) => (cIdx === col ? transformer(cell) : cell))
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
		cursor = { row: clamp(row), col: clamp(col) }
	}

	const handleKeydown = (event: KeyboardEvent) => {
		void focusBoard()
		const key = event.key as MoveKey
		if (moveMap[key]) {
			event.preventDefault()
			const move = moveMap[key]
			focusCell(cursor.row + move.row, cursor.col + move.col)
			return
		}

		if (event.key === 'Enter') {
			event.preventDefault()
			toggleFill(cursor.row, cursor.col)
			return
		}

		if (event.key === ' ' || event.key === 'Spacebar') {
			event.preventDefault()
			togglePencil(cursor.row, cursor.col)
			return
		}

		if (event.key.toLowerCase() === 'x') {
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
		void focusBoard()
	}

	onMount(() => {
		if (typeof window === 'undefined') {
			return
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

		if (typeof Worker !== 'undefined') {
			const concurrency = Math.max(2, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1))
			workerPoolSize = concurrency
			workerPool = Array.from({ length: concurrency }, (_value, index) => {
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

		const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches
		applyTheme(prefersLight ? 'light' : 'dark')

		const handleWindowKeydown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return
			}
			if (shouldSkipGlobalKey(event.target)) {
				return
			}
			const key = event.key as MoveKey
			if (!moveMap[key]) {
				return
			}
			handleKeydown(event)
		}

		window.addEventListener('keydown', handleWindowKeydown)
		void focusBoard()

		return () => {
			window.removeEventListener('keydown', handleWindowKeydown)
			workerPool.forEach((worker) => worker.terminate())
		}
	})

	const generatePuzzleAsync = (size: number) => {
		if (workerPool.length > 0) {
			return new Promise<Puzzle>((resolve, reject) => {
				if (pendingGeneration) {
					reject('Puzzle generation already in progress.')
					return
				}
				generationId += 1
				const maxAttemptsPerWorker = 300
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
				workerPool.forEach((worker, index) => {
					const id = workerRequestId++
					workerGenerationMap.set(id, generationId)
					workerById.set(id, worker)
					activeWorkerIds.push(id)
					worker.postMessage({ id, size, maxAttempts: maxAttemptsPerWorker, workerIndex: index })
				})
			})
		}
		return Promise.resolve(generateRandomPuzzle(size))
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
</script>

<main>
	<section class="hero">
		<div class="hero-header">
			<div class="hero-text">
				<h1>Picross Studio</h1>
				<p>{statusText}</p>
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
	</section>

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
		{#if generating}
			<div class="loading-indicator" role="status" aria-live="polite">
				<span class="spinner" aria-hidden="true"></span>
				<span>
					{progressMessage || 'Searching for a unique puzzle configuration…'}
					{#if progressMaxAttempts > 0}
						<span class="loading-meta">Attempt {progressAttempt} of {progressMaxAttempts}</span>
					{/if}
				</span>
			</div>
			<div class="loading-timer" aria-live="polite">Elapsed: {progressElapsed.toFixed(1)}s</div>
		{/if}
	</section>

	<section class="puzzle-shell" style={`--dimension: ${dimension}; --cell-size: ${cellSize}; --cell-gap: ${cellGap};`}>
		<div class="puzzle-meta">
			<span>{puzzle.name}</span>
			<span>{dimension} × {dimension}</span>
		</div>
		<div class="column-hints" aria-hidden="true">
			{#each columnHints as column, col}
				<div class={`column-hint ${cursor.col === col ? 'highlight' : ''}`}>
					{#each column as number}
						<span>{number}</span>
					{/each}
				</div>
			{/each}
		</div>
		<div class="row-hints" aria-hidden="true">
			{#each rowHints as row, rowIdx}
				<div class={`row-hint ${cursor.row === rowIdx ? 'highlight' : ''}`}>
					{#each row as number}
						<span>{number}</span>
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
							class={cellClass(rowIdx, colIdx, cell)}
							data-state={cell}
							data-error={getCellErrorState(rowIdx, colIdx) ?? undefined}
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
