// Keep ordinary upstream launches unchanged. MD2 execution is opt-in.
const { spawn } = require('node:child_process');
const path = require('node:path');
const child = spawn(
  process.execPath,
  [path.join(__dirname, '../dist/cli.js'), ...process.argv.slice(2)],
  {
    cwd: process.env.MD2_WORKSPACE || process.cwd(),
    env: { ...process.env, MD2_OFFICE_ENABLED: '1' },
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.on('error', (error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
