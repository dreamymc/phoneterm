# Conduit

> **Secure, mobile-first remote terminal access for your WSL 2 environment.**
> Turn any phone browser into a full shell connected directly to your Linux environment on Windows — on your local network or over the internet.

```
 ██████╗ ██████╗ ███╗   ██╗██████╗ ██╗   ██╗██╗████████╗
██╔════╝██╔═══██╗████╗  ██║██╔══██╗██║   ██║██║╚══██╔══╝
██║     ██║   ██║██╔██╗ ██║██║  ██║██║   ██║██║   ██║
██║     ██║   ██║██║╚██╗██║██║  ██║██║   ██║██║   ██║
╚██████╗╚██████╔╝██║ ╚████║██████╔╝╚██████╔╝██║   ██║
 ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚═╝   ╚═╝
```

---

## What is Conduit?

Conduit is a **secure, web-based PTY gateway for WSL 2 on Windows**. It connects your phone browser directly to your Linux environment — in real time, from anywhere. It behaves exactly like opening a terminal locally, with full support for interactive TUI apps, AI CLI tools, and shell switching, delivered through a mobile-optimized, PWA-ready web UI.

WSL 2 is a powerful development environment, but it has no built-in way to access it remotely. Conduit fills that gap — your WSL environment, in your pocket.

Use it as your **personal pocket dev console**:

- Get a WSL shell from your phone in seconds without touching your keyboard
- Run scripts, dev tools, and AI CLIs from the couch, bed, or anywhere else
- Switch between your Linux environment and Windows CMD or PowerShell from the same interface
- Keep sessions alive even if your browser tab dies or your network drops

---

## Core Capabilities

- 🧠 **Persistent PTY Sessions**
  Shell sessions continue running in the background even if your mobile browser disconnects. Reconnect and pick up right where you left off.

- 🌐 **Cloudflare Tunnel Integration**
  Automatic Cloudflare Quick Tunnel setup via `cloudflared` gives you a secure HTTPS URL without touching your router or opening any ports.

- 📲 **Mobile-First Terminal UI**
  A responsive xterm.js-based terminal with a touch-friendly special-key toolbar for `Ctrl`, `Esc`, `Tab`, and arrow keys, tuned for small screens.

- 🧪 **Interactive CLI / TUI Support**
  Built for tools like `codex`, `agy`, `htop`, `nano`, and any other TUI program — with correct PTY sizing, UTF-8 locale enforcement, and zero-buffered streaming output.

- 🔁 **Shell Switching (WSL ↔ Windows)**
  Switch between `bash`, `zsh`, Windows `cmd.exe`, and PowerShell from the same web interface, with clean PTY teardown and respawn on every switch.

- 🔐 **Token-Based Access with JWT**
  A single secret token gets exchanged for a long-lived JWT stored on your phone, securing both HTTP and WebSocket connections.

- ♻️ **Resilient Reconnect & Session Persistence**
  Handles transient network drops and reconnections automatically, keeping PTY processes alive briefly so your shell history and context survive.

- 🪟 **Auto-Start on Windows Boot**
  Integrates with Windows Task Scheduler so Conduit starts in the background whenever your PC boots — your WSL environment is always reachable.

- 📦 **PWA Support**
  Add Conduit to your home screen on iOS or Android and run it fullscreen like a native app with no browser chrome.

---

## Prerequisites

- **Node.js 18+** inside WSL 2
- **WSL 2** with Ubuntu or Debian
- **build-essential** and **python3** installed in WSL (required to compile `node-pty` native bindings)

---

## Installation

From the project root inside WSL, run:

```bash
bash scripts/setup.sh
```

This will:

1. Install compilation tools (`build-essential`, `python3`) if not already present
2. Download the `cloudflared` binary into `bin/` without requiring root or sudo
3. Generate a secure `.env` file with random `AUTH_SECRET` and `JWT_SECRET` values
4. Install all Node.js dependencies and rebuild `node-pty` native bindings

---

## Usage

### Manual Start

```bash
bash scripts/start.sh
```

On startup, the console displays:

- Local HTTP URL for LAN access (e.g. `http://192.168.x.x:3000`)
- Public HTTPS Cloudflare Tunnel URL for internet access
- QR codes for both URLs — scan to open instantly on your phone

### Connecting from Your Phone

1. Scan either QR code from your WSL terminal, or type the URL into your phone browser
2. Enter your access token on the login page (shown in the startup output)
3. You're in — a full WSL shell running on your machine

---

## Auto-Start on Windows Boot

To have Conduit start automatically every time your PC turns on:

1. Press the Windows key, type **Task Scheduler**, press Enter
2. Click **Create Basic Task**
3. Name it `Start Conduit`, set the trigger to **When the computer starts**
4. Set the action to **Start a program** with these values:
   - Program: `C:\Windows\System32\wsl.exe`
   - Arguments: `-d Ubuntu -e bash -c "cd ~/conduit && bash scripts/start.sh"`
   - Adjust the distro name and path if yours differ
5. On the General tab: check **Run whether user is logged on or not** and **Run with highest privileges**
6. On the Conditions tab: uncheck **Start the task only if the computer is on AC power**

Logs are written to `~/conduit/conduit.log` and auto-rotate when the file exceeds 5MB.

---

## Mobile PWA Installation

Conduit includes a PWA manifest. Install it to your home screen for a fullscreen, app-like experience with no browser chrome.

**iOS (Safari)**
1. Open the Cloudflare HTTPS URL in Safari
2. Tap **Share** → **Add to Home Screen**
3. Tap **Add**

**Android (Chrome)**
1. Open the Cloudflare HTTPS URL in Chrome
2. Tap the three-dot menu
3. Tap **Install app** (not "Add to Home Screen" — Install app gives the true standalone experience)

---

## Copy & Paste

Clipboard access requires a **secure context** (HTTPS or localhost). This means:

- ✅ **Cloudflare Tunnel URL** — full clipboard support. Long-press the terminal to open the context menu and use Copy Selection or Paste Clipboard
- ⚠️ **Local LAN URL (`http://`)** — browsers block clipboard access. Use the Cloudflare URL for clipboard functionality, or use your browser's native paste instead

---

## Frequently Asked Questions

**My interactive tool shows weird characters.**
This is a locale issue. Run the following and add them to your `~/.bashrc` or `~/.zshrc`:
```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

**The public URL changes every time I restart.**
Cloudflare Quick Tunnels generate a new random subdomain on each start. This is expected for the free tier. The new URL is always printed with a QR code on startup. For a fixed permanent URL, create a Cloudflare account, register a domain, and configure a named tunnel.

**How do I update my access token?**
Open `.env` in the project root, update the `AUTH_SECRET` value, and restart Conduit.

**I only want to use CMD or PowerShell — do I still need WSL?**
Yes. Conduit's server runs inside WSL regardless of which shell you use. WSL is the host, not the destination. Once connected, you can switch to CMD or PowerShell from the shell switcher dropdown in the UI.

**Shell switching hangs when I run `wsl ~` inside the CMD terminal.**
Running `wsl` from inside Conduit's CMD shell creates a nested process and will hang. Use the shell switcher dropdown to switch back to bash directly instead.

**The toolbar buttons are not visible on my phone.**
Tap outside the terminal first to dismiss the keyboard — the toolbar is fixed to the bottom of the viewport and may be hidden behind it. If it's still not visible, try rotating to landscape.
