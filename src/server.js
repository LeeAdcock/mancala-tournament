/**
 * Mancala Tournament Server
 * 
 * This server provides a REST API for a multiplayer Mancala tournament game using Express and AWS DynamoDB.
 * 
 */

// --- REQUIRED LIBRARIES ---
const express = require('express');
const cors = require('cors');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');
const { CreateTableCommand, ListTablesCommand, UpdateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

// --- SERVER SETUP ---
const app = express();
const PORT = 3000;
const K_FACTOR = 32;

app.use(cors()); // Allow cross-origin requests from the client
app.use(express.json());

// --- AWS DYNAMODB CLIENT SETUP ---
// Assumes AWS credentials are set up in the environment or profile
const dbClient = new DynamoDBClient({ region: 'us-east-1' }); // Set your AWS region
const docClient = DynamoDBDocumentClient.from(dbClient);

app.post('/players', async (req, res) => {
    try {
        const { password } = req.body || {};
        let playerId;
        if (password) {
            // Look for existing player with this password
            const scanResult = await docClient.send(new ScanCommand({
                TableName: 'Players',
                FilterExpression: '#password = :password',
                ExpressionAttributeNames: { '#password': 'password' },
                ExpressionAttributeValues: { ':password': password }
            }));
            if (scanResult.Items && scanResult.Items.length > 0) {
                // Found existing player
                playerId = scanResult.Items[0].id;
                return res.status(200).json({ id: playerId });
            }
        }
        // Create new player
        playerId = randomUUID();
        const now = new Date().toISOString();
        const player = {
            id: playerId,
            wins: 0,
            losses: 0,
            createdAt: now,
            lastPlayedAt: null,
            score: 1200 // Default starting score
        };
        if (password) player.password = password;

        await docClient.send(new PutCommand({
            TableName: 'Players',
            Item: player
        }));

        res.status(201).json({ id: playerId });
    } catch (error) {
        console.error('Error creating player:', error);
        res.status(500).json({ error: 'Failed to create player' });
    }
});

app.get('/players', async (req, res) => {
    try {
        // Scan all players (for small scale; for large scale, use a GSI on score)
        const result = await docClient.send(new ScanCommand({
            TableName: 'Players'
        }));
        // Remove passwords before returning players
        const players = (result.Items || [])
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 100)
            .map(player => {
                const { password, ...rest } = player;
                return rest;
            });
        res.json(players);
    } catch (error) {
        console.error('Error fetching players:', error);
        res.status(500).json({ error: 'Failed to fetch players' });
    }
});

app.get('/players/:playerId', async (req, res) => {
    const { playerId } = req.params;
    try {
        const result = await docClient.send(new GetCommand({
            TableName: 'Players',
            Key: { id: playerId }
        }));

        if (!result.Item) {
            return res.status(404).json({ error: 'Player not found' });
        }

    // Remove password before returning
    const { password, ...rest } = result.Item;
    res.json(rest);
    } catch (error) {
        console.error('Error fetching player:', error);
        res.status(500).json({ error: 'Failed to fetch player' });
    }
});


// --- GET /players/:playerId/turns ---
app.get('/players/:playerId/turns', async (req, res) => {
    const { playerId } = req.params;

    try {
        // 1. Add player to ActivePlayers if not already present
        await docClient.send(new PutCommand({
            TableName: 'ActivePlayers',
            Item: { id: playerId },
            ConditionExpression: 'attribute_not_exists(id)', // Only add if not exists
        })).catch(err => {
            // Ignore ConditionalCheckFailedException (player already exists)
            if (err.name !== 'ConditionalCheckFailedException') throw err;
        });

        // 2. Find all active games for this player
        const gamesResult = await docClient.send(new QueryCommand({
            TableName: 'ActiveGames',
            IndexName: 'PlayerIndex', // Assumes a GSI on playerIds
            KeyConditionExpression: 'playerIds = :pid',
            ExpressionAttributeValues: { ':pid': playerId }
        }));

        // 3. Pick a random game for this player where it is their turn
        let games = gamesResult.Items || [];
        const turnGames = games.filter(g => g.state && g.state.turn === playerId);

        // 4. If no games, create one with another random active player
        if (turnGames.length === 0) {
            const MAX_ACTIVE_GAMES_PER_PLAYER = 10;
            if (games.length > MAX_ACTIVE_GAMES_PER_PLAYER) {
                return res.status(429).json({ error: 'Too many active turns. Please let opponents make take their turns before continuing.' });
            }

            // Get all active players except current
            const activePlayersResult = await docClient.send(new QueryCommand({
                TableName: 'ActivePlayers',
            }));
            const activePlayers = (activePlayersResult.Items || []).filter(p => p.id !== playerId);

            if (activePlayers.length === 0) {
                return res.status(400).json({ error: 'No other active players available for a game.' });
            }

            // Pick a random opponent
            const opponent = activePlayers[Math.floor(Math.random() * activePlayers.length)];

            // Create new game
            const gameId = randomUUID();
            const newGame = {
                id: gameId,
                turnId: randomUUID(), // Unique turn identifier
                playerIds: [playerId, opponent.id],
                state: {
                    // Initial Mancala board state (example)
                    board: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0],
                    turn: playerId,
                    status: 'active'
                },
                history: [],
                createdAt: new Date().toISOString()
            };

            await docClient.send(new PutCommand({
                TableName: 'ActiveGames',
                Item: newGame
            }));

            turnGames = [newGame];
        }

        let game = turnGames[Math.floor(Math.random() * turnGames.length)];

        // Transform the board so that the current player is always player 1 (bottom side)
        let board = game.state.board;
        if (game.playerIds[0] !== playerId) {
            // Flip the board for player 2
            board = [
            ...board.slice(7, 13), // pits 7-12 become 0-5
            board[13],             // player 2's store becomes 6
            ...board.slice(0, 6),  // pits 0-5 become 7-12
            board[6]               // player 1's store becomes 13
            ];
        }
        res.json({ turnId, board });
    } catch (error) {
        console.error('Error in /players/:playerId/games:', error);
        res.status(500).json({ error: 'Failed to get or create game' });
    }
});

