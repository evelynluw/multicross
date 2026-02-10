<script lang="ts">
	import { onMount, tick } from 'svelte'
	import ControlsLegend from './lib/Counter.svelte'
	import { defaultPuzzle, generateRandomPuzzle, type Puzzle } from './lib/puzzle'

	type CellState = 'blank' | 'filled' | 'pencil' | 'crossed'

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

	$: dimension = puzzle.size
	$: solutionGrid = puzzle.solution.map((row) => row.map((value) => Boolean(value)))
	$: focusedCellId = cellId(cursor.row, cursor.col)
	$: statusText = solved
		? 'Puzzle solved! Every filled cell satisfies the clues.'
		: 'Match the edge clues without guessing.'

	const focusBoard = async () => {
		await tick()
		boardElement?.focus()
	}

	const clamp = (value: number) => Math.min(Math.max(value, 0), dimension - 1)
	const cellId = (row: number, col: number) => `cell-${row}-${col}`

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
		<p class="eyebrow">Picross / Nonogram logic</p>
		<h1>Picross practice board</h1>
		<p>
			Picross (a.k.a. nonograms) ask you to paint the correct pattern by following the row and column counts.
			This mini app follows the classic wiki rules with both keyboard and mouse tooling.
		</p>
		<div class="generator-toolbar">
			<label class="size-picker">
				<span>Board size</span>
				<select bind:value={selectedSize} on:change={handleSizeChange} disabled={generating}>
					{#each sizeOptions as size}
						<option value={size}>{size} x {size}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="accent"
				on:click={handleGenerateClick}
				disabled={generating}>
				{generating ? 'Generating...' : 'Generate random puzzle'}
			</button>
		</div>
		{#if generatorError}
			<p class="generator-error" role="alert">{generatorError}</p>
		{/if}
		<div class="status-bar" aria-live="polite">
			<span class={`status ${solved ? 'status--success' : ''}`}>{statusText}</span>
			<button type="button" class="ghost" on:click={resetBoard}>
				Reset board
			</button>
		</div>
	</section>

	<section class="puzzle-section">
		<header class="puzzle-head">
			<div>
				<p class="puzzle-label">Current puzzle</p>
				<h2>{puzzle.name}</h2>
			</div>
			<p class="puzzle-size">{dimension} x {dimension}</p>
		</header>

		<div class="puzzle-shell" style={`--dimension: ${dimension}`}
			aria-label={`Picross grid for ${puzzle.name}`}>
			<div class="corner-spacer" aria-hidden="true"></div>

			<div class="column-hints" aria-hidden="true">
				{#each puzzle.cols as hintColumn}
					<div class="hint-stack">
						{#if hintColumn.length === 0}
							<span>0</span>
						{:else}
							{#each hintColumn as value}
								<span>{value}</span>
							{/each}
						{/if}
					</div>
				{/each}
			</div>

			<div class="row-hints" aria-hidden="true">
				{#each puzzle.rows as hintRow}
					<div class="hint-row">
						{#if hintRow.length === 0}
							<span>0</span>
						{:else}
							{#each hintRow as value}
								<span>{value}</span>
							{/each}
						{/if}
					</div>
				{/each}
			</div>

			<div
				class={`board ${solved ? 'board--solved' : ''}`}
				role="grid"
				tabindex="0"
				aria-activedescendant={focusedCellId}
				bind:this={boardElement}
				on:keydown={handleKeydown}>
				{#each grid as row, rowIndex}
					{#each row as state, colIndex}
						<button
							type="button"
							id={cellId(rowIndex, colIndex)}
							tabindex="-1"
							class={`cell ${state} ${cursor.row === rowIndex && cursor.col === colIndex ? 'is-focused' : ''}`}
							aria-pressed={state === 'filled'}
							aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}`}
							on:click={(event) => handleCellClick(event, rowIndex, colIndex)}
							on:contextmenu={(event) => handleCellContextMenu(event, rowIndex, colIndex)}>
						</button>
					{/each}
				{/each}
			</div>
		</div>
	</section>

	<section class="legend-grid">
		<ControlsLegend heading="Keyboard" controls={keyboardControls} />
		<ControlsLegend heading="Mouse & touch" controls={mouseControls} />
	</section>
</main>
