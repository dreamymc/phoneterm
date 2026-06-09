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
  const binaryPath = path.resolve(__dirname, '../bin/cloudflared');
  const maxAttempts = 3;
  const retryDelayMs = 5000;

  function runAttempt(attemptNum) {
    return new Promise((resolve, reject) => {
      const cf = spawn(binaryPath, [
        'tunnel',
        '--url', `http://localhost:${port}`,
        '--no-autoupdate',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let settled = false;
      let timer = null;

      // Event listener functions for process cleanup
      const exitHandler = () => {
        try { cf.kill(); } catch (e) {}
      };
      const sigintHandler = () => {
        try { cf.kill(); } catch (e) {}
        process.exit(0);
      };
      const sigtermHandler = () => {
        try { cf.kill(); } catch (e) {}
        process.exit(0);
      };

      // Clean up helper
      function cleanUp() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        process.off('exit', exitHandler);
        process.off('SIGINT', sigintHandler);
        process.off('SIGTERM', sigtermHandler);
      }

      function settle(err, url) {
        if (settled) return;
        settled = true;
        cleanUp();
        if (err) {
          try { cf.kill(); } catch (e) {}
          return reject(err);
        }
        resolve(url);
      }

      // Register process exit / signal handlers
      process.on('exit', exitHandler);
      process.on('SIGINT', sigintHandler);
      process.on('SIGTERM', sigtermHandler);

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
      timer = setTimeout(() => {
        settle(new Error(`Timed out waiting for cloudflared URL after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  function attempt(num) {
    return runAttempt(num)
      .catch((err) => {
        if (num < maxAttempts) {
          console.warn(`Warning: Cloudflare Tunnel attempt ${num} failed: ${err.message}. Retrying in ${retryDelayMs / 1000}s...`);
          return new Promise((resolve) => setTimeout(resolve, retryDelayMs))
            .then(() => attempt(num + 1));
        } else {
          throw new Error(`All ${maxAttempts} Cloudflare Tunnel attempts failed. Last error: ${err.message}`);
        }
      });
  }

  return attempt(1);
}

module.exports = { startTunnel };
