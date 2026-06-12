import { spawn } from 'node:child_process';

const processes = [];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  processes.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (code !== 0) {
      console.error(`${command} ${args.join(' ')} exited with code ${code ?? signal}`);
      shutdown(code ?? 1);
    }
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;

  for (const child of processes) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const db = spawn('docker', ['compose', 'up', '-d', 'postgres'], {
  stdio: 'inherit',
  shell: false,
});

db.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  run(npmCommand, ['--prefix', 'backend', 'run', 'start:dev']);
  run(npmCommand, ['--prefix', 'frontend', 'run', 'dev']);
});
