# mancala-tournament

## Mancala Tournament API Documentation

### Base URL

```
http://localhost:3000
```

### 1. Create a Player

**Endpoint:**  
`POST /players`

**Description:**  
Creates a new player and returns a unique player ID.

**Request Body:**  
None

**Response:**
```json
{ "id": "player-uuid" }
```

---

### 2. Get Player Info

**Endpoint:**  
`GET /players/:playerId`

**Description:**  
Fetches player stats and info.

**Response Example:**
```json
{
	"id": "player-uuid",
	"wins": 0,
	"losses": 0,
	"createdAt": "...",
	"lastPlayedAt": null,
	"score": 1200
}
```

---

### 3. Join or Get a Game

**Endpoint:**  
`GET /players/:playerId/turns`

**Description:**  
Joins an existing game or creates a new one if none are available. Returns the current board state.

**Response Example:**
```json
{
	"board": [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]
}
```

---

### 4. Make a Move

**Endpoint:**  
`POST /players/:playerId/turns/:turnId`

**Description:**  
Submit a move for your turn.

**Request Body:**
```json
{ "pit": 2 }
```
- `pit`: The index of the pit you want to move from (0-5 for player 1, 7-12 for player 2).

**Response Example:**
```json
{
	"state": {
		"board": [...],
		"turn": "next-player-id",
		"status": "active" // or "finished"
	},
	"history": [
		{ "turnId": "...", "board": [...], "player": "...", "pit": 2, "timestamp": "..." }
	]
}
```

---

### 5. Listen for Game Results (Server-Sent Events)

**Endpoint:**  
`GET /player/:playerId/games`

**Description:**  
Listen for finished games and receive win/loss/draw notifications via SSE.

**How to Use:**  
Open a connection to this endpoint to receive real-time updates when your games finish.

---

### Board Representation

- The board is an array of 14 numbers:
	- Index 0-5: Player 1's pits
	- Index 6: Player 1's store
	- Index 7-12: Player 2's pits
	- Index 13: Player 2's store

---

### Notes

- Ensure AWS DynamoDB tables (`Players`, `ActivePlayers`, `ActiveGames`) exist and are configured.
- All endpoints return JSON.
- The server uses port 3000 by default.
