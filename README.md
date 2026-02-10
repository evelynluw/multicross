# Picross (Svelte + Vite)

A minimal, responsive Picross (nonogram) board built with Svelte, geared toward quick practice sessions on desktop or mobile. The rules and interactions mirror the standard puzzle description from the public wiki: use the numeric clues at the edges to determine which cells must be filled, penciled for later, or crossed out as empty.

## Features

- Keyboard-friendly navigation with arrow keys, Enter, Space, and X shortcuts.
- Mouse and touch support with left click, shift-click pencil marks, and right-click crosses.
- Clean, high-contrast board that scales smoothly down to small screens.
- Size picker (5x5, 10x10, 15x15, 20x20) plus a "Generate random puzzle" button that produces unique-solution grids.
- Status messaging plus an instant reset when you want to replay the current board.

## Controls

| Action | Effect |
| --- | --- |
| Arrow keys | Move the focused cell |
| Enter | Fill or unfill the focused cell |
| Space | Toggle a pencil mark |
| X | Toggle a cross mark |
| Click | Fill/unfill |
| Shift + Click | Pencil mark |
| Right click | Cross mark |

## Development

Install dependencies (npm is preconfigured, but pnpm or yarn also work):

```
npm install
```

Run the dev server:

```
npm run dev
```

Type-check and lint:

```
npm run check
```

Create a production build:

```
npm run build
```

Preview the production build locally:

```
npm run preview
```

The `src/lib/puzzle.ts` module defines the default 5x5 board and ships a backtracking-based generator/solver. The generator derives row/column hints from a random solution grid and validates uniqueness by recomputing every compatible arrangement (as described in classic wiki write-ups). Tweak the attempt count, density ranges, or plug in curated solutions to expand the catalog.
