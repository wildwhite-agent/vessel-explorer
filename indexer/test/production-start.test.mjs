import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('worker replacements use distinct schemas while container restarts retain their schema', () => {
  const bin = mkdtempSync(join(tmpdir(), 'vessel-entrypoint-'))
  try {
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', { mode: 0o700 })
    writeFileSync(join(bin, 'hostname'), '#!/bin/sh\nprintf \'%s\\n\' "$FIXTURE_HOSTNAME"\n', { mode: 0o700 })
    const run = (hostname, extra = {}) => {
      const result = spawnSync('sh', [fileURLToPath(new URL('../scripts/start-production.sh', import.meta.url))], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VESSEL_PROCESS: 'indexer', KAMAL_VERSION: 'same-commit', FIXTURE_HOSTNAME: hostname, DATABASE_SCHEMA: '', PONDER_VIEWS_SCHEMA: 'vessel', ...extra },
      })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim().split('\n')
    }
    const schema = args => args.find(arg => arg.startsWith('--schema='))
    const first = run('worker-1')
    assert.match(schema(first), /^--schema=vessel_[0-9a-f]{16}$/)
    assert.equal(schema(run('worker-1')), schema(first))
    assert.notEqual(schema(run('worker-2')), schema(first))
    assert.notEqual(schema(run('worker-1', { KAMAL_VERSION: 'new-commit' })), schema(first))
    assert.ok(first.includes('--hostname=127.0.0.1'))
    assert.equal(schema(run('worker-1', { DATABASE_SCHEMA: 'manual_stopped_writer' })), '--schema=manual_stopped_writer')
    const api = run('api-1', { VESSEL_PROCESS: 'api', DATABASE_SCHEMA: 'unused' })
    assert.equal(schema(api), '--schema=vessel')
    assert.ok(api.includes('serve'))
    assert.ok(api.includes('--hostname=0.0.0.0'))
  } finally { rmSync(bin, { recursive: true, force: true }) }
})
