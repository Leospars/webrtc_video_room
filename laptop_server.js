const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ip = require('ip');

const app = express();
// Serve static files (your index.html)
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Data Structure:
// rooms = Map<roomId, Map<userId, { ws, name }>>
const rooms = new Map();

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let currentUserId = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON');
            return;
        }

        switch (data.type) {
            case 'join':
                handleJoin(data.roomId, data.name);
                break;
            case 'offer':
                handleForwarding(data.targetUserId, {
                    type: 'offer',
                    senderUserId: currentUserId,
                    senderName: rooms.get(currentRoomId)?.get(currentUserId)?.name,
                    offer: data.offer
                });
                break;
            case 'answer':
                handleForwarding(data.targetUserId, {
                    type: 'answer',
                    senderUserId: currentUserId,
                    answer: data.answer
                });
                break;
            case 'candidate':
                handleForwarding(data.targetUserId, {
                    type: 'candidate',
                    senderUserId: currentUserId,
                    candidate: data.candidate
                });
                break;
            case 'leave':
                handleLeave();
                break;
            default:
                break;
        }
    });

    ws.on('close', () => {
        handleLeave();
    });

    // --- Helper Functions ---

    function handleJoin(roomId, name) {
        if (!roomId || !name) return;

        currentRoomId = roomId;
        // Create a unique ID for the user
        currentUserId = `${name}_${Math.random().toString(36).substring(2, 8)}`;

        // Initialize room if not exists
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }

        const room = rooms.get(roomId);
        
        // 1. Send the list of EXISTING users to the NEW user
        // The new user will initiate offers to these people.
        const existingUsers = Array.from(room.entries()).map(([id, user]) => ({
            userId: id,
            name: user.name
        }));

        ws.send(JSON.stringify({
            type: 'existing-participants',
            participants: existingUsers,
            myUserId: currentUserId
        }));

        // 2. Add new user to the room
        room.set(currentUserId, { ws, name });
        console.log(`${name} (${currentUserId}) joined room ${roomId}`);

        // 3. Notify existing users that a new user joined
        // They will sit back and wait for an offer.
        broadcastToRoom(roomId, currentUserId, {
            type: 'user-joined',
            userId: currentUserId,
            name: name
        });
    }

    function handleForwarding(targetUserId, message) {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (room) {
            const target = room.get(targetUserId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
                target.ws.send(JSON.stringify(message));
            }
        }
    }

    function handleLeave() {
        if (currentRoomId && currentUserId) {
            const room = rooms.get(currentRoomId);
            if (room) {
                room.delete(currentUserId);
                console.log(`${currentUserId} left room ${currentRoomId}`);

                // Notify others so they can remove the video element
                broadcastToRoom(currentRoomId, currentUserId, {
                    type: 'user-left',
                    userId: currentUserId
                });

                if (room.size === 0) {
                    rooms.delete(currentRoomId);
                }
            }
        }
        currentRoomId = null;
        currentUserId = null;
    }

    function broadcastToRoom(roomId, excludeUserId, message) {
        const room = rooms.get(roomId);
        if (!room) return;
        
        for (const [userId, user] of room.entries()) {
            if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(JSON.stringify(message));
            }
        }
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://${ip.address()}:${PORT}`);
});