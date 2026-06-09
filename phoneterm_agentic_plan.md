# PhoneTerm — Agentic AI Build Plan
**WSL Remote Terminal Accessible from Any Phone Browser**

---

## PROJECT OVERVIEW

Build a self-hosted web terminal server that runs inside WSL (Windows Subsystem for Linux) on a Windows machine. The goal is to let a phone browser open a fully functional terminal that is directly connected to the WSL environment — exactly as if you had opened a terminal window on the computer itself. The terminal must support interactive CLI programs (programs that use cursor movement, colors, and full-screen TUI interfaces like `codex` and `agy`). The server must be accessible both on the local network and over the internet.

**What the end result looks like:**
- A webpage you open on your phone
- It shows a terminal — same as your WSL bash prompt
- You type commands, they run on the computer in real-time
- You can run `codex`, `agy`, `python`, `node`, `java` — everything in WSL works
- You can also switch to Windows CMD or PowerShell from the same interface
- Accessible at a local IP when on home Wi-Fi, and at a public HTTPS URL when away

---

## TECH STACK

### Backend (runs inside WSL)
| Package | Purpose |
|---|---|
| `express` | HTTP server and static file serving |
| `ws` | WebSocket server (terminal I/O relay) |
| `node-pty` | Spawns a real PTY (pseudo-terminal) — critical for interactive apps |
| `jsonwebtoken` | Issues and verifies JWT session tokens |
| `bcryptjs` | Hashes the auth secret for safe storage |
| `qrcode-terminal` | Prints QR codes in the WSL terminal at startup |
| `dotenv` | Loads config from `.env` |
| `uuid` | Generates session IDs |
| `chalk` | Colored startup logs |
| `ip` | Detects local network IP |

### Frontend (served by the Express server, runs in phone browser)
| Technology | Purpose |
|---|---|
| `xterm.js` (CDN) | Full-featured terminal emulator in the browser |
| `xterm-addon-fit` (CDN) | Auto-resizes terminal to fill the screen |
| `xterm-addon-web-links` (CDN) | Makes URLs in terminal output clickable |
| Vanilla HTML/CSS/JS | No framework needed — keep it lean for mobile |

### Networking
| Tool | Purpose |
|---|---|
| `cloudflared` (Cloudflare Tunnel) | Exposes the local server to the internet over HTTPS with no port forwarding needed |
| Local IP | Direct access when on the same Wi-Fi |

---

## SYSTEM ARCHITECTURE

```
[Phone Browser]
      │  HTTPS + WSS (WebSocket Secure)
      ▼
[Cloudflare Tunnel] ◄──── Internet access path
      │
      ▼
[Express Server — port 3000 — running in WSL]
      │
      ├── GET  /           → serves login page (index.html)
      ├── POST /auth/login → validates token, returns JWT
      ├── GET  /term       → serves terminal page (terminal.html)
      └── WS   /terminal  → WebSocket endpoint
                │
                ▼
         [node-pty PTY process]
                │
                ├── Default: bash (WSL environment, ~)
                └── Optional: cmd.exe / powershell.exe (via WSL interop)
```

**Data flow for a keypress:**
```
User types on phone keyboard
  → xterm.js captures input
    → WebSocket sends data to server
      → server.on('message') writes to PTY stdin
        → PTY output comes back
          → WebSocket sends to client
            → xterm.js renders output on screen
```

**Terminal resize flow:**
```
Phone screen rotates or keyboard opens/closes
  → xterm.js fires onResize event
    → WebSocket sends { type: 'resize', cols, rows }
      → server calls pty.resize(cols, rows)
        → PTY adjusts — interactive apps reflow correctly
```

---

## FILE STRUCTURE

```
phoneterm/
├── server/
│   ├── index.js          ← Entry point: starts HTTP + WS server + tunnel
│   ├── auth.js           ← Login endpoint, JWT issue/verify, middleware
│   ├── terminal.js       ← PTY spawning, WebSocket↔PTY relay, resize
│   ├── tunnel.js         ← Cloudflare tunnel manager (starts cloudflared)
│   └── config.js         ← Reads .env, exports config object
├── client/
│   ├── index.html        ← Login page (enter auth token)
│   ├── terminal.html     ← Terminal page (xterm.js + toolbar)
│   ├── terminal.js       ← WebSocket client, xterm.js init, reconnect logic
│   └── style.css         ← Mobile-optimized styles (dark theme, toolbar)
├── scripts/
│   ├── setup.sh          ← First-run: installs deps, generates secret, sets up cloudflared
│   └── start.sh          ← Starts the server (called on every use)
├── .env                  ← Auto-generated secrets — ADD TO .gitignore
├── .env.example          ← Template showing what .env should contain
├── package.json
└── README.md
```

