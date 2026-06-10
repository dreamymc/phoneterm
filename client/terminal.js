let ctrlActive = false;
let activeShell = 'bash';
const shellSelect = document.getElementById('shell-select');

// Retrieve token from local storage
const token = localStorage.getItem('conduit_token');
if (!token) {
  window.location.href = '/';
  throw new Error('Redirecting: no auth token.');
}

// Declare ws at the module level
let ws;
let lastCols = null;
let lastRows = null;

// Reconnection state variables
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_DELAYS = [2000, 4000, 8000, 16000, 30000];
let reconnectTimer = null;

// DOM element references for reconnection
const reconnectOverlay = document.getElementById('reconnect-overlay');
const reconnectStatus = document.getElementById('reconnect-status');
const reconnectBtn = document.getElementById('reconnect-btn');
const spinner = reconnectOverlay ? reconnectOverlay.querySelector('.spinner') : null;

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
    const topBar = document.getElementById('top-bar');
    const toolbar = document.getElementById('toolbar');
    const topBarHeight = topBar ? topBar.offsetHeight : 40;
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 52;
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const targetHeight = viewportHeight - topBarHeight - toolbarHeight;

    const container = document.getElementById('terminal-container');
    if (container) {
      container.style.height = `${targetHeight}px`;
    }

    // Determine scroll state prior to fitting
    const isAtBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    const previousScrollY = term.buffer.active.viewportY;

    fitAddon.fit();

    // Restore scroll position
    if (isAtBottom) {
      term.scrollToBottom();
    } else {
      term.scrollToLine(previousScrollY);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      if (term.cols !== lastCols || term.rows !== lastRows) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
        lastCols = term.cols;
        lastRows = term.rows;
      }
    }
  } catch (err) {
    console.error("Error running resizeTerminal:", err);
  }
}

// Run initial resize before websocket setup
resizeTerminal();

