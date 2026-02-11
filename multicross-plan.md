# Multicross Multiplayer Spec (2 Players)

## Game behavior
- App name: Multicross.
- Static hosting only; no server-side compute for gameplay state.
- Player 1 opens Multicross, selects puzzle size, generates puzzle.
- After generation completes, a 6-character alphanumeric Room ID is shown.
- Room ID persists across puzzles during the same local session; regenerating a puzzle does not change the Room ID.
- Player 2 opens Multicross, enters Room ID in a “Join a room” input, then joins.
- On join, Player 1 sends a full `roomState` to Player 2, including puzzle clues and current board state.
- Both players send cursor positions as they move.
- Both players send cell changes as `statePatch` updates.
- Conflict policy: last write wins by timestamp; if same timestamp, use sender ID tie-breaker.
- Periodic sync every 5s: send `stateSnapshot` containing only board state and puzzle version.
- If Player 1 generates a new puzzle, broadcast a full `roomState` with new puzzle data.

## Data structures and storage (no DB)
All shared state is held in memory on the client (per browser session). No database is used.

### Local session state (per client)
- `roomId`: string (6 alphanumeric). Persisted to session storage.
- `userId`: string (random UUID or short ID). Persisted to local storage.
- `isHost`: boolean (true for Player 1).
- `lastSeenAt`: number (ms).

### Shared room state (authoritative on host)
- `puzzleId`: string (e.g., size + timestamp or a hash).
- `size`: number (grid dimension).
- `rows`: number[][] (row clues).
- `cols`: number[][] (column clues).
- `solution`: boolean[][] (optional; only if needed for validation).
- `grid`: CellState[][] (blank | filled | pencil | crossed).
- `version`: number (monotonic increment on every change).
- `updatedAt`: number (ms).

### Presence and cursors
- `cursors`: Record<userId, { row: number; col: number; updatedAt: number }>.
- `participants`: Record<userId, { name?: string; joinedAt: number; isHost: boolean }>.

### Client-only caches
- `pendingPatches`: queued updates sent but not yet confirmed.
- `lastSnapshotVersion`: number.

### Storage approach
- Host stores the authoritative `roomState` in memory and periodically broadcasts snapshots.
- Joiner stores received `roomState` and applies patches.
- Session storage: `roomId` (host only), `lastPuzzleState` optional.
- Local storage: `userId`, theme, preferences.

## WebSocket protocol (PubNub or any provider)
Message format (generic):
```
{
  type: string,
  roomId: string,
  senderId: string,
  ts: number,
  payload: any
}
```

### Channel strategy
- Room channel: `multicross:room:{roomId}`
- Optional presence channel: `multicross:presence:{roomId}`

### Core message types
- `joinRoom`: `{ userId, name? }`
- `roomState`: `{ puzzleId, size, rows, cols, grid, version, updatedAt }`
- `statePatch`: `{ changes: [{ r, c, state }], version, updatedAt }`
- `stateSnapshot`: `{ grid, version, updatedAt, puzzleId }`
- `cursorMove`: `{ row, col }`
- `hostChanged`: `{ hostId }` (optional)
- `leaveRoom`: `{ userId }`

### Rules
- Host responds to `joinRoom` with `roomState`.
- Clients apply `statePatch` only if `version` is newer than local.
- Periodic `stateSnapshot` every 5 seconds from host.
- On puzzle regenerate: host broadcasts `roomState` with new puzzle data and resets `version`.
- Conflict resolution: higher `ts` wins; if equal, higher `senderId` lexicographically wins.

## Static HTML/CSS/JS generation from Svelte
Options:
- Use Svelte with static site generation (SSG) to emit `index.html` + assets.
- Build output should be static and deployable to any static host (Azure Static Web Apps, GitHub Pages, etc.).

Steps:
- Configure Svelte build to output static assets.
- Ensure routing is client-side only (single page).
- Use environment variables for PubNub keys (injected at build time).

## UI additions
- App title: “Multicross”.
- Host panel: shows Room ID with copy button.
- Join panel: input “Join a room” + Join button.
- Connection status indicator: “Connected / Connecting / Disconnected”.
- Peer cursor display on grid (color-coded).

## Non-goals
- No server-side database.
- No long-term persistence of room state after all clients disconnect.
- No >2 player support in this phase.