---

## PHASE 1 — PROJECT BOOTSTRAP & CORE PTY SERVER

**Goal:** Get a working terminal in the browser with no auth yet.

### 1.1 Initialize the project
```bash
mkdir -p ~/phoneterm && cd ~/phoneterm
npm init -y
npm install express ws node-pty jsonwebtoken bcryptjs qrcode-terminal dotenv uuid chalk ip
```

> **Important:** `node-pty` requires native compilation. WSL must have build tools:
> ```bash
> sudo apt-get install -y build-essential python3
> ```
> If `node-pty` fails to install, run: `npm rebuild node-pty`

### 1.2 `server/config.js`
- Load `.env` with `dotenv`
- Export: `PORT` (default 3000), `AUTH_SECRET`, `JWT_SECRET`, `JWT_EXPIRY` (default `'30d'`)
- If `AUTH_SECRET` or `JWT_SECRET` are missing from `.env`, throw an error with a clear message telling the user to run `setup.sh`

### 1.3 `server/terminal.js`
Implement and export:

**`spawnTerminal(ws, shell)`**
- `shell` parameter accepts: `'bash'`, `'zsh'`, `'cmd'`, `'powershell'`
- Shell resolution:
  - `'bash'` → `/bin/bash`
  - `'zsh'` → `/bin/zsh` (check if exists, fallback to bash)
  - `'cmd'` → `/mnt/c/Windows/System32/cmd.exe`
  - `'powershell'` → `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`
- Spawn PTY with these options:
  ```js
  const pty = require('node-pty');
  const term = pty.spawn(shellPath, [], {
    name: 'xterm-256color',   // CRITICAL: enables full color + TUI support
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,   // Start in WSL home directory
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    }
  });
  ```
- Wire PTY output → WebSocket: `term.onData(data => ws.send(JSON.stringify({ type: 'output', data })))`
- Wire WebSocket messages → PTY:
  - `{ type: 'input', data }` → `term.write(data)`
  - `{ type: 'resize', cols, rows }` → `term.resize(cols, rows)`
  - `{ type: 'shell', shell }` → kill current PTY, spawn new one with new shell
- On PTY exit: send `{ type: 'exit', code }` to client
- On WebSocket close: kill the PTY process cleanly

### 1.4 `server/index.js`
- Create Express app
- Serve `client/` directory as static files
- Create HTTP server from Express app
- Create WebSocket server attached to the HTTP server, listening on path `/terminal`
- On new WebSocket connection: call `spawnTerminal(ws, 'bash')` (no auth yet in this phase)
- Listen on `0.0.0.0:PORT` (important: `0.0.0.0` not `localhost` — needed for local network access)
- Log the local IP and port on startup using the `ip` package

### 1.5 `client/terminal.html`
- Load xterm.js, xterm-addon-fit, xterm-addon-web-links from CDN (jsDelivr)
- Full-height terminal with dark background
- Connect to `ws://[current host]/terminal`
- On open: initialize xterm.js terminal
- On message: parse JSON, if `type === 'output'` write to terminal
- On xterm.js input: send `{ type: 'input', data }`
- On xterm.js resize: send `{ type: 'resize', cols, rows }`
- Use `FitAddon` to auto-fit terminal to window — call `fitAddon.fit()` on window resize and on initial load

### 1.6 `client/style.css`
Dark, mobile-optimized terminal styles:
- `body { margin: 0; background: #0d0d0d; overflow: hidden; }`
- Terminal container fills 100vw × 100vh
- Account for the mobile toolbar (bottom fixed bar) — terminal height = `calc(100vh - 52px)`
- Font: monospace, minimum 14px for readability on small screens
- Prevent iOS Safari rubber-band scroll: `position: fixed; width: 100%;`

**Mobile special keys toolbar (bottom of screen):**
A fixed bottom bar with touch-friendly buttons for:
`ESC` | `TAB` | `CTRL` (toggle) | `↑` | `↓` | `←` | `→` | `^C` | `^D`

