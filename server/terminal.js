const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const config = require('./config');

// Detect and cache WSL mount point at module level to avoid repeated disk checks
const WSL_MOUNT = fs.existsSync('/mnt/c') ? '/mnt/c' : (fs.existsSync('/c') ? '/c' : null);

const activeSessions = new Map();
const MAX_BUFFER_LENGTH = 50 * 1024; // 50KB

const parseDim = (val, defaultValue) => {
  const parsed = parseInt(val, 10);
  return (isNaN(parsed) || parsed < 1) ? defaultValue : parsed;
};

/**
 * Resolves the absolute path for the requested shell executable.
 */
function resolveShellPath(shell) {
  switch (shell) {
    case 'bash':
      return '/bin/bash';
    case 'zsh':
      return fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
    case 'cmd': {
      if (!WSL_MOUNT) return null;
      const candidates = [
        `${WSL_MOUNT}/Windows/System32/cmd.exe`,
        `${WSL_MOUNT}/windows/system32/cmd.exe`,
        `${WSL_MOUNT}/WINDOWS/SYSTEM32/cmd.exe`
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return null;
    }
    case 'powershell': {
      if (!WSL_MOUNT) return null;
      const candidates = [
        `${WSL_MOUNT}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`,
        `${WSL_MOUNT}/windows/system32/windowspowershell/v1.0/powershell.exe`,
        `${WSL_MOUNT}/WINDOWS/SYSTEM32/WINDOWSPOWERSHELL/V1.0/powershell.exe`,
        `${WSL_MOUNT}/Windows/System32/windowspowershell/v1.0/powershell.exe`,
        `${WSL_MOUNT}/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe`
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return null;
    }
    default:
      return '/bin/bash';
  }
}

/**
 * Cleans up and removes a session.
 */
function cleanupSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.disconnectTimeout) {
    clearTimeout(session.disconnectTimeout);
    session.disconnectTimeout = null;
  }

  if (session.activeDataListener) {
    session.activeDataListener.dispose();
    session.activeDataListener = null;
  }

  if (session.activeExitListener) {
    session.activeExitListener.dispose();
    session.activeExitListener = null;
  }

  if (session.term) {
    try {
      session.term.kill();
    } catch (e) {
      console.error(`Error killing PTY process for session ${sessionId}:`, e);
    }
    session.term = null;
  }

  session.ws = null;
  activeSessions.delete(sessionId);
}

/**
 * Spawns a PTY process for the session.
 */
function spawnSession(sessionId, session, shellName) {
  try {
    const shellPath = resolveShellPath(shellName);
    const homeDir = process.env.HOME || os.homedir();

    let cwd = homeDir;
    if (shellName === 'cmd' || shellName === 'powershell') {
      if (WSL_MOUNT) {
        if (config.WINDOWS_USERPROFILE && config.WINDOWS_USERPROFILE.trim() !== '') {
          if (fs.existsSync(config.WINDOWS_USERPROFILE)) {
            cwd = config.WINDOWS_USERPROFILE;
          } else {
            console.warn(`Windows user profile path "${config.WINDOWS_USERPROFILE}" does not exist. Falling back to mount: ${WSL_MOUNT}`);
            cwd = WSL_MOUNT;
          }
        } else {
          cwd = WSL_MOUNT;
        }
      }
    }

    session.term = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        TERM_PROGRAM: 'phoneterm',
        LANG: process.env.LANG || 'en_US.UTF-8',
      }
    });

    session.shell = shellName;

    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({ type: 'shell-active', shell: shellName }));
    }

    session.activeDataListener = session.term.onData((data) => {
      // Append to the scrollback buffer
      session.buffer += data;
      if (session.buffer.length > MAX_BUFFER_LENGTH) {
        session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_LENGTH);
      }

      // Forward to websocket
      if (session.ws && session.ws.readyState === session.ws.OPEN) {
        session.ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    session.activeExitListener = session.term.onExit(({ exitCode }) => {
      console.log(`PTY process exited for session ${sessionId} with code ${exitCode}`);
      if (session.ws && session.ws.readyState === session.ws.OPEN) {
        session.ws.send(JSON.stringify({ type: 'exit', shell: shellName, code: exitCode }));
      }
      cleanupSession(sessionId);
    });

  } catch (err) {
    console.error(`Error spawning shell ${shellName} in session ${sessionId}:`, err);
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'output',
        data: `\r\n\x1b[31mError spawning shell ${shellName}: ${err.message}\x1b[0m\r\n`
      }));
    }
    if (shellName !== 'bash') {
      spawnSession(sessionId, session, 'bash');
      return;
    }
  }
}

