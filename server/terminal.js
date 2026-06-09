const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const config = require('./config');

/**
 * Resolves the absolute path for the requested shell executable.
 */
function resolveShellPath(shell) {
  const mount = fs.existsSync('/mnt/c') ? '/mnt/c' : (fs.existsSync('/c') ? '/c' : null);
  switch (shell) {
    case 'bash':
      return '/bin/bash';
    case 'zsh':
      if (fs.existsSync('/bin/zsh')) {
        return '/bin/zsh';
      }
      return '/bin/bash';
    case 'cmd':
      return mount ? `${mount}/Windows/System32/cmd.exe` : null;
    case 'powershell':
      return mount ? `${mount}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` : null;
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
      const mount = fs.existsSync('/mnt/c') ? '/mnt/c' : (fs.existsSync('/c') ? '/c' : null);
      if (mount) {
        if (config.WINDOWS_USERNAME && config.WINDOWS_USERNAME.trim() !== '') {
          cwd = `${mount}/Users/${config.WINDOWS_USERNAME}`;
        } else {
          cwd = mount;
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
    term = createPty(shellName);

    activeDataListener = term.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    activeExitListener = term.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', shell: shellName, code: exitCode }));
      }
    });

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
        cols = msg.cols;
        rows = msg.rows;
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