- CTRL button is a toggle — when active, next key pressed is sent as Ctrl+key combo
- All buttons send the correct escape sequences to the PTY via WebSocket
- Escape sequences reference:
  - ESC → `\x1b`
  - TAB → `\t`
  - Arrow up → `\x1b[A`
  - Arrow down → `\x1b[B`
  - Arrow right → `\x1b[C`
  - Arrow left → `\x1b[D`
  - Ctrl+C → `\x03`
  - Ctrl+D → `\x04`
  - Ctrl+Z → `\x1a`
  - Ctrl+L → `\x0c` (clear screen)

---

## PHASE 2 — AUTHENTICATION (SSH-KEY-EQUIVALENT)

**Goal:** Secure the terminal so only you can access it from your phone.

### Auth Design
This uses a challenge-response pattern inspired by SSH key auth:

1. The server holds a **secret token** (256-bit random hex, generated at setup time, stored in `.env`)
2. On login, the client sends the token
3. If correct, the server issues a **JWT** (30-day expiry)
4. All WebSocket connections require a valid JWT (passed as a query param: `?token=...`)
5. The JWT is stored in the phone browser's `localStorage`

### 2.1 `scripts/setup.sh`
This script runs once before first use:
```bash
#!/bin/bash
echo "Setting up PhoneTerm..."

# Check node-pty build tools
sudo apt-get install -y build-essential python3

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
  echo "Installing cloudflared..."
  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

# Generate secrets if .env doesn't exist
if [ ! -f .env ]; then
  AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  echo "PORT=3000" > .env
  echo "AUTH_SECRET=$AUTH_SECRET" >> .env
  echo "JWT_SECRET=$JWT_SECRET" >> .env
  echo "JWT_EXPIRY=30d" >> .env
  echo ".env generated."
fi

npm install
echo "Setup complete. Run ./scripts/start.sh to start PhoneTerm."
```

### 2.2 `server/auth.js`
Implement and export:

**`POST /auth/login`**
- Accept `{ token }` in request body
- Compare with `AUTH_SECRET` from config using `bcrypt.compare` (secret is bcrypt-hashed at startup — hash it once in `config.js` and cache it)
- Actually simpler: use `crypto.timingSafeEqual` to compare the raw secret (avoids bcrypt complexity)
- If valid: sign and return a JWT containing `{ authenticated: true }`, expiry from config
- If invalid: return 401

**`authenticateJWT` middleware**
- For HTTP routes: check `Authorization: Bearer <token>` header
- For WebSocket upgrades: check `?token=<jwt>` query parameter
- Verify JWT with `JWT_SECRET`
- If invalid/expired: reject with 401 / close WebSocket with code 4001

### 2.3 Update `server/index.js`
- Add `express.json()` middleware
- Register auth router: `app.use('/auth', authRouter)`
- Protect the `/terminal` WebSocket endpoint with `authenticateJWT`
- Serve `client/index.html` for `GET /` (login page)
- Serve `client/terminal.html` for `GET /term` — protected, redirect to `/` if no token

**On server startup, print to the WSL terminal:**
```
╔═══════════════════════════════════════╗
║         PhoneTerm is running          ║
╠═══════════════════════════════════════╣
║  Local:    http://192.168.x.x:3000    ║
║  Internet: https://xxxx.trycloudflare.com ║
╠═══════════════════════════════════════╣
║  Auth token: [token shown here]       ║
╚═══════════════════════════════════════╝
[QR code for local URL]
[QR code for internet URL]
```

### 2.4 `client/index.html` — Login page
- Minimal, dark-themed login screen
- Single input field: "Enter your access token"
- On submit: `POST /auth/login` with the token
- On success: store JWT in `localStorage.setItem('phoneterm_token', jwt)`, redirect to `/term`
- On failure: shake animation on the input, show "Invalid token"
- If JWT already exists in localStorage and is not expired: auto-redirect to `/term`

### 2.5 Update `client/terminal.js`
- Read JWT from `localStorage.getItem('phoneterm_token')`
- If missing: redirect to `/`
- Connect WebSocket as `ws://[host]/terminal?token=[jwt]`
- On WebSocket close with code 4001 (auth failure): clear localStorage, redirect to `/`
- Add a disconnect/logout button in the UI

---

## PHASE 3 — INTERNET ACCESS (CLOUDFLARE TUNNEL)

**Goal:** Get a stable public HTTPS URL that tunnels to the local server.

### How Cloudflare Tunnel works
`cloudflared` creates an outbound connection from WSL to Cloudflare's edge. Cloudflare gives you a public URL (e.g., `https://random-words.trycloudflare.com`). No router configuration, no port forwarding, no static IP needed.

