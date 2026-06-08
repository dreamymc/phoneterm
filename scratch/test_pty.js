const pty = require('node-pty');
console.log("node-pty loaded successfully.");
try {
  const term = pty.spawn('bash', [], { name: 'xterm-256color', cols: 80, rows: 24 });
  console.log("Successfully spawned bash PTY");
  term.kill();
  process.exit(0);
} catch (e) {
  console.error("Failed to spawn PTY:", e);
  process.exit(1);
}
