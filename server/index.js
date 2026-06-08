const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ip = require('ip');
const chalkModule = require('chalk');
const chalk = chalkModule.default || chalkModule;
const config = require('./config');
const { spawnTerminal } = require('./terminal');

const app = express();
const server = http.createServer(app);

// Create WebSocket server attached to the same HTTP server
const wss = new WebSocket.Server({ noServer: true });

// Serve client directory statically
app.use(express.static(path.join(__dirname, '../client')));

// Redirect root to terminal.html for Phase 1
app.get('/', (req, res) => {
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

wss.on('connection', (ws) => {
  console.log("New WebSocket client connected.");
  // Default to bash for Phase 1 (no auth yet)
  spawnTerminal(ws, 'bash');
});

// Start listening on 0.0.0.0:PORT
server.listen(config.PORT, '0.0.0.0', () => {
  const localIp = ip.address();
  console.log(chalk.green('╔═══════════════════════════════════════╗'));
  console.log(chalk.green('║         PhoneTerm is running          ║'));
  console.log(chalk.green('╠═══════════════════════════════════════╣'));
  console.log(chalk.green(`║  Local:    http://${localIp}:${config.PORT}    ║`));
  console.log(chalk.green('╚═══════════════════════════════════════╝'));
});
