# PhoneTerm

PhoneTerm is a secure, web-based pseudo-terminal (PTY) interface designed specifically to make your Windows Subsystem for Linux (WSL 2) environment accessible from mobile browsers and other devices on your local network or via secure tunnels.

---

## Table of Contents

- [Core Features](#core-features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
  - [Manual Execution](#manual-execution)
  - [Automatic Startup on Boot (Windows Task Scheduler)](#automatic-startup-on-boot-windows-task-scheduler)
- [Logging and Log Rotation](#logging-and-log-rotation)

---

## Core Features

- **PTY Session Persistence:** Keeps shell sessions active in the background even if your mobile browser disconnects, allowing you to reconnect and resume where you left off.
- **Cloudflare Tunnel Integration:** Secures external/remote access using an automated local Cloudflare Tunnel (`cloudflared`) without requiring manual router configuration or port forwarding.
- **UI Special Keys Toolbar:** A responsive, touch-friendly toolbar for mobile browsers that maps special terminal keys (like `Ctrl`, `Alt`, `Esc`, `Tab`, and arrows) to make mobile typing frictionless.
- **Shell Switching:** Seamlessly switch between configured shell programs (e.g., `bash`, `zsh`, `sh`) from within the web interface.

---

## Prerequisites

Before starting, make sure your host machine has:

- **Node.js 18+** installed inside your WSL environment.
- **WSL 2** running a Linux distribution (e.g., Ubuntu or Debian).
- **build-essential** package (specifically tools like `make` and `g++`) installed on the WSL distribution to compile native C++ addons (`node-pty`).

---

## Installation

Run the automated setup script from the project root to install Node.js dependencies, compile native modules, generate authentication secrets, and configure the local Cloudflare Tunnel executable:

```bash
bash scripts/setup.sh
```

### What the Setup Script Performs:
1. Installs compilation tools (`build-essential`, `python3`) using `apt-get` if they are not already installed on the WSL distribution.
2. Downloads and sets up the appropriate version of the `cloudflared` binary inside `bin/` (run locally; requires no root privileges).
3. Verifies system Node.js and npm versions.
4. Generates a secure `.env` file containing random tokens for local session authentication (`AUTH_SECRET` and `JWT_SECRET`).
5. Installs the project dependency tree and triggers a native compilation rebuild for `node-pty`.

---

## Usage

### Manual Execution

To boot the PhoneTerm server manually, run:

```bash
bash scripts/start.sh
```

Once running, the console will print connection details, listing both local network URLs and the secure Cloudflare Tunnel URL (if configured), alongside a QR code which you can scan with your smartphone to open the terminal immediately.

---

### Automatic Startup on Boot (Windows Task Scheduler)

To ensure PhoneTerm is always available whenever your computer turns on, configure it to run in the background as a Windows startup service using **Windows Task Scheduler**.

#### Step-by-Step Configuration:

1. **Open Task Scheduler:**
   - Press the Windows Key, type `Task Scheduler`, and press **Enter**.

2. **Create a Basic Task:**
   - On the right sidebar, click **Create Basic Task...**
   - Name the task: `Start PhoneTerm`.
   - Click **Next**.

3. **Set the Trigger:**
   - Choose the option **When the computer starts**.
   - Click **Next**.

4. **Set the Action:**
   - Choose the option **Start a program**.
   - Click **Next**.
   - Configure the program settings:
     - **Program/script:** `C:\Windows\System32\wsl.exe`
     - **Add arguments (optional):** `-d Ubuntu -e bash -c "cd ~/phoneterm && ./scripts/autostart.sh"`
       *(Note: If your WSL distribution is not Ubuntu, replace `-d Ubuntu` with your specific distribution name. If you cloned the repository to a folder other than `~/phoneterm`, update the directory path in the command accordingly).*
     - Click **Next**, then click **Finish**.

5. **Configure Advanced Task Properties:**
   - In the **Task Scheduler Library**, locate and double-click the newly created `Start PhoneTerm` task to open its properties dialog.
   - **General Tab:**
     - Select **Run whether user is logged on or not**.
     - Check the checkbox **Run with highest privileges**.
   - **Conditions Tab:**
     - Uncheck **Start the task only if the computer is on AC power** (to guarantee the task runs on laptops when running on battery).
   - Click **OK**, then enter your Windows user credentials if prompted to authorize the task execution policy.

---

## Logging and Log Rotation

When PhoneTerm runs in the background (such as when launched automatically via Task Scheduler using `autostart.sh`), all server outputs, error messages, and debug logs are redirected to the log file at:

```
~/phoneterm/phoneterm.log
```

### Log Rotation:
- Before booting the Node.js server, the startup shell script automatically inspects the size of `phoneterm.log`.
- If the log file size exceeds **5MB** (5,242,880 bytes), it is automatically moved and renamed to `phoneterm.log.old` (overwriting the previous backup log, if any) to prevent disk space exhaustion.
- A fresh, empty `phoneterm.log` file is then created for the new session.
