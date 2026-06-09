'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ip = require('ip');
const chalkModule = require('chalk');
const chalk = chalkModule.default || chalkModule;
const qrcode = require('qrcode-terminal');

const config = require('./config');
const { spawnTerminal } = require('./terminal');
const { startTunnel } = require('./tunnel');

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
  console.log('New WebSocket client connecting...');

  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = searchParams.get('token');

    if (!token) {
      console.log('WebSocket connection rejected: Missing token');
      ws.close(4001, 'Unauthorized: Missing token');
      return;
    }

    jwt.verify(token, config.JWT_SECRET, (err) => {
      if (err) {
        console.log(`WebSocket connection rejected: ${err.message}`);
        ws.close(4001, 'Unauthorized: Invalid token');
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket closed before PTY could be spawned.');
        return;
      }

      console.log('WebSocket client successfully authenticated.');
      spawnTerminal(ws, 'bash');
    });
  } catch (err) {
    console.error('Error during WebSocket verification:', err);
    ws.close(4001, 'Internal authentication error');
  }
});

/**
 * Detects the Windows host username via WSL interop cmd.exe.
 */
function detectWindowsUsername() {
  return new Promise((resolve) => {
    const paths = [
      { cmd: '/mnt/c/Windows/System32/cmd.exe', cwd: '/mnt/c' },
      { cmd: '/mnt/c/Windows/system32/cmd.exe', cwd: '/mnt/c' },
      { cmd: '/c/Windows/System32/cmd.exe', cwd: '/c' },
      { cmd: '/c/Windows/system32/cmd.exe', cwd: '/c' }
    ];

    let target = null;
    for (const p of paths) {
      if (fs.existsSync(p.cmd)) {
        target = p;
        break;
      }
    }

    if (!target) {
      return resolve(null);
    }

    exec(`"${target.cmd}" /c echo %USERNAME% < /dev/null`, { timeout: 2000, cwd: target.cwd }, (error, stdout) => {
      if (error) {
        return resolve(null);
      }
      const username = stdout.trim();
      resolve(username || null);
    });
  });
}

// ─── Async Startup ────────────────────────────────────────────────────────────
server.listen(config.PORT, '0.0.0.0', async () => {
  const localIp = ip.address();
  const localUrl = `http://${localIp}:${config.PORT}`;

  // Query and cache Windows username asynchronously
  try {
    config.WINDOWS_USERNAME = await detectWindowsUsername();
  } catch (err) {
    // Ignore
  }

  // Attempt to start Cloudflare Tunnel
  let publicUrl = null;
  try {
    console.log(chalk.yellow('Starting Cloudflare Tunnel… (this takes ~10 seconds)'));
    publicUrl = await startTunnel(config.PORT);
  } catch (err) {
    console.warn(chalk.yellow(`Warning: Cloudflare Tunnel failed to start: ${err.message}`));
    console.warn(chalk.yellow('Continuing without public URL.'));
  }

  // ── Banner ─────────────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.green('╔' + '═'.repeat(63) + '╗'));
  console.log(chalk.green('║' + '                   PhoneTerm is running                       ' + '║'));
  console.log(chalk.green('╠' + '═'.repeat(63) + '╣'));
  console.log(chalk.green(`║  Local:   ${localUrl.padEnd(51)} ║`));
  if (publicUrl) {
    console.log(chalk.green(`║  Public:  ${publicUrl.padEnd(51)} ║`));
  }
  console.log(chalk.green(`║  Token:   ${config.AUTH_SECRET.padEnd(51)} ║`));
  console.log(chalk.green('╚' + '═'.repeat(63) + '╝'));
  console.log('');

  // ── Local QR Code ──────────────────────────────────────────────────────────
  console.log(chalk.cyan('  ▸ Local Network QR Code:'));
  qrcode.generate(localUrl, { small: true });

  // ── Public QR Code ─────────────────────────────────────────────────────────
  if (publicUrl) {
    console.log(chalk.cyan('  ▸ Public (Cloudflare) QR Code:'));
    qrcode.generate(publicUrl, { small: true });
  }
});