app.post('/players/:playerId/turns/:turnId', async (req, res) => {
    const { playerId, turnId } = req.params;
    const { pit } = req.body; // The pit index the player wants to move from

    // If the current player is player 2 (board was flipped for them), unflip just their selected pit index
    const playerIdx = game.playerIds.indexOf(playerId);
    const isPlayer1 = playerIdx === 0;
    if (!isPlayer1) {
        let unflippedPit = pit;
        // Unflip pit index: pits 0-5 map to 7-12, 6 to 13 (store)
        if (pit >= 0 && pit <= 5) {
            pit = pit + 7;
        } else if (pit === 6) {
            pit = 13;
        } else {
            return res.status(400).json({ error: 'Missing or invalid pit index.' });
        }
    }

    if (typeof pit !== 'number') {
        return res.status(400).json({ error: 'Missing or invalid pit index.' });
    }

    try {
        // Fetch the game
        const gameResult = await docClient.send(new GetCommand({
            TableName: 'ActiveGames',
            Key: { turnId: turnId }
        }));

        const game = gameResult.Item;
        if (!game) {
            return res.status(404).json({ error: 'Turn not found.' });
        }

        // Validate player is part of the game
        if (!game.playerIds.includes(playerId)) {
            return res.status(403).json({ error: 'Player not part of this game.' });
        }

        // Validate turn
        if (game.state.turn !== playerId) {
            return res.status(400).json({ error: 'Not your turn.' });
        }

        // Validate pit selection (basic checks)
        const board = game.state.board;
        const playerIdx = game.playerIds.indexOf(playerId);
        const isPlayer1 = playerIdx === 0;
        const pitStart = isPlayer1 ? 0 : 7;
        const pitEnd = isPlayer1 ? 5 : 12;
        if (pit < pitStart || pit > pitEnd || board[pit] === 0) {
            return res.status(400).json({ error: 'Invalid pit selection.' });
        }

        // --- Apply Mancala move logic ---
        // Simple implementation: sow stones, update board, determine next turn
        let stones = board[pit];
        board[pit] = 0;
        let idx = pit;
        while (stones > 0) {
            idx = (idx + 1) % 14;
            // Skip opponent's store
            if ((isPlayer1 && idx === 13) || (!isPlayer1 && idx === 6)) continue;
            board[idx]++;
            stones--;
        }

        // Check if last stone landed in player's store for extra turn
        let nextTurn = game.state.turn;
        if ((isPlayer1 && idx === 6) || (!isPlayer1 && idx === 13)) {
            // Player gets another turn
            nextTurn = playerId;
        } else {
            // Switch turn
            nextTurn = game.playerIds[1 - playerIdx];
        }

        // Check for game end (one side empty)
        const player1Empty = board.slice(0, 6).every(x => x === 0);
        const player2Empty = board.slice(7, 13).every(x => x === 0);
        let status = 'active';
        if (player1Empty || player2Empty) {
            // Collect remaining stones to respective stores
            board[6] += board.slice(0, 6).reduce((a, b) => a + b, 0);
            board[13] += board.slice(7, 13).reduce((a, b) => a + b, 0);
            board.fill(0, 0, 6);
            board.fill(0, 7, 13);
            status = 'finished';

            // --- Update player scores ---
            // Determine winner
            const player1Score = board[6];
            const player2Score = board[13];
            let winnerId = null;
            let loserId = null;
            let draw = false;
            if (player1Score > player2Score) {
                winnerId = game.playerIds[0];
                loserId = game.playerIds[1];
            } else if (player2Score > player1Score) {
                winnerId = game.playerIds[1];
                loserId = game.playerIds[0];
            } else {
                draw = true;
            }

            finishedGameEmitter.emit(game.playerIds[0], { ...game, state: updatedState, history });
            finishedGameEmitter.emit(game.playerIds[1], { ...game, state: updatedState, history });

            // Fetch both players
            const [player1Result, player2Result] = await Promise.all([
                docClient.send(new GetCommand({
                    TableName: 'Players',
                    Key: { id: game.playerIds[0] }
                })),
                docClient.send(new GetCommand({
                    TableName: 'Players',
                    Key: { id: game.playerIds[1] }
                }))
            ]);
            const player1 = player1Result.Item;
            const player2 = player2Result.Item;

            // ELO calculation
            const expected1 = 1 / (1 + Math.pow(10, ((player2.score - player1.score) / 400)));
            const expected2 = 1 / (1 + Math.pow(10, ((player1.score - player2.score) / 400)));
            let score1, score2;
            if (draw) {
                score1 = 0.5;
                score2 = 0.5;
            } else if (winnerId === player1.id) {
                score1 = 1;
                score2 = 0;
            } else {
                score1 = 0;
                score2 = 1;
            }
            const newScore1 = Math.round(player1.score + K_FACTOR * (score1 - expected1));
            const newScore2 = Math.round(player2.score + K_FACTOR * (score2 - expected2));

            // Update players
            await Promise.all([
                docClient.send(new UpdateCommand({
                    TableName: 'Players',
                    Key: { id: player1.id },
                    UpdateExpression: 'SET #score = :score, #wins = if_not_exists(#wins, :zero) + :w, #losses = if_not_exists(#losses, :zero) + :l, #lastPlayedAt = :now',
                    ExpressionAttributeNames: {
                        '#score': 'score',
                        '#wins': 'wins',
                        '#losses': 'losses',
                        '#lastPlayedAt': 'lastPlayedAt'
                    },
                    ExpressionAttributeValues: {
                        ':score': newScore1,
                        ':w': draw ? 0 : (winnerId === player1.id ? 1 : 0),
                        ':l': draw ? 0 : (winnerId === player2.id ? 1 : 0),
                        ':zero': 0,
                        ':now': new Date().toISOString()
                    }
                })),
                docClient.send(new UpdateCommand({
                    TableName: 'Players',
                    Key: { id: player2.id },
                    UpdateExpression: 'SET #score = :score, #wins = if_not_exists(#wins, :zero) + :w, #losses = if_not_exists(#losses, :zero) + :l, #lastPlayedAt = :now',
                    ExpressionAttributeNames: {
                        '#score': 'score',
                        '#wins': 'wins',
                        '#losses': 'losses',
                        '#lastPlayedAt': 'lastPlayedAt'
                    },
                    ExpressionAttributeValues: {
                        ':score': newScore2,
                        ':w': draw ? 0 : (winnerId === player2.id ? 1 : 0),
                        ':l': draw ? 0 : (winnerId === player1.id ? 1 : 0),
                        ':zero': 0,
                        ':now': new Date().toISOString()
                    }
                }))
            ]);
        }

        // Add move to history
        const move = {
            turnId: turnId,
            board: [...board],
            player: playerId,
            pit,
            timestamp: new Date().toISOString()
        };
        const history = Array.isArray(game.history) ? [...game.history, move] : [move];

        // Update game state
        const updatedState = {
            board,
            turn: nextTurn,
            status
        };

        await docClient.send(new UpdateCommand({
            TableName: 'ActiveGames',
            Key: { id: gameId },
            UpdateExpression: 'SET #state = :state, #history = :history',
            ExpressionAttributeNames: {
                '#state': 'state',
                '#history': 'history'
            },
            ExpressionAttributeValues: {
                ':state': updatedState,
                ':history': history
            }
        }));

        res.json(null); // Respond with empty body on success
    } catch (error) {
        console.error('Error submitting move:', error);
        res.status(500).json({ error: 'Failed to submit move.' });
    }
});

