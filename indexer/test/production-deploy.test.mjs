import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/deploy-production.sh', import.meta.url));
for (const failAt of [0, 1, 2]) {
  test(`deployment preserves worker readiness ordering (failure step ${failAt})`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'vessel-deploy-'));
    const log = join(dir, 'calls.jsonl');
    try {
      writeFileSync(join(dir, 'kamal'), `#!/usr/bin/env node
const fs = require('node:fs');
const log = process.env.DEPLOY_TEST_LOG;
fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
const count = fs.readFileSync(log, 'utf8').trim().split('\\n').length;
if (count === Number(process.env.DEPLOY_TEST_FAIL_AT)) process.exit(42);
`, { mode: 0o755 });
      const result = spawnSync('sh', [script], { encoding: 'utf8', env: {
        ...process.env, PATH: dir + ':' + process.env.PATH, GITHUB_SHA: 'a'.repeat(40),
        DEPLOY_TEST_LOG: log, DEPLOY_TEST_FAIL_AT: String(failAt),
      } });
      assert.equal(result.status, failAt ? 42 : 0, result.stderr);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(calls.length, failAt || 3);
      assert.deepEqual(calls[0].slice(0, 3), ['deploy', '-c', 'config/deploy.worker.yml']);
      for (const call of calls) assert.equal(call[call.indexOf('--version') + 1], 'a'.repeat(40));
      if (calls[1]) {
        assert.deepEqual(calls[1].slice(0, 4), ['app', 'exec', '-c', 'config/deploy.worker.yml']);
        assert.ok(calls[1].includes('--reuse'));
        const command = calls[1].at(-1);
        assert.match(command, /^node -e '/);
        const code = command.slice("node -e '".length, -1);
        assert.equal(spawnSync(process.execPath, ['--check'], { input: code }).status, 0);
      }
      if (calls[2]) assert.equal(calls[2][0], 'deploy');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