/**
 * Binds message and close event handlers of a WebSocket connection to a session.
 */
function bindSocketToSession(ws, sessionId, session) {
  const messageHandler = (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'input') {
        if (session.term) {
          session.term.write(msg.data);
        }
      } else if (msg.type === 'resize') {
        session.cols = Math.min(1000, parseDim(msg.cols, 80));
        session.rows = Math.min(1000, parseDim(msg.rows, 24));
        if (session.term) {
          session.term.resize(session.cols, session.rows);
        }
      } else if (msg.type === 'shell') {
        const targetShell = msg.shell;
        const shellPath = resolveShellPath(targetShell);
        const isAvailable = shellPath && fs.existsSync(shellPath);

        if (!isAvailable) {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'output',
              data: `\r\n\x1b[31mError: Shell "${targetShell}" is not available.\x1b[0m\r\n`
            }));
            ws.send(JSON.stringify({ type: 'shell-active', shell: session.shell }));
          }
        } else {
          // Reset buffer on shell change
          session.buffer = '';

          // Clean up current PTY first
          if (session.activeDataListener) {
            session.activeDataListener.dispose();
            session.activeDataListener = null;
          }
          if (session.activeExitListener) {
            session.activeExitListener.dispose();
            session.activeExitListener = null;
          }
          if (session.term) {
            try {
              session.term.kill();
            } catch (e) {
              console.error(`Error killing PTY process for shell switch in session ${sessionId}:`, e);
            }
            session.term = null;
          }

          spawnSession(sessionId, session, targetShell);
        }
      }
    } catch (err) {
      console.error(`Error processing client message for session ${sessionId}:`, err);
    }
  };

  const closeHandler = (code, reason) => {
    // Only handle if this socket is still the active socket for the session
    if (session.ws !== ws) {
      return;
    }

    const reasonStr = reason ? reason.toString() : '';

    if (reasonStr === 'logout') {
      cleanupSession(sessionId);
    } else {
      session.ws = null;
      session.disconnectTimeout = setTimeout(() => {
        cleanupSession(sessionId);
      }, 60000);
    }
  };

  ws.on('message', messageHandler);
  ws.on('close', closeHandler);
}

/**
 * Spawns or restores a PTY session and binds its stdin/stdout to the given WebSocket.
 */
function spawnTerminal(ws, sessionId, initialShell = 'bash') {
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);

    // Clear the disconnect timeout if running
    if (session.disconnectTimeout) {
      clearTimeout(session.disconnectTimeout);
      session.disconnectTimeout = null;
    }

    // Close the previous WebSocket if it exists and is different from the new one
    if (session.ws && session.ws !== ws) {
      try {
        session.ws.close();
      } catch (e) {
        console.error(`Error closing old WebSocket for session ${sessionId}:`, e);
      }
    }

    // Bind the new WebSocket
    session.ws = ws;

    // Send the rolling scrollback history buffer
    if (session.buffer && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: session.buffer }));
    }

    // Send the active shell state notification
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'shell-active', shell: session.shell }));
    }

    // Bind WebSocket message handlers and close handler to this session
    bindSocketToSession(ws, sessionId, session);
  } else {
    // Create a new session object
    const session = {
      term: null,
      shell: initialShell,
      cols: 80,
      rows: 24,
      buffer: '',
      ws: ws,
      activeDataListener: null,
      activeExitListener: null,
      disconnectTimeout: null
    };
    activeSessions.set(sessionId, session);

    // Spawn the initial PTY process
    spawnSession(sessionId, session, initialShell);

    // Bind WebSocket message handlers and close handler to this session
    bindSocketToSession(ws, sessionId, session);
  }
}

module.exports = {
  spawnTerminal
};
