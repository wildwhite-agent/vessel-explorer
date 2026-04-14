import { readFile } from 'node:fs/promises'

export async function loadEnvFile(path) {
  let contents = ''
  try {
    contents = await readFile(path, 'utf8')
  } catch (e) {
    if (e?.code === 'ENOENT') return
    throw e
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key] != null) continue

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}
