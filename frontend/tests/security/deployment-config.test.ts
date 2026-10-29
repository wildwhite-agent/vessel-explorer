import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const config = fileURLToPath(new URL('../../config/deploy.yml', import.meta.url))
test('the existing hostname serves the app and sandboxed artwork without another DNS record', () => {
  const result = spawnSync('ruby', ['-rerb', '-ryaml', '-rjson', '-e',
    'puts JSON.generate(YAML.safe_load(ERB.new(File.read(ARGV[0])).result))', config],
    { env: { ...process.env, APP_HOST: 'vessel.example.org' }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const rendered = JSON.parse(result.stdout)
  assert.deepEqual(rendered.proxy.hosts, ['vessel.example.org'])
  assert.equal(rendered.env.clear.NUXT_PUBLIC_ARTWORK_ORIGIN, undefined)
})
