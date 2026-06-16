import { spawn } from 'node:child_process';

const processes = [];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// FastAPI 서버는 ai-server 안의 Python 가상환경으로 실행합니다.
// Windows와 macOS/Linux는 venv 경로가 달라서 나눠서 지정합니다.
const aiPythonCommand = process.platform === 'win32'
  ? '.venv\\Scripts\\python.exe'
  : '.venv/bin/python';

function run(command, args, options = {}) {
  // backend, frontend, ai-server처럼 오래 켜져 있어야 하는 프로세스를 실행합니다.
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  processes.push(child);

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`${command} ${args.join(' ')} failed to start`);
    console.error(error.message);
    shutdown(1);
  });

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

  // DB가 켜진 뒤 NestJS, React, FastAPI를 한 번에 실행합니다.
  run(npmCommand, ['--prefix', 'backend', 'run', 'start:dev']);
  run(npmCommand, ['--prefix', 'frontend', 'run', 'dev']);
  run(aiPythonCommand, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'], {
    cwd: 'ai-server',
  });
});
