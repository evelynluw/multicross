<script lang="ts">
	import { CellState, cellStateToClass, isFilledState } from '../cellState'
	type CellError = 'missing' | 'overfill'

	export let puzzleName: string
	export let dimension: number
	export let cellSize: string
	export let cellGap: string
	export let solved: boolean
	export let boardComplete: boolean
	export let hasErrors: boolean
	export let generating: boolean
	export let rowHints: number[][]
	export let columnHints: number[][]
	export let rowClueSatisfied: boolean[][]
	export let columnClueSatisfied: boolean[][]
	export let cursor: { row: number; col: number }
	export let grid: CellState[][]
	export let mismatchMap: (CellError | null)[][]
	export let separatorIndices: number[]
	export let focusedCellId: string
	export let focusRingStyle: string
	export let boardElement: HTMLDivElement | null = null
	export let showMistakes: boolean
	export let timerLabel: string

	export let onKeydown: (event: KeyboardEvent) => void
	export let onMouseDown: () => void
	export let onCellClick: (event: MouseEvent, row: number, col: number) => void
	export let onCellContextMenu: (event: MouseEvent, row: number, col: number) => void
	export let onToggleMistakes: () => void
	export let cellClass: (row: number, col: number, state: CellState, error: CellError | null) => string
</script>

{#if boardComplete && hasErrors}
	<div class="completion-banner completion-banner--error">You have mistakes!</div>
{:else if solved}
	<div class="completion-banner">Congratulations! You have completed the puzzle.</div>
{/if}
<section class="puzzle-shell" style={`--dimension: ${dimension}; --cell-size: ${cellSize}; --cell-gap: ${cellGap};`}>
	<div class="puzzle-meta">
		<span>{puzzleName}</span>
		<span>{dimension} × {dimension}</span>
		<button class="mistakes-toggle" type="button" on:click={onToggleMistakes} aria-pressed={showMistakes}>
			{showMistakes ? 'Hide mistakes' : 'Check mistakes'}
		</button>
		<span class="puzzle-timer">Time: {timerLabel}</span>
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
		on:keydown={onKeydown}
		on:mousedown={onMouseDown}
		bind:this={boardElement}
	>
		<div class="board-grid">
			{#each grid as row, rowIdx}
				{#each row as cell, colIdx}
					<button
						type="button"
						class={cellClass(rowIdx, colIdx, cell, mismatchMap?.[rowIdx]?.[colIdx] ?? null)}
						data-state={cellStateToClass(cell)}
						data-error={mismatchMap?.[rowIdx]?.[colIdx] ?? undefined}
						aria-label={`Cell ${rowIdx + 1}, ${colIdx + 1}`}
						aria-pressed={isFilledState(cell)}
						tabindex="-1"
						id={`cell-${rowIdx}-${colIdx}`}
						on:click={(event) => onCellClick(event, rowIdx, colIdx)}
						on:contextmenu={(event) => onCellContextMenu(event, rowIdx, colIdx)}
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
