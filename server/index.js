const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ip = require('ip');
const chalkModule = require('chalk');
const chalk = chalkModule.default || chalkModule;
const config = require('./config');
const { spawnTerminal } = require('./terminal');

const jwt = require('jsonwebtoken');
const { authRouter } = require('./auth');

const app = express();
const server = http.createServer(app);

// Create WebSocket server attached to the same HTTP server
const wss = new WebSocket.Server({ noServer: true });

// Parse JSON request bodies
app.use(express.json());

// Serve client directory statically
app.use(express.static(path.join(__dirname, '../client')));

// Mount auth router
app.use('/auth', authRouter);

// Redirect root to index.html (login screen)
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Redirect /term to terminal.html
app.get('/term', (req, res) => {
  res.redirect('/terminal.html');
});

// Handle connection upgrade to /terminal WebSocket
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (pathname === '/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  console.log("New WebSocket client connecting...");
  
  // Extract and verify JWT token from query parameters
  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = searchParams.get('token');
    
    if (!token) {
      console.log("WebSocket connection rejected: Missing token");
      ws.close(4001, 'Unauthorized: Missing token');
      return;
    }
    
    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.log(`WebSocket connection rejected: ${err.message}`);
        ws.close(4001, 'Unauthorized: Invalid token');
        return;
      }
      
      if (ws.readyState !== WebSocket.OPEN) {
        console.log("WebSocket closed before PTY could be spawned.");
        return;
      }
      
      console.log("WebSocket client successfully authenticated.");
      // Spawn terminal process
      spawnTerminal(ws, 'bash');
    });
  } catch (err) {
    console.error("Error during WebSocket verification:", err);
    ws.close(4001, 'Internal authentication error');
  }
});

// Start listening on 0.0.0.0:PORT
server.listen(config.PORT, '0.0.0.0', () => {
  const localIp = ip.address();
  console.log(chalk.green('╔═══════════════════════════════════════╗'));
  console.log(chalk.green('║         PhoneTerm is running          ║'));
  console.log(chalk.green('╠═══════════════════════════════════════╣'));
  console.log(chalk.green(`║  Local:       http://${localIp}:${config.PORT} ║`));
  console.log(chalk.green(`║  Auth Token:  ${config.AUTH_SECRET}  ║`));
  console.log(chalk.green('╚═══════════════════════════════════════╝'));
});