// Setup WebSocket connection with reconnection logic
function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/terminal?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket connected.");
    reconnectAttempts = 0;
    lastCols = null;
    lastRows = null;
    if (reconnectOverlay) {
      reconnectOverlay.classList.add('hidden');
    }
    resizeTerminal();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[33m[Shell exited — ${msg.shell || activeShell} returned code ${msg.code}]\x1b[0m\r\n`);
        term.write(`\x1b[32m[Use the dropdown at the top to spawn another shell or reconnect]\x1b[0m\r\n`);
        if (shellSelect) {
          shellSelect.value = "";
        }
        activeShell = "";
      } else if (msg.type === 'shell-active') {
        activeShell = msg.shell;
        if (shellSelect) {
          shellSelect.value = msg.shell;
        }
      }
    } catch (err) {
      console.error("Error parsing WebSocket message:", err);
    }
  };

  ws.onclose = (event) => {
    if (event.code === 4001) {
      term.write('\r\n[Authentication failed or expired. Redirecting to login...]\r\n');
      localStorage.removeItem('conduit_token');
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } else if (event.reason === 'logout') {
      term.write('\r\n[Logged out]\r\n');
      localStorage.removeItem('conduit_token');
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } else {
      if (reconnectAttempts === 0) {
        term.write('\r\n[Connection lost]\r\n');
      }
      handleReconnect();
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    if (reconnectAttempts === 0) {
      term.write('\r\n[WebSocket connection error]\r\n');
    }
  };
}

function handleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (reconnectStatus) {
      reconnectStatus.textContent = "Connection failed. Please retry manually.";
    }
    if (reconnectBtn) {
      reconnectBtn.classList.remove('hidden');
    }
    if (spinner) {
      spinner.classList.add('hidden');
    }
    return;
  }

  const delay = BACKOFF_DELAYS[reconnectAttempts];
  reconnectAttempts++;

  if (reconnectOverlay) {
    reconnectOverlay.classList.remove('hidden');
  }
  if (spinner) {
    spinner.classList.remove('hidden');
  }
  if (reconnectBtn) {
    reconnectBtn.classList.add('hidden');
  }

  const seconds = delay / 1000;
  if (reconnectStatus) {
    reconnectStatus.textContent = `Connection lost. Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${seconds} seconds...`;
  }

  reconnectTimer = setTimeout(connectWebSocket, delay);
}

// Register manual reconnect click event listener
if (reconnectBtn) {
  reconnectBtn.addEventListener('click', (e) => {
    e.preventDefault();
    reconnectAttempts = 0;
    if (reconnectStatus) {
      reconnectStatus.textContent = "Reconnecting...";
    }
    if (reconnectBtn) {
      reconnectBtn.classList.add('hidden');
    }
    if (spinner) {
      spinner.classList.remove('hidden');
    }
    connectWebSocket();
  });
}

// Start the initial connection on startup
connectWebSocket();

// Handle user typing
term.onData((data) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

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
  if (ctrlBtn) {
    if (ctrlActive) {
      ctrlBtn.classList.add('active');
    } else {
      ctrlBtn.classList.remove('active');
    }
  }
}

if (ctrlBtn) {
  const handleCtrl = (e) => {
    e.preventDefault();
    toggleCtrl();
  };
  ctrlBtn.addEventListener('click', handleCtrl);
  ctrlBtn.addEventListener('touchstart', handleCtrl);
}

// Special sequences mapping for touch buttons
const seqMap = {
  'esc': '\x1b',
  'tab': '\t',
  'up': '\x1b[A',
  'down': '\x1b[B',
  'left': '\x1b[D',
  'right': '\x1b[C',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  'enter': '\r'
};

document.querySelectorAll('.key-btn[data-seq]').forEach(btn => {
  const handleKey = (e) => {
    e.preventDefault();
    const seqName = btn.getAttribute('data-seq');
    const seq = seqMap[seqName];
    if (seq && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: seq }));
    }
  };
  btn.addEventListener('click', handleKey);
  btn.addEventListener('touchstart', handleKey);
});

// Debounce helper to prevent rapid resize reflows
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
const debouncedResize = debounce(resizeTerminal, 150);

// Watch visualViewport for mobile keyboard height shifts
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', debouncedResize);
} else {
  window.addEventListener('resize', debouncedResize);
}
// Initial fit
setTimeout(resizeTerminal, 100);

// Handle Logout Action
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  const handleLogout = (e) => {
    e.preventDefault();
    if (confirm("Disconnect and log out of Conduit?")) {
      localStorage.removeItem('conduit_token');
      if (ws) {
        ws.close(1000, 'logout');
      }
      window.location.href = '/';
    }
  };
  logoutBtn.addEventListener('click', handleLogout);
  logoutBtn.addEventListener('touchstart', handleLogout);
}

// Handle Shell Switcher Selection
if (shellSelect) {
  shellSelect.value = activeShell;

  shellSelect.addEventListener('change', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert("Unable to switch shell: Connection is closed.");
      shellSelect.value = activeShell;
      return;
    }
    const selectedShell = shellSelect.value;
    const displayName = shellSelect.options[shellSelect.selectedIndex].text;
    if (confirm(`Switch to ${displayName}? The current session will be terminated.`)) {
      ws.send(JSON.stringify({
        type: 'shell',
        shell: selectedShell,
        cols: term.cols,
        rows: term.rows
      }));
    } else {
      shellSelect.value = activeShell;
    }
  });
}

// --- Custom Context Menu & Copy/Paste Logic ---
const contextMenu = document.getElementById('context-menu');
const ctxCopy = document.getElementById('ctx-copy');
const ctxPaste = document.getElementById('ctx-paste');
const terminalContainer = document.getElementById('terminal-container');

// Helper to check if clipboard permissions/APIs are available
const hasClipboardSupport = typeof navigator.clipboard !== 'undefined';
const isSecureContext = window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function showContextMenu(x, y) {
  if (!contextMenu) return;

  // Enable/disable copy button based on selection
  if (ctxCopy) {
    const hasSelection = term.hasSelection();
    ctxCopy.disabled = !hasSelection;
  }

  // Enable/disable paste button based on secure context check
  if (ctxPaste) {
    // navigator.clipboard.readText is only accessible in secure contexts (HTTPS or localhost)
    ctxPaste.disabled = !isSecureContext || !hasClipboardSupport;
  }

  // Position the menu
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }
}

// Right-click or long-press context menu intercept
if (terminalContainer) {
  terminalContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    // Calculate viewport bounds to prevent menu overflow
    let x = e.clientX;
    let y = e.clientY;
    
    // Fallback coordinates for touch events if clientX is undefined
    if (x === undefined && e.touches && e.touches[0]) {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    }
    
    const menuWidth = 160;
    const menuHeight = 100;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    if (x + menuWidth > windowWidth) {
      x = windowWidth - menuWidth - 10;
    }
    if (y + menuHeight > windowHeight) {
      y = windowHeight - menuHeight - 10;
    }
    
    showContextMenu(x, y);
  });
}

// Dismiss context menu on click anywhere else
document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Copy action handler
if (ctxCopy) {
  ctxCopy.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (term.hasSelection()) {
      const selectedText = term.getSelection();
      if (hasClipboardSupport) {
        navigator.clipboard.writeText(selectedText)
          .then(() => {
            const originalText = ctxCopy.textContent;
            ctxCopy.textContent = "Copied!";
            setTimeout(() => {
              ctxCopy.textContent = originalText;
              hideContextMenu();
            }, 800);
          })
          .catch((err) => {
            console.error("Clipboard write failed: ", err);
            alert("Clipboard copy failed. Please copy manually.");
            hideContextMenu();
          });
      } else {
        alert("Clipboard access not supported in this browser.");
        hideContextMenu();
      }
    }
  });
}

// Paste action handler
if (ctxPaste) {
  ctxPaste.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!isSecureContext || !hasClipboardSupport) {
      alert("Paste is disabled: navigator.clipboard requires a Secure Context (HTTPS or localhost). Please use the Cloudflare Tunnel URL to paste.");
      hideContextMenu();
      return;
    }
    
    navigator.clipboard.readText()
      .then((text) => {
        if (text && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: text }));
        }
        hideContextMenu();
      })
      .catch((err) => {
        console.error("Clipboard read failed: ", err);
        alert("Could not read clipboard. Please check browser permissions.");
        hideContextMenu();
      });
  });
}
