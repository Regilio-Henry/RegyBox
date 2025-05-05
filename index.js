const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server);

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  socket.on('create_room', () => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostSocketId: socket.id,
      players: [],
      responses: []
    };

    console.log(`Room created: ${roomCode} by ${socket.id}`);
    socket.emit('room_created', roomCode);
  });

  socket.on('join_room', (data) => {
    const { name, room } = data;
    const roomCode = room.toUpperCase();

    if (!rooms[roomCode]) {
      console.log(`Join failed: room ${roomCode} not found.`);
      socket.emit('join_error', { message: 'Room does not exist.' });
      return;
    }

    const nameExists = rooms[roomCode].players.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (nameExists) {
      console.log(`Join failed: name "${name}" already exists in room ${roomCode}.`);
      socket.emit('join_error', { message: 'That name is already taken in this room.' });
      return;
    }

    rooms[roomCode].players.push({ name, socketId: socket.id });

    console.log(`${name} joined room ${roomCode}`);

    const playerCount = rooms[roomCode].players.length;

    const hostSocketId = rooms[roomCode].hostSocketId;
    io.to(hostSocketId).emit('player_joined', name);

    socket.emit('join_success', { room: roomCode, playerCount });
  });

  // Handle Unity sending a prompt to players
  socket.on('send_prompt', (payload) => {
    const roomCode = payload.room?.toUpperCase();
    const question = payload.question;

    if (!rooms[roomCode]) {
      console.log(`send_prompt failed: room ${roomCode} not found.`);
      return;
    }

    console.log(`Broadcasting prompt to room ${roomCode}: ${question}`);

    // Reset responses
    rooms[roomCode].responses = [];

    // Broadcast prompt to all players
    rooms[roomCode].players.forEach(player => {
      io.to(player.socketId).emit('receive_prompt', { question });
    });
  });

  // Handle player submitting response
  socket.on('submit_response', (data) => {
    const { room, name, answer } = data;
    const roomCode = room.toUpperCase();

    if (!rooms[roomCode]) {
      console.log(`submit_response failed: room ${roomCode} not found.`);
      return;
    }

    console.log(`Received response from ${name} in room ${roomCode}: ${answer}`);

    rooms[roomCode].responses.push({ name, answer });

    // Check if all players have submitted
    if (rooms[roomCode].responses.length >= rooms[roomCode].players.length) {
      const hostSocketId = rooms[roomCode].hostSocketId;
      console.log(`All responses received for room ${roomCode}. Sending to host.`);

      // Send all responses to Unity
      io.to(hostSocketId).emit('prompt_response', rooms[roomCode].responses);
    }
  });

  socket.on('start_game', (data) => {
    const roomCode = data.room.toUpperCase();
    if (rooms[roomCode]) {
      rooms[roomCode].players.forEach(player => {
        io.to(player.socketId).emit('game_started');
      });

      io.to(rooms[roomCode].hostSocketId).emit('start_game');
      
      console.log(`Game started in room ${roomCode}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket ${socket.id} disconnected`);
  });
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
