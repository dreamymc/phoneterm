#!/bin/bash
set -euo pipefail

# Make sure we are in the project root
cd "$(dirname "$0")/.."

echo "Setting up Conduit..."

# Install build dependencies inside WSL Ubuntu/Debian if compilation tools are missing
if command -v apt-get &> /dev/null; then
  if ! command -v make &> /dev/null || ! command -v g++ &> /dev/null; then
    echo "Installing build-essential and python3..."
    sudo apt-get update && sudo apt-get install -y build-essential python3
  else
    echo "Compilation tools (make, g++) are already installed. Skipping apt-get install."
  fi
fi

# Download/Install cloudflared locally if not present
if [ ! -f bin/cloudflared ]; then
  echo "Installing cloudflared to ./bin/ (no sudo required)..."
  mkdir -p bin
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)   CLOUDFLARED_ARCH="amd64" ;;
    aarch64|arm64) CLOUDFLARED_ARCH="arm64" ;;
    *)
      echo "Error: Unsupported architecture $ARCH for cloudflared" >&2
      exit 1
      ;;
  esac
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CLOUDFLARED_ARCH}" \
    -o bin/cloudflared
  chmod +x bin/cloudflared
  echo "cloudflared installed to ./bin/cloudflared"
else
  echo "cloudflared already present at ./bin/cloudflared. Skipping."
fi

# Verify node and npm are installed
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is not installed." >&2
  exit 1
fi
if ! command -v npm &> /dev/null; then
  echo "Error: npm is not installed." >&2
  exit 1
fi

# Generate random secrets for .env if not exists
if [ ! -f .env ]; then
  echo "Generating .env with cryptographically secure secrets..."
  AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  
  if [ -z "$AUTH_SECRET" ] || [ -z "$JWT_SECRET" ]; then
    echo "Error: Generated secrets are empty." >&2
    exit 1
  fi
  
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

echo "Setup complete. Run ./scripts/start.sh to start Conduit."
