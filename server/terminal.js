const pty = require('node-pty');
const fs = require('fs');
const os = require('os');

/**
 * Resolves the absolute path for the requested shell executable.
 */
function resolveShellPath(shell) {
  switch (shell) {
    case 'bash':
      return '/bin/bash';
    case 'zsh':
      if (fs.existsSync('/bin/zsh')) {
        return '/bin/zsh';
      }
      return '/bin/bash';
    case 'cmd':
      return '/mnt/c/Windows/System32/cmd.exe';
    case 'powershell':
      return '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
    default:
      return '/bin/bash';
  }
}

/**
 * Spawns a PTY process and binds its stdin/stdout to the given WebSocket.
 */
function spawnTerminal(ws, initialShell = 'bash') {
  let term;
  let activeDataListener;
  let activeExitListener;

  function createPty(shellName) {
    const shellPath = resolveShellPath(shellName);
    const homeDir = process.env.HOME || os.homedir();

    return pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: homeDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      }
    });
  }

  function bindPtyListeners(ptyTerm) {
    activeDataListener = ptyTerm.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    activeExitListener = ptyTerm.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
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
    }
  }

  // Spawn initial PTY and bind listeners
  term = createPty(initialShell);
  bindPtyListeners(term);

  // Handle incoming commands from WebSocket client
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'input') {
        term.write(msg.data);
      } else if (msg.type === 'resize') {
        term.resize(msg.cols, msg.rows);
      } else if (msg.type === 'shell') {
        // Feed feedback to client
        ws.send(JSON.stringify({ type: 'output', data: '\r\n--- Switching shell ---\r\n' }));
        
        // Clean up current PTY process and listeners
        cleanupPty();

        // Re-spawn PTY with new shell and bind new listeners
        term = createPty(msg.shell);
        bindPtyListeners(term);
      }
    } catch (err) {
      console.error("Error processing client message:", err);
    }
  });

  // Clean up PTY on connection close
  ws.on('close', () => {
    console.log("WebSocket connection closed. Killing spawned PTY process...");
    cleanupPty();
  });
}

module.exports = {
  spawnTerminal
};
