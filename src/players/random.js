// Mancala Random AI Player using the Mancala APIs
// This script creates a player and always picks a random available pit when playing

const axios = require('axios');

const API_BASE = 'http://localhost:3000';

async function createPlayer() {
    const res = await axios.post(`${API_BASE}/players`);
    return res.data.id;
}

async function getTurn(playerId) {
    // Returns { turnId, board }
    const res = await axios.get(`${API_BASE}/players/${playerId}/turns`);
    return res.data;
}

async function makeMove(playerId, turnId, pit) {
    await axios.post(`${API_BASE}/players/${playerId}/turns/${turnId}`, { pit });
    return;
}

function getRandomPit(board) {
    // Player is always player 1 (pits 0-5)
    const availablePits = [];
    for (let i = 0; i <= 5; i++) {
        if (board[i] > 0) availablePits.push(i);
    }
    if (availablePits.length === 0) return null;
    return availablePits[Math.floor(Math.random() * availablePits.length)];
}

async function playRandomGame() {
    const playerId = await createPlayer();
    console.log('Created player:', playerId);
    while (true) {
        try {
            const { turnId, board } = await getTurn(playerId);
            if (!board || !turnId) {
                console.log('No board or turnId available. Waiting...');
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            const pit = getRandomPit(board);
            if (pit === null) {
                console.log('No available moves. Game may be over.');
                break;
            }
            console.log(`Player ${playerId} plays pit ${pit} (turnId: ${turnId})`);
            const moveResult = await makeMove(playerId, turnId, pit);
            // Wait a bit before next move
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error('Error:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

// If run directly, play a random game
if (require.main === module) {
    playRandomGame();
}

module.exports = { playRandomGame, getRandomPit };
