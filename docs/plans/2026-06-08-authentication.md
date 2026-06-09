# Phase 2: Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Secure the PhoneTerm terminal server so that only the user with the correct access token can access it from their phone browser, using a challenge-response pattern with JWTs.

**Architecture:**
1. The server generates secure random 32-byte `AUTH_SECRET` and 64-byte `JWT_SECRET` keys in `.env` using a setup script.
2. The user logs in via a premium dark-themed web page. The server verifies the token with `crypto.timingSafeEqual` and returns a JWT (30-day expiry).
3. The client browser stores the JWT in `localStorage` under `phoneterm_token`.
4. When establishing a WebSocket terminal connection, the client sends the JWT via the query parameter `?token=...`.
5. The WebSocket server verifies the token. If invalid, it closes the connection with code `4001`, prompting the client to wipe `localStorage` and redirect to the login screen.

**Tech Stack:** Node.js, Express, ws (WebSocket), jsonwebtoken, dotenv, built-in crypto module, Vanilla HTML/CSS/JS.

---

## WSL-SPECIFIC RISKS & MITIGATION

1. **WSL2 Virtualized Networking Boundary:**
   - **Risk:** WSL2 runs inside a virtual machine and has its own private IP address (typically `172.x.x.x`). It is not directly reachable by default from other devices on the local Wi-Fi network (such as a phone) using the Windows host's physical LAN IP, unless Windows-side port proxying is configured.
   - **Mitigation:** The plan assumes the use of the Cloudflare Tunnel (Phase 3) for internet-wide secure connectivity. For local network development, the server binds to `0.0.0.0` so that local requests are handled. We will document in the README that accessing the server locally from a phone requires setting up a port-forwarding proxy on the Windows host using:
     `netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<WSL_IP>`
     or utilizing the Cloudflare Tunnel.

2. **Script Line Endings (CRLF vs LF):**
   - **Risk:** If the setup or start shell scripts are edited or cloned on Windows and acquire carriage returns (`CRLF`), executing them in WSL will fail with errors like `/bin/bash: \r: bad interpreter`.
   - **Mitigation:** The setup and start scripts must be explicitly written and saved with Unix `LF` line endings. We will verify this during implementation.

3. **Node-pty Native Binary Compatibility:**
   - **Risk:** `node-pty` compiles native C++ bindings for the Linux PTY subsystem. If Node.js is updated on WSL, the compiled binary becomes incompatible.
   - **Mitigation:** We include `npm rebuild node-pty` inside `setup.sh` to ensure native compilation matches the active Node runtime version.

4. **WSL Interop Paths for Windows Shells:**
   - **Risk:** Later phases require launching Windows shells (CMD, PowerShell) from WSL. These reside at `/mnt/c/Windows/System32/`. If the user's WSL is configured to mount Windows drives elsewhere (e.g., `/c/` instead of `/mnt/c/`), these paths will fail.
   - **Mitigation:** In future phases, we will verify shell paths and support configuration via `.env` or automatic mount path detection.

---

## IMPLEMENTATION TASKS

### Task 1: Setup and Start Scripts

**Files:**
- Create: `scripts/setup.sh`
- Create: `scripts/start.sh`

**Step 1: Write `scripts/setup.sh`**
Create the file with the following contents, ensuring it uses Unix LF line endings:
```bash
#!/bin/bash
# Make sure we are in the project root
cd "$(dirname "$0")/.."

echo "Setting up PhoneTerm..."

# Install build dependencies inside WSL Ubuntu/Debian
if command -v apt-get &> /dev/null; then
  echo "Installing build-essential and python3..."
  sudo apt-get update && sudo apt-get install -y build-essential python3
fi

# Download/Install cloudflared if not present
if ! command -v cloudflared &> /dev/null; then
  echo "Installing cloudflared..."
  sudo curl -L https://github.com/cloudflare/cloudflare-tunnel/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
  sudo chmod +x /usr/local/bin/cloudflared
fi

# Generate random secrets for .env if not exists
if [ ! -f .env ]; then
  echo "Generating .env with cryptographically secure secrets..."
  AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  
  cat <<EOT > .env
# DO NOT COMMIT THIS FILE
PORT=3000
AUTH_SECRET=$AUTH_SECRET
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=30d
EOT
  echo ".env generated successfully."
else
  echo ".env already exists. Skipping secret generation."
fi

# Run npm install and rebuild node-pty
npm install
npm rebuild node-pty

echo "Setup complete. Run ./scripts/start.sh to start PhoneTerm."
```