// --- SSE Event Emitter for Finished Games ---
const finishedGameEmitter = new EventEmitter();

// Listen for finished games and emit to SSE clients
app.get('/player/:playerId/games', (req, res) => {
    const { playerId } = req.params;

    // Set headers for SSE
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.flushHeaders();

    let closed = false;
    req.on('close', () => {
        closed = true;
        finishedGameEmitter.removeListener(playerId, handler);
    });

    // Helper to send SSE event
    function sendEvent(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    // Handler for finished games
    function handler(game) {
        if (closed) return;
        // Determine win/loss/draw for this player
        const playerIdx = game.playerIds.indexOf(playerId);
        if (playerIdx === -1) return;
        const playerStoreIdx = playerIdx === 0 ? 6 : 13;
        const opponentStoreIdx = playerIdx === 0 ? 13 : 6;
        const playerScore = game.state.board[playerStoreIdx];
        const opponentScore = game.state.board[opponentStoreIdx];
        let result = 'draw';
        if (playerScore > opponentScore) result = 'win';
        else if (playerScore < opponentScore) result = 'loss';

        (game.history || []).forEach(move => {
            if (move.player === playerId) {
                // Transform the move so it always appears the player was player 1 (bottom side)
                let transformedMove = { ...move };
                if (game.playerIds[0] !== playerId) {
                    // Flip the board for player 2's perspective
                    transformedMove.board = [
                        ...move.board.slice(7, 13), // pits 7-12 become 0-5
                        move.board[13],             // player 2's store becomes 6
                        ...move.board.slice(0, 6),  // pits 0-5 become 7-12
                        move.board[6]               // player 1's store becomes 13
                    ];
                    // Flip pit index if needed
                    if (typeof move.pit === 'number') {
                        if (move.pit >= 0 && move.pit <= 5) {
                            transformedMove.pit = move.pit + 7;
                        } else if (move.pit === 6) {
                            transformedMove.pit = 13;
                        }
                    }
                }
                sendEvent({
                    move: transformedMove,
                    result
                });
            }
        });
    }

    finishedGameEmitter.on(playerId, handler);
});

// --- START SERVER ---

async function ensureTable(params, gsiParams = []) {
    const { TableName } = params;
    const tables = await dbClient.send(new ListTablesCommand({}));
    if (!tables.TableNames.includes(TableName)) {
        await dbClient.send(new CreateTableCommand(params));
        // Wait for table to be ACTIVE
        let status = 'CREATING';
        while (status !== 'ACTIVE') {
            await new Promise(r => setTimeout(r, 1000));
            const desc = await dbClient.send(new DescribeTableCommand({ TableName }));
            status = desc.Table.TableStatus;
        }
    }
    // Add GSIs if needed
    if (gsiParams.length > 0) {
        const desc = await dbClient.send(new DescribeTableCommand({ TableName }));
        const existingGSIs = (desc.Table.GlobalSecondaryIndexes || []).map(gsi => gsi.IndexName);
        for (const gsi of gsiParams) {
            if (!existingGSIs.includes(gsi.IndexName)) {
                await dbClient.send(new UpdateTableCommand({
                    TableName,
                    AttributeDefinitions: params.AttributeDefinitions,
                    GlobalSecondaryIndexUpdates: [
                        { Create: gsi }
                    ]
                }));
                // Wait for GSI to be ACTIVE
                let gsiStatus = 'CREATING';
                while (gsiStatus !== 'ACTIVE') {
                    await new Promise(r => setTimeout(r, 1000));
                    const desc2 = await dbClient.send(new DescribeTableCommand({ TableName }));
                    const gsiDesc = (desc2.Table.GlobalSecondaryIndexes || []).find(idx => idx.IndexName === gsi.IndexName);
                    if (gsiDesc) gsiStatus = gsiDesc.IndexStatus;
                }
            }
        }
    }
}

(async () => {
    // Players table
    await ensureTable({
        TableName: 'Players',
        AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' }
        ],
        KeySchema: [
            { AttributeName: 'id', KeyType: 'HASH' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    });

    // ActivePlayers table
    await ensureTable({
        TableName: 'ActivePlayers',
        AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' }
        ],
        KeySchema: [
            { AttributeName: 'id', KeyType: 'HASH' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    });

    // ActiveGames table with GSI for playerIds
    await ensureTable({
        TableName: 'ActiveGames',
        AttributeDefinitions: [
            { AttributeName: 'id', AttributeType: 'S' },
            { AttributeName: 'turnId', AttributeType: 'S' },
            { AttributeName: 'playerIds', AttributeType: 'S' }
        ],
        KeySchema: [
            { AttributeName: 'id', KeyType: 'HASH' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    }, [
        {
            IndexName: 'PlayerIndex',
            KeySchema: [
                { AttributeName: 'playerIds', KeyType: 'HASH' }
            ],
            Projection: { ProjectionType: 'ALL' }
        }
    ]);
})();

app.listen(PORT, () => {
    console.log(`\n============================================`);
    console.log(`  Mancala Tournament Server is running!`);
    console.log(`  API Base URL: http://localhost:${PORT}`);
    console.log(`============================================\n`);
});
