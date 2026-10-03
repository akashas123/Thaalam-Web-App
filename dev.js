const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const localPython = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe')
  : '';
const python = process.env.PYTHON || (localPython && fs.existsSync(localPython) ? localPython : 'python');
const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

function launch(command, args, label) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(`Could not start ${label}: ${error.message}`);
    if (label === 'Python backend') {
      console.error('Set PYTHON to the path of your Python executable if it is not on PATH.');
    }
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (signal) {
      stop(1);
      return;
    }
    if (code !== 0) console.error(`${label} exited with code ${code}.`);
    stop(code || 0);
  });
  return child;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

launch(python, [path.join(root, 'backend', 'server.py')], 'Python backend');
launch(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], 'Vite');
