import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { validateMediaUrl, isPublicAddress, resolvePublicAddress, decodeMediaDataUri, collectBounded, decodeMediaBody, fetchMediaHttps } from '../../server/utils/safe-media-fetch.ts'
import { normalizeCompressedHtmlScripts, ARTWORK_CSP } from '../../server/utils/active-media.ts'
import { sequencePoster } from '../../server/utils/sequence-poster.ts'
import sharp from 'sharp'
import { MAX_METADATA_BYTES } from '../../server/utils/media-limits.ts'

const hosts = ['ipfs.io', 'arweave.net']
test('only configured HTTPS hosts and public DNS results are accepted', async () => {
  for (const uri of ['http://ipfs.io/a', 'https://ipfs.io:8443/a', 'https://user:pass@ipfs.io/a', 'file:///etc/passwd', 'https://ipfs.io.evil.test/a', 'https://127.0.0.1/a', 'https://[::1]/a']) {
    assert.throws(() => validateMediaUrl(uri, hosts))
  }
  assert.equal(validateMediaUrl('ipfs://cid/image', hosts).href, 'https://ipfs.io/ipfs/cid/image')
  for (const address of ['127.0.0.1', '0.0.0.0', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('1.1.1.1'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  await assert.rejects(resolvePublicAddress('ipfs.io', async () => [
    { address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 },
  ] as any))
})

test('data URIs, streams and HTTP compressed bodies have byte ceilings', async () => {
  assert.equal(Buffer.from(decodeMediaDataUri('data:text/plain;base64,b2s=', 8).bytes).toString(), 'ok')
  for (const uri of ['data:text/plain,%GG', 'data:text/plain;base64,!!!!', `data:text/plain,${'x'.repeat(40)}`]) {
    assert.throws(() => decodeMediaDataUri(uri, 8))
  }
  await assert.rejects(collectBounded(Readable.from([Buffer.alloc(4), Buffer.alloc(5)]), 8))
  await assert.rejects(collectBounded(Readable.from(Array.from({ length: 1025 }, () => Buffer.from('x'))), 2048))
  assert.throws(() => decodeMediaBody(gzipSync(Buffer.alloc(32)), 'gzip', 8))
  assert.equal(decodeMediaBody(gzipSync(Buffer.from('ok')), 'gzip', 8).toString(), 'ok')
  assert.throws(() => decodeMediaBody(Buffer.from('ok'), 'unknown', 8))
})

test('embedded artwork metadata admits existing piece sizes while retaining a 2 MiB ceiling', () => {
  // Sequence #1 embeds 1,344,989 bytes of JSON; #2 embeds 1,111,881 bytes.
  // Match their decoded size without storing or executing the artwork fixture.
  for (const size of [1_344_989, 1_111_881]) {
    const prefix = 'data:image/png;base64,'
    const empty = JSON.stringify({ image: prefix })
    const metadata = JSON.stringify({ image: prefix + 'A'.repeat(size - Buffer.byteLength(empty)) })
    const uri = 'data:application/json;base64,' + Buffer.from(metadata).toString('base64')
    assert.equal(decodeMediaDataUri(uri, MAX_METADATA_BYTES).bytes.byteLength, size)
  }
  const tooLarge = Buffer.alloc(2 * 1024 * 1024 + 1, 'x')
  assert.throws(() => decodeMediaDataUri('data:application/json;base64,' + tooLarge.toString('base64'), MAX_METADATA_BYTES))
  assert.throws(() => decodeMediaBody(gzipSync(tooLarge), 'gzip', MAX_METADATA_BYTES))
})

function response(status: number, headers: Record<string, string>, chunks: Buffer[] = []) {
  return Object.assign(Readable.from(chunks), { statusCode: status, headers }) as any
}
const resolve = async () => ({ address: '1.1.1.1', family: 4 })
test('every redirect is validated and resolved again; loops and deadlines fail closed', async () => {
  let requests = 0
  const blocked = {
    resolve,
    open: async () => { requests++; return response(302, { location: 'http://169.254.169.254/latest/meta-data/' }) },
    timeoutMs: 100,
  }
  await assert.rejects(fetchMediaHttps(new URL('https://ipfs.io/start'), 8, blocked))
  assert.equal(requests, 1)
  const resolved: string[] = []
  const valid = {
    resolve: async (host: string) => { resolved.push(host); return resolve() },
    open: async (url: URL) => url.hostname === 'ipfs.io'
      ? response(302, { location: 'https://arweave.net/poster' })
      : response(200, { 'content-type': 'image/png' }, [Buffer.from('ok')]),
    timeoutMs: 100,
  }
  assert.equal(Buffer.from((await fetchMediaHttps(new URL('https://ipfs.io/start'), 8, valid)).bytes).toString(), 'ok')
  assert.deepEqual(resolved, ['ipfs.io', 'arweave.net'])
  requests = 0
  await assert.rejects(fetchMediaHttps(new URL('https://ipfs.io/start'), 8, {
    ...blocked, open: async () => { requests++; return response(302, { location: '/again' }) },
  }))
  assert.equal(requests, 4)
  await assert.rejects(fetchMediaHttps(new URL('https://ipfs.io/start'), 8, {
    ...blocked, resolve: () => new Promise(() => {}), timeoutMs: 10,
  }))
  await assert.rejects(fetchMediaHttps(new URL('https://ipfs.io/start'), 8, {
    ...blocked, open: async () => response(200, { 'content-length': '9' }, [Buffer.alloc(9)]),
  }))
  await assert.rejects(fetchMediaHttps(new URL('https://ipfs.io/start'), 8, {
    ...blocked, open: async () => response(200, {}, [Buffer.alloc(4), Buffer.alloc(5)]),
  }))
})

test('embedded gzip expansion and script counts are bounded', () => {
  const script = (bytes: Buffer) => `<script type="text/javascript+gzip" src="data:text/javascript;base64,${gzipSync(bytes).toString('base64')}"></script>`
  const media = (html: string) => ({ bytes: Buffer.from(html), mime: 'text/html' })
  assert.match(Buffer.from(normalizeCompressedHtmlScripts(media(script(Buffer.from('console.log(1)')))).bytes).toString(), /type="text\/javascript"/)
  assert.throws(() => normalizeCompressedHtmlScripts(media(script(Buffer.alloc(1024 * 1024 + 1)))))
  assert.throws(() => normalizeCompressedHtmlScripts(media(script(Buffer.from('a')).repeat(17))))
  assert.match(ARTWORK_CSP, /^sandbox allow-scripts allow-pointer-lock;/)
  assert.ok(!ARTWORK_CSP.includes('allow-same-origin'))
})

test('poster decoder ignores active HTML and SVG; raster previews are 1200 by 630', async () => {
  for (const media of [
    { bytes: Buffer.from('<script>throw new Error("must never run")</script>'), mime: 'image/png' },
    { bytes: Buffer.from('<svg><image href="file:///etc/passwd"/></svg>'), mime: 'image/svg+xml' },
    { bytes: await sharp({ create: { width: 20, height: 40, channels: 3, background: 'red' } }).png().toBuffer(), mime: 'image/png' },
  ]) {
    const png = await sequencePoster(media)
    const metadata = await sharp(png).metadata()
    assert.equal(metadata.width, 1200)
    assert.equal(metadata.height, 630)
  }
})

test('poster conversion preserves the displayed orientation of JPEG artwork', async () => {
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const png = await sequencePoster({ bytes, mime: 'image/jpeg' })
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
  // The displayed image is portrait: side bars are black and the center reaches
  // the top. Ignoring EXIF would instead paint a wide landscape strip.
  assert.deepEqual(pixel(200, 315), [0, 0, 0])
  assert.ok(pixel(600, 20)[0]! > 240)
  assert.ok(pixel(600, 20)[1]! < 10)
})
