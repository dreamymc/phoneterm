let ctrlActive = false;
let activeShell = 'bash';

// Retrieve token from local storage
const token = localStorage.getItem('phoneterm_token');
if (!token) {
  window.location.href = '/';
  throw new Error('Redirecting: no auth token.');
}

// Setup WebSocket connection
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/terminal?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(wsUrl);

// Initialize xterm.js terminal
const term = new Terminal({
  cursorBlink: true,
  theme: {
    background: '#0d0d0d',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0'
  },
  fontSize: 14,
  fontFamily: 'Consolas, "Liberation Mono", Menlo, Courier, monospace'
});

const fitAddon = new FitAddon.FitAddon();
const webLinksAddon = new WebLinksAddon.WebLinksAddon();

term.loadAddon(fitAddon);
term.loadAddon(webLinksAddon);
term.open(document.getElementById('terminal-container'));

// Resize terminal and send to server
function resizeTerminal() {
  try {
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows
      }));
    }
  } catch (err) {
    console.error("Error running resizeTerminal:", err);
  }
}

ws.onopen = () => {
  console.log("WebSocket connected.");
  resizeTerminal();
};

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'output') {
      term.write(msg.data);
    } else if (msg.type === 'exit') {
      term.write(`\r\n\x1b[33m[Shell exited — ${msg.shell} returned code ${msg.code}]\x1b[0m\r\n`);
      term.write(`\x1b[32m[Use the dropdown at the top to spawn another shell or reconnect]\x1b[0m\r\n`);
    }
  } catch (err) {
    console.error("Error parsing WebSocket message:", err);
  }
};

ws.onclose = (event) => {
  if (event.code === 4001) {
    term.write('\r\n[Authentication failed or expired. Redirecting to login...]\r\n');
    localStorage.removeItem('phoneterm_token');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  } else {
    term.write('\r\n[Connection closed]\r\n');
  }
};

ws.onerror = (err) => {
  term.write(`\r\n[WebSocket error: ${err.message || 'unknown'}]\r\n`);
};

// Handle user typing
term.onData((data) => {
  if (ws.readyState !== WebSocket.OPEN) return;

  if (ctrlActive) {
    // Check if the input is a single alphabetical character
    const char = data.toUpperCase();
    if (char.length === 1 && char.charCodeAt(0) >= 65 && char.charCodeAt(0) <= 90) {
      const ctrlCode = String.fromCharCode(char.charCodeAt(0) - 64);
      ws.send(JSON.stringify({ type: 'input', data: ctrlCode }));
    } else {
      // Send unmodified sequence
      ws.send(JSON.stringify({ type: 'input', data }));
    }
    toggleCtrl(false);
  } else {
    ws.send(JSON.stringify({ type: 'input', data }));
  }
});

// Setup Mobile Toolbar CTRL Toggle
const ctrlBtn = document.getElementById('ctrl-btn');
function toggleCtrl(state) {
  ctrlActive = state !== undefined ? state : !ctrlActive;
  if (ctrlActive) {
    ctrlBtn.classList.add('active');
  } else {
    ctrlBtn.classList.remove('active');
  }
}

ctrlBtn.addEventListener('click', (e) => {
  e.preventDefault();
  toggleCtrl();
});

// Special sequences mapping for touch buttons
const seqMap = {
  'esc': '\x1b',
  'tab': '\t',
  'up': '\x1b[A',
  'down': '\x1b[B',
  'left': '\x1b[D',
  'right': '\x1b[C',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04'
};

document.querySelectorAll('.key-btn[data-seq]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const seqName = btn.getAttribute('data-seq');
    const seq = seqMap[seqName];
    if (seq && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: seq }));
    }
  });
});

// Watch visualViewport for mobile keyboard height shifts
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeTerminal);
} else {
  window.addEventListener('resize', resizeTerminal);
}
// Initial fit
setTimeout(resizeTerminal, 100);

// Handle Logout Action
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm("Disconnect and log out of PhoneTerm?")) {
      localStorage.removeItem('phoneterm_token');
      ws.close(1000, 'logout');
      window.location.href = '/';
    }
  });
}

// Handle Shell Switcher Selection
const shellSelect = document.getElementById('shell-select');
if (shellSelect) {
  shellSelect.value = activeShell;

  shellSelect.addEventListener('change', () => {
    const selectedShell = shellSelect.value;
    const displayName = shellSelect.options[shellSelect.selectedIndex].text;
    if (confirm(`Switch to ${displayName}? The current session will be terminated.`)) {
      activeShell = selectedShell;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'shell',
          shell: selectedShell,
          cols: term.cols,
          rows: term.rows
        }));
      }
    } else {
      shellSelect.value = activeShell;
    }
  });
}