### 3.1 `server/tunnel.js`
Implement and export:

**`startTunnel(port)`**
- Spawn `cloudflared tunnel --url http://localhost:[port]` as a child process using Node's `spawn`
- Parse stdout/stderr for the line containing `trycloudflare.com` — extract the public URL using regex: `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/`
- Return a Promise that resolves with the public URL once found (with 30-second timeout)
- On timeout: resolve with `null` and log a warning
- Keep the child process alive as long as the server runs
- On server `SIGINT`/`SIGTERM`: kill cloudflared child process

### 3.2 Update `server/index.js`
- After the HTTP server starts listening, call `startTunnel(PORT)`
- Once the URL is returned, print both local and public URLs + QR codes to the WSL terminal
- Use `qrcode-terminal` package for QR codes (use `small: true` option for compact output)

### 3.3 Update the startup message
Show both URLs immediately on start:
- Local URL is available instantly (printed first)
- Public URL is printed once cloudflared connects (usually within 5–10 seconds)

---

## PHASE 4 — SHELL SWITCHING

**Goal:** Let the user switch between WSL bash and Windows shells from the phone.

### 4.1 Shell switcher UI
Add a shell selector to `client/terminal.html`:
- A small dropdown/button strip at the top of the terminal page
- Options: `bash` (default, labeled "WSL"), `zsh` (labeled "WSL (zsh)"), `cmd` (labeled "Windows CMD"), `powershell` (labeled "PowerShell")
- Switching shell: send `{ type: 'shell', shell: 'cmd' }` via WebSocket
- Show a confirmation before switching (current session will close): "Switch to Windows CMD? Current session will end."
- When the PTY exits after switching, show "Shell exited — [shell name] returned code [N]" in the terminal

### 4.2 Update `server/terminal.js`
- On `{ type: 'shell' }` message: kill current PTY and spawn a new one
- Wrap PTY spawn in a function `spawnShell(ws, shellName)` that the WebSocket handler can call
- Send `{ type: 'output', data: '\r\n--- Switching shell ---\r\n' }` before killing, so user sees feedback

### 4.3 WSL ↔ Windows notes for the AI
- Windows executables are available inside WSL at `/mnt/c/Windows/System32/`
- `cmd.exe` and `powershell.exe` can be spawned from WSL via their full paths
- The home directory for Windows shells should be set to the Windows user's home via the `USERPROFILE` env var or just `/mnt/c/Users/[username]`
- To detect the Windows username: `cmd.exe /c echo %USERNAME%` (run this once at startup and store it)

---

## PHASE 5 — INTERACTIVE APP SUPPORT (codex, agy, etc.)

Interactive CLI apps (TUI programs, AI assistants) require a proper PTY to function correctly. The architecture using `node-pty` already handles this, but there are specific settings to verify and enforce.

### 5.1 Requirements checklist (implement all of these)

**PTY environment variables — set in every shell spawn:**
```js
env: {
  ...process.env,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  FORCE_COLOR: '3',
  TERM_PROGRAM: 'phoneterm',
  LANG: process.env.LANG || 'en_US.UTF-8',
}
```

**Terminal size must be accurate:**
- When the WebSocket first opens, the client must immediately send a `{ type: 'resize', cols, rows }` message with the actual xterm.js terminal dimensions (not assumed 80×24)
- The `FitAddon.fit()` call must happen before the WebSocket connection fires, or immediately after — do not wait for user input

**Handling long-running AI CLI tools:**
- `node-pty` output can come in bursts — do not buffer on the server side; forward every `onData` event immediately to the WebSocket
- On the client: pass data directly to `terminal.write(data)` — do not batch
- This ensures streaming output from AI tools (like codex typing out responses token by token) displays smoothly

**Viewport resize during AI tool use:**
- When the phone keyboard opens/closes (common during interactive sessions), `window.innerHeight` changes
- The client must listen for `visualViewport.onresize` (not just `window.onresize`) for accurate dimensions on mobile
- Trigger `fitAddon.fit()` and send a resize message on every `visualViewport.onresize` event

**Ctrl key handling for interactive tools:**
- Interactive tools often use `Ctrl+C` to cancel, `Ctrl+R` to search history, `Ctrl+L` to clear
- The toolbar CTRL toggle must work like a real Ctrl key: when CTRL is toggled on and user taps a letter key, send the correct control character
- Map: Ctrl+A = `\x01`, Ctrl+B = `\x02`, ..., Ctrl+Z = `\x1a`
- Formula: `String.fromCharCode(key.charCodeAt(0) - 64)` for uppercase letters

