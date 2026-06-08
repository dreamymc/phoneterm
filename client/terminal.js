let ctrlActive = false;

// WebSocket setup
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/terminal`;
const ws = new WebSocket(wsUrl);

// xterm.js setup
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
window.term = term;

const fitAddon = new FitAddon.FitAddon();
const webLinksAddon = new WebLinksAddon.WebLinksAddon();

term.loadAddon(fitAddon);
term.loadAddon(webLinksAddon);
term.open(document.getElementById('terminal-container'));

// Function to fit terminal and notify server
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
    console.error("Error fitting terminal:", err);
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
      term.write(`\r\n[Shell exited with code ${msg.code}]\r\n`);
    }
  } catch (err) {
    console.error("Error parsing message from server:", err);
  }
};

ws.onclose = () => {
  term.write('\r\n[Connection closed]\r\n');
};

term.onData((data) => {
  if (ws.readyState === WebSocket.OPEN) {
    if (ctrlActive && data.length === 1) {
      const char = data.toUpperCase();
      if (char.charCodeAt(0) >= 65 && char.charCodeAt(0) <= 90) {
        const ctrlCode = String.fromCharCode(char.charCodeAt(0) - 64);
        ws.send(JSON.stringify({ type: 'input', data: ctrlCode }));
      } else {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
      toggleCtrl(false);
    } else {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }
});

// Setup Mobile Toolbar CTRL Button
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

// Setup toolbar button escape sequences
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
    term.focus(); // Keep terminal focused
  });
});

// Watch visualViewport for mobile keyboard height shifts
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeTerminal);
} else {
  window.addEventListener('resize', resizeTerminal);
}

// Initial fit after a tiny delay to allow container dimensions to settle
setTimeout(resizeTerminal, 100);
