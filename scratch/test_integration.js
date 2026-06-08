const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log("Starting server in background...");
    serverProcess = spawn('node', ['server/index.js'], {
      env: { ...process.env, PORT: '3500' }
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Server stdout] ${output.trim()}`);
      if (output.includes('PhoneTerm is running')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server stderr] ${data.toString()}`);
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

function verifyHttp() {
  return new Promise((resolve, reject) => {
    console.log("Verifying HTTP static file serving...");
    http.get('http://localhost:3500/terminal.html', (res) => {
      console.log(`HTTP GET /terminal.html status: ${res.statusCode}`);
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to load terminal.html: ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data.includes('xterm') && data.includes('terminal-container')) {
          console.log("HTTP static file serving verified successfully.");
          resolve();
        } else {
          reject(new Error("terminal.html content does not match expected structure"));
        }
      });
    }).on('error', reject);
  });
}

function verifyWebSocket() {
  return new Promise((resolve, reject) => {
    console.log("Verifying WebSocket upgrade and PTY relay...");
    const ws = new WebSocket('ws://localhost:3500/terminal');
    
    let receivedBuffer = '';
    let hasSentEcho = false;
    let timer;

    ws.on('open', () => {
      console.log("WebSocket connection established.");
      // Send a resize event first to emulate client resize
      ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    });

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.type === 'output') {
          receivedBuffer += msg.data;
          console.log(`[PTY Output] ${msg.data}`);
          
          // Wait for shell to be active (e.g. we see prompt or environment path)
          // Then send our echo command
          if (!hasSentEcho && (receivedBuffer.includes('$') || receivedBuffer.includes('visionmc') || receivedBuffer.length > 5)) {
            hasSentEcho = true;
            console.log("Shell active. Sending echo command...");
            ws.send(JSON.stringify({ type: 'input', data: 'echo "INTEGRATION_TEST_PASSED"\r' }));
          }

          if (receivedBuffer.includes('INTEGRATION_TEST_PASSED') && !receivedBuffer.includes('echo "INTEGRATION_TEST_PASSED"\\r')) {
            console.log("Success! Echo command output detected in PTY stream.");
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        }
      } catch (err) {
        reject(err);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    ws.on('close', () => {
      console.log("WebSocket connection closed.");
    });

    // Set 8-second timeout for the integration test
    timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for 'INTEGRATION_TEST_PASSED' in PTY stream."));
    }, 8000);
  });
}

async function main() {
  try {
    await startServer();
    await verifyHttp();
    await verifyWebSocket();
    console.log("\n=========================");
    console.log("ALL INTEGRATION TESTS PASSED!");
    console.log("=========================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n=========================");
    console.error(`INTEGRATION TEST FAILED: ${err.message}`);
    console.error("=========================\n");
    process.exit(1);
  } finally {
    if (serverProcess) {
      console.log("Stopping background server process...");
      serverProcess.kill();
    }
  }
}

main();
