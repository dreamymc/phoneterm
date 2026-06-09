const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const config = require('./config');

// Detect and cache WSL mount point at module level to avoid repeated disk checks
const WSL_MOUNT = fs.existsSync('/mnt/c') ? '/mnt/c' : (fs.existsSync('/c') ? '/c' : null);

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
 * Spawns a PTY process and binds its stdin/stdout to the given WebSocket.
 */
function spawnTerminal(ws, initialShell = 'bash') {
  let term = null;
  let activeDataListener = null;
  let activeExitListener = null;
  let cols = 80;
  let rows = 24;

  function createPty(shellName) {
    const shellPath = resolveShellPath(shellName);
    const homeDir = process.env.HOME || os.homedir();

    let cwd = homeDir;
    if (shellName === 'cmd' || shellName === 'powershell') {
      if (WSL_MOUNT) {
        if (config.WINDOWS_USERNAME && config.WINDOWS_USERNAME.trim() !== '') {
          const profilePath = `${WSL_MOUNT}/Users/${config.WINDOWS_USERNAME}`;
          if (fs.existsSync(profilePath)) {
            cwd = profilePath;
          } else {
            console.warn(`Windows user profile path "${profilePath}" does not exist. Falling back to mount: ${WSL_MOUNT}`);
            cwd = WSL_MOUNT;
          }
        } else {
          cwd = WSL_MOUNT;
        }
      }
    }

    return pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: cols,
      rows: rows,
      cwd: cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      }
    });
  }

  function cleanupPty() {
    if (activeDataListener) {
      activeDataListener.dispose();
      activeDataListener = null;
    }
    if (activeExitListener) {
      activeExitListener.dispose();
      activeExitListener = null;
    }
    if (term) {
      try {
        term.kill();
      } catch (e) {
        console.error("Error killing PTY process:", e);
      }
      term = null;
    }
  }

  function teardownSession() {
    cleanupPty();
    ws.off('message', messageHandler);
  }

  function spawnSession(shellName) {
    try {
      term = createPty(shellName);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'shell-active', shell: shellName }));
      }

      activeDataListener = term.onData((data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data }));
        }
      });

      activeExitListener = term.onExit(({ exitCode }) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', shell: shellName, code: exitCode }));
        }
        cleanupPty();
      });
    } catch (err) {
      console.error(`Error spawning shell ${shellName}:`, err);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\n\x1b[31mError spawning shell ${shellName}: ${err.message}\x1b[0m\r\n`
        }));
      }
      if (shellName !== 'bash') {
        spawnSession('bash');
        return;
      }
    }

    ws.off('message', messageHandler);
    ws.on('message', messageHandler);
  }

  function messageHandler(message) {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'input') {
        if (term) {
          term.write(msg.data);
        }
      } else if (msg.type === 'resize') {
        cols = Math.min(1000, parseDim(msg.cols, 80));
        rows = Math.min(1000, parseDim(msg.rows, 24));
        if (term) {
          term.resize(cols, rows);
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
          }
        } else {
          teardownSession();
          spawnSession(targetShell);
          if (term) {
            term.resize(cols, rows);
          }
        }
      }
    } catch (err) {
      console.error("Error processing client message:", err);
    }
  }

  // Spawn initial PTY and bind listeners
  spawnSession(initialShell);

  // Clean up PTY on connection close
  ws.on('close', () => {
    console.log("WebSocket connection closed. Tearing down session...");
    teardownSession();
  });
}

module.exports = {
  spawnTerminal
};
