'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Regex to extract the trycloudflare.com URL from cloudflared's stderr
const TUNNEL_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

/**
 * Spawns cloudflared as a child process and returns a Promise that resolves
 * with the public tunnel URL once it appears in cloudflared's stderr output.
 *
 * @param {number} port - The local port to tunnel to.
 * @param {number} [timeoutMs=30000] - How long to wait for the URL before rejecting.
 * @returns {Promise<string>} Resolves with the public https URL.
 */
function startTunnel(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const binaryPath = path.resolve(__dirname, '../bin/cloudflared');

    const cf = spawn(binaryPath, [
      'tunnel',
      '--url', `http://localhost:${port}`,
      '--no-autoupdate',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;

    function settle(err, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(url);
    }

    // cloudflared prints the URL to stderr
    cf.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(TUNNEL_URL_RE);
      if (match) {
        settle(null, match[0]);
      }
    });

    // Also check stdout just in case (future cloudflared versions)
    cf.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(TUNNEL_URL_RE);
      if (match) {
        settle(null, match[0]);
      }
    });

    cf.on('error', (err) => {
      settle(new Error(`Failed to spawn cloudflared: ${err.message}`));
    });

    cf.on('exit', (code, signal) => {
      settle(new Error(`cloudflared exited unexpectedly (code=${code}, signal=${signal})`));
    });

    // Timeout guard
    const timer = setTimeout(() => {
      settle(new Error(`Timed out waiting for cloudflared URL after ${timeoutMs}ms`));
      cf.kill();
    }, timeoutMs);

    // Clean up cloudflared when Node exits
    process.on('exit', () => cf.kill());
    process.on('SIGINT', () => { cf.kill(); process.exit(0); });
    process.on('SIGTERM', () => { cf.kill(); process.exit(0); });
  });
}

module.exports = { startTunnel };
