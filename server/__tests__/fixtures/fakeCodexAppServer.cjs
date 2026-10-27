// Simulated Codex app-server for tests: JSON-RPC over stdio, no network, no model, no files
// except the optional log path given by the test. Behaviour is selected by FAKE_CODEX_MODE.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');

const mode = process.env.FAKE_CODEX_MODE || 'complete';
const log = process.env.FAKE_CODEX_LOG;
const record = (entry) => log && fs.appendFileSync(log, JSON.stringify(entry) + '\n');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

record({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid });
if (mode === 'hang-tree') {
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  record({ grandchild: grandchild.pid });
}

function complete() {
  send({ method: 'item/agentMessage/delta', params: { delta: 'Análise ' } });
  send({ method: 'item/agentMessage/delta', params: { delta: 'pronta.' } });
  send({
    method: 'thread/tokenUsage/updated',
    params: { tokenUsage: { total: { totalTokens: 42 } } },
  });
  send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  record({
    method: message.method,
    id: message.id,
    params: message.params,
    result: message.result,
  });
  if (message.method === undefined) {
    // Response to our approval request: finish the turn whatever the decision was.
    if (message.id === 'approval-1') complete();
    return;
  }
  if (message.id === undefined) return;
  switch (message.method) {
    case 'initialize':
      return send({ id: message.id, result: {} });
    case 'config/read':
      return send({ id: message.id, result: { config: { mcp_servers: { example: {} } } } });
    case 'thread/start':
      if (mode === 'exit-before-turn') process.exit(3);
      return send({ id: message.id, result: { thread: { id: 'thread-1' } } });
    case 'turn/start':
      send({ id: message.id, result: { turn: { id: 'turn-1' } } });
      if (mode === 'complete') complete();
      if (mode === 'fail')
        send({ method: 'turn/completed', params: { turn: { status: 'failed' } } });
      if (mode === 'approval')
        send({
          id: 'approval-1',
          method: 'item/commandExecution/requestApproval',
          params: { command: 'curl https://example.com' },
        });
      if (mode === 'exit-after-turn') setTimeout(() => process.exit(4), 20);
      return; // 'hang' and 'hang-tree' never complete.
  }
});
