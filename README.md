
# mancala-tournament

## Mancala Tournament API Documentation

### Base URL
```
http://localhost:3000
```

---

### 1. Create or Get a Player

**Endpoint:**
```
POST /players
```

**Description:**
- If a `password` (UUID string) is provided in the request body, the API will check for an existing player with that password. If found, it returns the existing player ID. If not, it creates a new player with that password.
- If no password is provided, a new player is always created.
- The password is never returned in any API response.

**Request Body Example:**
```json
{ "password": "b7e6c2c2-1234-4e5a-8b2a-abcdef123456" }
```

**Response Example (existing or new player):**
```json
{ "id": "player-uuid" }
```

---

### 2. Get Player Info

**Endpoint:**
```
GET /players/:playerId
```

**Response Example:**
```json
{
	"id": "player-uuid",
	"wins": 0,
	"losses": 0,
	"createdAt": "2025-09-28T12:00:00.000Z",
	"lastPlayedAt": null,
	"score": 1200
}
```

---

### 3. List Players

**Endpoint:**
```
GET /players
```

**Response Example:**
```json
[
	{
		"id": "player-uuid",
		"wins": 0,
		"losses": 0,
		"createdAt": "2025-09-28T12:00:00.000Z",
		"lastPlayedAt": null,
		"score": 1200
	},
	// ...more players
]
```

---

### 4. Join or Get a Game Turn

**Endpoint:**
```
GET /players/:playerId/turns
```

**Response Example:**
```json
{
	"turnId": "turn-uuid",
	"board": [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]
}
```

---

### 5. Make a Move

**Endpoint:**
```
POST /players/:playerId/turns/:turnId
```

**Request Body Example:**
```json
{ "pit": 2 }
```

**Response Example:**
```json
{
	"state": {
		"board": [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0],
		"turn": "next-player-id",
		"status": "active"
	},
	"history": [
		{ "turnId": "turn-uuid", "board": [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0], "player": "player-uuid", "pit": 2, "timestamp": "2025-09-28T12:01:00.000Z" }
	]
}
```

---

### 6. Board Representation
- The board is an array of 14 numbers:
	- Index 0-5: Player 1's pits
	- Index 6: Player 1's store
	- Index 7-12: Player 2's pits
	- Index 13: Player 2's store

---

### Notes
- The `password` field is only used for player lookup/creation and is never returned in any API response.
- All endpoints return JSON.
- The server uses port 3000 by default.
