<script lang="ts">
	import { onMount, tick } from 'svelte'
	import ControlsLegend from './lib/Counter.svelte'
	import { defaultPuzzle, generateRandomPuzzle, type Puzzle } from './lib/puzzle'

	type CellState = 'blank' | 'filled' | 'pencil' | 'crossed'
	type Theme = 'dark' | 'light'
	type BoardScale = 'small' | 'medium' | 'large'

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

	const moveMap = {
		ArrowUp: { row: -1, col: 0 },
		ArrowDown: { row: 1, col: 0 },
		ArrowLeft: { row: 0, col: -1 },
		ArrowRight: { row: 0, col: 1 }
	} as const

	type MoveKey = keyof typeof moveMap

	let puzzle: Puzzle = defaultPuzzle
	let grid = createGrid(puzzle.size)
	let cursor = { row: 0, col: 0 }
	let solved = false
	let boardElement: HTMLDivElement | null = null
	let selectedSize = puzzle.size
	let generating = false
	let generatorError = ''
	let boardScale: BoardScale = 'medium'
	let theme: Theme = 'dark'

	$: dimension = puzzle.size
	$: rowHints = puzzle.rows
	$: columnHints = puzzle.cols
	$: solutionGrid = puzzle.solution.map((row) => row.map((value) => Boolean(value)))
	$: focusedCellId = cellId(cursor.row, cursor.col)
	$: statusText = solved
		? 'Puzzle solved! Every filled cell satisfies the clues.'
		: 'Match the edge clues without guessing.'
	$: cellSize = computeCellSize(dimension, boardScale)
	$: cellGap = computeCellGap(dimension)

	const focusBoard = async () => {
		await tick()
		boardElement?.focus()
	}

	const clamp = (value: number) => Math.min(Math.max(value, 0), dimension - 1)
	const cellId = (row: number, col: number) => `cell-${row}-${col}`

	const computeCellSize = (size: number, scale: BoardScale) => {
		const base = scale === 'small' ? 14 : scale === 'large' ? 24 : 18
		const dimensionFactor = size >= 20 ? 0.8 : size >= 15 ? 0.9 : size >= 10 ? 0.95 : 1
		const px = Math.max(10, Math.round(base * dimensionFactor))
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

	const computeSolved = () =>
		solutionGrid.every((row, rIdx) =>
			row.every((shouldFill, cIdx) => shouldFill === (grid[rIdx][cIdx] === 'filled'))
		)

	const mutateCell = (row: number, col: number, transformer: (current: CellState) => CellState) => {
		grid = grid.map((cells, rIdx) =>
			rIdx === row
				? cells.map((cell, cIdx) => (cIdx === col ? transformer(cell) : cell))
				: cells
		)
		solved = computeSolved()
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
		solved = false
		void focusBoard()
	}

	onMount(() => {
		if (typeof window !== 'undefined') {
			const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches
			applyTheme(prefersLight ? 'light' : 'dark')
		}
		void focusBoard()
	})

	const loadPuzzle = (next: Puzzle) => {
		puzzle = next
		selectedSize = next.size
		grid = createGrid(next.size)
		cursor = { row: 0, col: 0 }
		solved = false
		void focusBoard()
	}

	const buildPuzzleForSize = async (size: number) => {
		if (generating) {
			return
		}
		generating = true
		generatorError = ''
		await tick()
		try {
			const nextPuzzle = generateRandomPuzzle(size)
			loadPuzzle(nextPuzzle)
		} catch (error) {
			generatorError = error instanceof Error ? error.message : 'Unable to build puzzle.'
		} finally {
			generating = false
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
			class={`board ${solved ? 'board-solved' : ''}`}
			tabindex="0"
			role="grid"
			aria-label={`Picross board ${dimension} by ${dimension}`}
			aria-activedescendant={focusedCellId}
			on:keydown={handleKeydown}
			bind:this={boardElement}
		>
			<div class="board-grid">
				{#each grid as row, rowIdx}
					{#each row as cell, colIdx}
						<button
							type="button"
							class={`cell ${cell} ${cursor.row === rowIdx && cursor.col === colIdx ? 'focused' : ''}`}
							data-state={cell}
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