**Step 2: Write `scripts/start.sh`**
Create the file:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
node server/index.js
```

**Step 3: Mark scripts as executable**
Run:
```bash
chmod +x scripts/setup.sh scripts/start.sh
```

**Step 4: Commit setup scripts**
```bash
git add scripts/setup.sh scripts/start.sh
git commit -m "feat: add setup and start helper scripts"
```

---

### Task 2: Auth Router & Middleware

**Files:**
- Create: `server/auth.js`

**Step 1: Write implementation for `server/auth.js`**
Write a timing-safe auth router and JWT verification handlers:
```javascript
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');

const router = express.Router();

/**
 * Performs a timing-safe string comparison to prevent side-channel timing attacks.
 */
function verifyToken(inputToken) {
  if (!inputToken || typeof inputToken !== 'string') return false;
  
  const secretBuffer = Buffer.from(config.AUTH_SECRET, 'utf-8');
  const tokenBuffer = Buffer.from(inputToken, 'utf-8');
  
  if (secretBuffer.length !== tokenBuffer.length) {
    // Run comparison on identical buffers to make timing signature uniform
    crypto.timingSafeEqual(secretBuffer, secretBuffer);
    return false;
  }
  
  return crypto.timingSafeEqual(secretBuffer, tokenBuffer);
}

// POST /auth/login
router.post('/login', (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Access token is required' });
  }

  if (verifyToken(token)) {
    const jwtToken = jwt.sign(
      { authenticated: true },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRY }
    );
    return res.json({ token: jwtToken });
  }

  return res.status(401).json({ error: 'Invalid access token' });
});

module.exports = {
  authRouter: router
};
```

**Step 2: Commit auth router**
```bash
git add server/auth.js
git commit -m "feat: add server auth router with timing-safe comparison"
```

---

### Task 3: Server Integration & WebSocket Protection

**Files:**
- Modify: `server/index.js`

**Step 1: Modify `server/index.js` to mount auth routes and authenticate WebSocket connections**
Replace lines 11-53 in `server/index.js` with:
```javascript
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
```

**Step 2: Commit server index changes**
```bash
git add server/index.js
git commit -m "feat: protect WebSocket endpoint and add auth routing"
```

---

### Task 4: Premium Dark-Themed Login UI

**Files:**
- Create: `client/index.html`
- Modify: `client/style.css`

**Step 1: Write `client/index.html`**
Create a gorgeous dark login page with clean styles and modern Google Font typography:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>PhoneTerm - Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="login-wrapper">
    <div class="login-card" id="login-card">
      <div class="logo-area">
        <span class="terminal-prompt">$</span>
        <span class="logo-text">PhoneTerm</span>
      </div>
      <p class="subtitle">Secure WSL Remote Terminal Access</p>
      
      <form id="login-form">
        <div class="input-group">
          <input type="password" id="token-input" placeholder="Enter Access Token" autocomplete="current-password" required>
        </div>
        <button type="submit" id="submit-btn">
          <span>Connect</span>
          <svg class="arrow-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M5 13h11.86l-5.43 5.43 1.42 1.42L21.14 12l-8.29-8.29-1.42 1.42 5.43 5.43H5v2z"/></svg>
        </button>
        <p id="error-message" class="error-msg"></p>
      </form>
    </div>
  </div>

  <script>
    // Auto-redirect if already logged in
    const existingToken = localStorage.getItem('phoneterm_token');
    if (existingToken) {
      window.location.href = '/term';
    }

    const form = document.getElementById('login-form');
    const input = document.getElementById('token-input');
    const card = document.getElementById('login-card');
    const errorMsg = document.getElementById('error-message');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.textContent = '';
      card.classList.remove('shake');
      
      const token = input.value.trim();
      if (!token) return;

      try {
        const response = await fetch('/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token })
        });

        const data = await response.json();

        if (response.ok && data.token) {
          localStorage.setItem('phoneterm_token', data.token);
          window.location.href = '/term';
        } else {
          showError(data.error || 'Access denied');
        }
      } catch (err) {
        showError('Network error. Failed to reach server.');
      }
    });

    function showError(msg) {
      errorMsg.textContent = msg;
      // Trigger reflow to restart CSS animation
      void card.offsetWidth;
      card.classList.add('shake');
      input.value = '';
      input.focus();
    }
  </script>
</body>
</html>
```

