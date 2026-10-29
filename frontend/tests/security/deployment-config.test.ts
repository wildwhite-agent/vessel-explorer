import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const config = fileURLToPath(new URL('../../config/deploy.yml', import.meta.url))
function render(artworkHost?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, APP_HOST: 'vessel.example.org' }
  delete env.ARTWORK_HOST
  if (artworkHost !== undefined) env.ARTWORK_HOST = artworkHost
  return spawnSync('ruby', ['-rerb', '-ryaml', '-rjson', '-e',
    'puts JSON.generate(YAML.safe_load(ERB.new(File.read(ARGV[0])).result))', config],
    { env, encoding: 'utf8' })
}

test('the existing hostname serves sandboxed artwork when the optional hostname is absent', () => {
  for (const value of [undefined, '', '   ']) {
    const result = render(value)
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(result.stdout)
    assert.deepEqual(config.proxy.hosts, ['vessel.example.org'])
    assert.equal(config.env.clear.NUXT_PUBLIC_ARTWORK_ORIGIN, '')
  }
})

test('a configured artwork hostname enables the separate origin and rejects invalid or same-host values', () => {
  const result = render('artwork.vessel.example.org')
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.deepEqual(config.proxy.hosts, ['vessel.example.org', 'artwork.vessel.example.org'])
  assert.equal(config.env.clear.NUXT_PUBLIC_ARTWORK_ORIGIN, 'https://artwork.vessel.example.org')
  for (const value of ['vessel.example.org', 'https://artwork.example.org', 'artwork.example.org:443', 'localhost', 'artwork.example.org/path']) {
    assert.notEqual(render(value).status, 0, value)
  }
})