---

## PHASE 6 — RECONNECTION & STABILITY

**Goal:** Handle network drops gracefully (phone switches from Wi-Fi to cellular, screen sleep, etc.)

### 6.1 Client-side reconnection (`client/terminal.js`)
- On WebSocket `close` event (non-auth): wait 2 seconds, attempt reconnect
- Max 5 reconnect attempts with exponential backoff: 2s, 4s, 8s, 16s, 30s
- Show overlay message on terminal: "Connection lost — reconnecting (attempt N/5)..."
- If all attempts fail: show "Connection failed. [Retry manually]" with a button that resets the counter and tries again
- On successful reconnect: clear the overlay, re-fit the terminal, and send resize event

### 6.2 Server-side session persistence (optional but recommended)
- Keep the PTY alive for 60 seconds after WebSocket disconnect (in case of accidental disconnect)
- Store PTY in a Map keyed by JWT subject/session ID
- If client reconnects within 60 seconds with the same JWT: reattach to the same PTY (the terminal history resumes)
- If 60 seconds pass: kill the PTY and clean up
- Show last 500 lines of terminal scrollback on reconnect (store in a rolling buffer server-side)

---

## PHASE 7 — AUTO-START ON WINDOWS BOOT

**Goal:** PhoneTerm starts automatically when the Windows PC turns on, so you don't need to manually launch it before using your phone.

### 7.1 `scripts/start.sh`
```bash
#!/bin/bash
cd ~/phoneterm
node server/index.js
```

### 7.2 Windows Task Scheduler setup (document in README.md)
Provide these exact instructions:
1. Open Task Scheduler on Windows
2. Create a new Basic Task: "Start PhoneTerm"
3. Trigger: "When the computer starts"
4. Action: "Start a program"
   - Program: `C:\Windows\System32\wsl.exe`
   - Arguments: `-d Ubuntu -e bash -c "cd ~/phoneterm && node server/index.js >> ~/phoneterm/phoneterm.log 2>&1"`
5. General tab: check "Run whether user is logged on or not" and "Run with highest privileges"
6. This launches the WSL server in the background on every boot

### 7.3 Log file
- Write startup logs and errors to `~/phoneterm/phoneterm.log`
- Use a simple rotating log: if log file exceeds 5MB, rename to `phoneterm.log.old` and start fresh

---

## PHASE 8 — SECURITY HARDENING

Implement all of these:

**Rate limiting:**
- Max 5 failed login attempts per IP per 15 minutes on `POST /auth/login`
- Implement with a simple in-memory Map (no external package needed)
- Return 429 with "Too many attempts. Try again in X minutes" message

**Token display:**
- Never log the raw `AUTH_SECRET` to `phoneterm.log`
- Only display it in the WSL terminal (stdout) on startup, not in log files