**Step 2: Modify `client/style.css` to add login styles & animations**
Append the following styles to the existing file:
```css
/* Styling additions for Login UI */
:root {
  --bg-primary: #0d0d0d;
  --card-bg: #161616;
  --accent-color: #ff9900;
  --error-color: #ff3333;
  --text-primary: #f8f8f2;
  --text-muted: #888888;
  --border-color: #2b2b2b;
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.login-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  padding: 20px;
}

.login-card {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 32px 24px;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  text-align: center;
  transition: border-color 0.3s ease;
}

.login-card:focus-within {
  border-color: var(--accent-color);
}

.logo-area {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}

.terminal-prompt {
  color: var(--accent-color);
  font-family: 'Fira Code', monospace;
  font-weight: 600;
  font-size: 24px;
}

.logo-text {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: 26px;
  letter-spacing: -0.5px;
}

.subtitle {
  font-family: 'Outfit', sans-serif;
  color: var(--text-muted);
  font-size: 14px;
  margin: 0 0 28px 0;
  font-weight: 300;
}

.input-group {
  margin-bottom: 20px;
  position: relative;
}

#token-input {
  width: 100%;
  background: #222;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px 16px;
  color: #fff;
  font-size: 15px;
  outline: none;
  font-family: 'Fira Code', monospace;
  text-align: center;
  transition: all 0.3s ease;
}

#token-input:focus {
  border-color: var(--accent-color);
  background: #282828;
}

#submit-btn {
  width: 100%;
  background-color: var(--accent-color);
  color: #000;
  border: none;
  border-radius: 6px;
  padding: 12px 16px;
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.2s;
}

#submit-btn:active {
  opacity: 0.8;
}

.arrow-icon {
  width: 18px;
  height: 18px;
}

.error-msg {
  color: var(--error-color);
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  margin-top: 14px;
  min-height: 18px;
}

/* Shake Keyframes */
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}

.shake {
  animation: shake 0.4s ease-in-out;
  border-color: var(--error-color) !important;
}
```

**Step 3: Commit login UI files**
```bash
git add client/index.html client/style.css
git commit -m "feat: add premium login page and styles"
```

---

### Task 5: Client-Side WebSocket Authentication & Logout

**Files:**
- Modify: `client/terminal.html`
- Modify: `client/terminal.js`

**Step 1: Add Logout Button to `client/terminal.html`**
Add a logout button to the toolbar in `client/terminal.html` (lines 14-25):
```html
  <!-- Mobile Toolbar for Special Keys -->
  <div id="toolbar">
    <button class="key-btn" data-seq="esc">ESC</button>
    <button class="key-btn" data-seq="tab">TAB</button>
    <button id="ctrl-btn" class="key-btn">CTRL</button>
    <button class="key-btn" data-seq="up">↑</button>
    <button class="key-btn" data-seq="down">↓</button>
    <button class="key-btn" data-seq="left">←</button>
    <button class="key-btn" data-seq="right">→</button>
    <button class="key-btn" data-seq="ctrl-c">^C</button>
    <button class="key-btn" data-seq="ctrl-d">^D</button>
    <button id="logout-btn" class="key-btn">LOGOUT</button>
  </div>
```

**Step 2: Update WebSocket connection and logout logic in `client/terminal.js`**
Modify lines 3-6 in `client/terminal.js` to read the token and check for existence, redirecting to `/` if missing:
```javascript
// Retrieve token from local storage
const token = localStorage.getItem('phoneterm_token');
if (!token) {
  window.location.href = '/';
}

// Setup WebSocket connection
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/terminal?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(wsUrl);
```

**Step 3: Handle Close Code 4001 in `client/terminal.js`**
Modify the `ws.onclose` function (lines 61-63) to clean credentials and redirect on authorization failure:
```javascript
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
```

**Step 4: Bind Logout Button event listener in `client/terminal.js`**
Append the logout listener logic to the end of `client/terminal.js`:
```javascript
// Handle Logout Action
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm("Disconnect and log out of PhoneTerm?")) {
      localStorage.removeItem('phoneterm_token');
      ws.close();
      window.location.href = '/';
    }
  });
}
```

**Step 5: Commit client-side updates**
```bash
git add client/terminal.js client/terminal.html
git commit -m "feat: implement client token handshake and logout functionality"
```

---

## VERIFICATION STEPS

1. **Verify Setup Script:**
   - Execute: `bash scripts/setup.sh`
   - Check that `.env` is populated with random cryptographically secure keys for `AUTH_SECRET` and `JWT_SECRET`.
   
2. **Verify Server Starts:**
   - Run: `bash scripts/start.sh`
   - Confirm server logs print the startup card showing both the local IP and the `Auth Token` printed directly to stdout.

3. **Verify Auth Rejections:**
   - Try connecting a WebSocket client manually via curl or browser console without a token or with a bogus token, verifying that the socket is closed immediately with code `4001`.

4. **Verify Web Login Flow:**
   - Access `http://localhost:3000/` in a browser.
   - Enter an incorrect token, confirm visual shake feedback is triggered and the error message appears.
   - Enter the correct token shown in the terminal console, verify that it stores the token in `localStorage`, redirects to `/terminal.html`, and successfully mounts the terminal session.

5. **Verify Logout Flow:**
   - Click the `LOGOUT` button on the terminal dashboard.
   - Confirm you are redirected back to the login screen and the local storage item `phoneterm_token` is cleared.
