const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

// Read configuration file
const configPath = path.join(__dirname, '../config.json');
let config = { port: 3000 };
try { 
  config = JSON.parse(fs.readFileSync(configPath, 'utf8')); 
} catch (e) { 
  console.warn('Config file not found, using default port 3000'); 
}

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Define PORT early so it can be used throughout the application
const PORT = process.env.PORT || config.port || 3000;

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Serve the configuration
app.get('/config.json', (req, res) => {
  res.json({ port: PORT });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // When a client sends audio data
  socket.on('audio', (audioChunk) => {
    // Relay audio data to all other clients (excluding sender)
    socket.broadcast.emit('audio', audioChunk);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Emit connection status to the newly connected client
  socket.emit('status', { connected: true, clients: io.engine.clientsCount });
  
  // Broadcast to all clients that a new user joined
  socket.broadcast.emit('user-joined', { 
    id: socket.id, 
    totalClients: io.engine.clientsCount 
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Something went wrong!');
});

// Start the server
server.listen(PORT, () => {
  console.log(`Audio chat server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});