**HTTPS enforcement:**
- When the public Cloudflare URL is available: add a `Content-Security-Policy` header that restricts to HTTPS
- The local HTTP URL is fine for local network use (can't get TLS cert for a LAN IP without complexity)

**WebSocket origin check:**
- On WebSocket upgrade, check the `Origin` header
- Only allow connections from the server's own hostname(s) (local IP and Cloudflare URL)

**JWT security:**
- Use `HS256` algorithm with the 64-byte `JWT_SECRET`
- Include `iat` (issued at) and `exp` (expiry) claims
- On logout: store invalidated JWT `jti` in a small in-memory set (cleared on server restart)

---

## PHASE 9 — FINAL TOUCHES

### 9.1 README.md
Write a complete README covering:
- Prerequisites (Node.js 18+, WSL with Ubuntu/Debian)
- First-time setup: `bash scripts/setup.sh`
- Starting the server: `bash scripts/start.sh`
- Connecting from phone: how to find local URL and internet URL
- How to add the page to phone home screen (PWA-like experience)
- FAQ: "My interactive tool (codex/agy) displays weird characters" → solution
- FAQ: "The public URL changed after restart" → expected behavior with free Cloudflare tunnels
- FAQ: "How do I update my auth token?" → edit `.env` AUTH_SECRET, restart

### 9.2 PWA manifest (`client/manifest.json`)
- `name`: "PhoneTerm"
- `short_name`: "PhoneTerm"
- `display`: "standalone"
- `background_color`: "#0d0d0d"
- `theme_color`: "#0d0d0d"
- `start_url`: "/term"
- Include a simple terminal-icon SVG as the app icon
- Add `<link rel="manifest" href="/manifest.json">` to `terminal.html`
- This lets the user add PhoneTerm to their phone's home screen as a standalone app (no browser UI)

### 9.3 Copy-paste on mobile
- Implement a long-press context menu on the terminal for "Copy selection" and "Paste"
- xterm.js selections: `terminal.getSelection()` returns selected text
- Paste: read from clipboard with `navigator.clipboard.readText()` and send as input
- Note: clipboard access requires user gesture and HTTPS — only enable when Cloudflare URL is active

---

## IMPLEMENTATION ORDER

Implement phases strictly in this order. Test each phase before moving to the next.

1. **Phase 1** → Verify: open browser on computer at `localhost:3000`, see terminal, type `ls`, see output
2. **Phase 2** → Verify: server rejects unauthenticated WebSocket, login page works, JWT is stored
3. **Phase 3** → Verify: Cloudflare URL appears in WSL terminal, open it on phone, terminal works
4. **Phase 4** → Verify: switch from bash to cmd.exe, run `dir`, switch back, run `ls`
5. **Phase 5** → Verify: run `codex` or another interactive AI CLI — it renders correctly, responds to input
6. **Phase 6** → Verify: kill and re-open the app on phone, it reconnects within 5 seconds
7. **Phase 7** → Verify: reboot Windows, wait 30 seconds, open phone browser, terminal is accessible
8. **Phase 8** → Verify: enter wrong token 6 times, confirm rate limiting kicks in
9. **Phase 9** → Verify: add to home screen on phone, opens as standalone app without browser chrome

---

## CRITICAL IMPLEMENTATION NOTES

> These are things that are easy to get wrong. The AI must pay attention to these.

1. **`node-pty` is a native module.** It must be compiled against the Node.js version in WSL. If the Node.js version changes, run `npm rebuild node-pty`. Do not use `pkg` or other bundlers that break native modules.

2. **WebSocket server must share the HTTP server instance.** Do not create a separate HTTP server for WebSockets. Use `new WebSocket.Server({ server: httpServer })` where `httpServer` is the same instance Express uses. Otherwise local network access breaks.

3. **PTY environment must include the full PATH from WSL.** Do not create a minimal env. Use `...process.env` as the base and only override specific variables. If PATH is missing, tools like `codex` and `agy` will not be found.

4. **Terminal dimensions on mobile.** On iOS Safari, `window.innerHeight` lies when the keyboard is open. Use `visualViewport.height` instead. Always fit after `visualViewport` resize, not just `window` resize.

5. **xterm.js `write()` is synchronous and fast.** Do not debounce or throttle it. Streaming AI output (token by token) needs to hit the terminal immediately. Any artificial delay will make AI tools feel sluggish.

6. **Cloudflare free tunnels generate a new URL every restart.** This is expected. The URL is displayed in the WSL terminal and as a QR code on every start. If a persistent URL is needed, the user would need a Cloudflare account and named tunnel — do not implement this unless asked.

7. **Windows executables via WSL interop require the full path.** Never just use `cmd.exe` — always `/mnt/c/Windows/System32/cmd.exe`. WSL interop must be enabled (it is by default in modern WSL2).

8. **The `.env` file must be in `.gitignore` from the start.** Include a clear comment in the generated `.env` file: `# DO NOT COMMIT THIS FILE`.

---

## DELIVERABLES CHECKLIST

- [ ] `scripts/setup.sh` — one-time setup (run first)
- [ ] `scripts/start.sh` — start server
- [ ] `package.json` — with all dependencies
- [ ] `server/config.js`
- [ ] `server/auth.js`
- [ ] `server/terminal.js`
- [ ] `server/tunnel.js`
- [ ] `server/index.js`
- [ ] `client/index.html` — login page
- [ ] `client/terminal.html` — terminal page with mobile toolbar
- [ ] `client/terminal.js` — xterm.js + WebSocket client
- [ ] `client/style.css` — dark, mobile-optimized
- [ ] `client/manifest.json` — PWA manifest
- [ ] `.env.example`
- [ ] `.gitignore` (includes `.env`, `node_modules/`, `*.log`)
- [ ] `README.md` — complete setup guide
