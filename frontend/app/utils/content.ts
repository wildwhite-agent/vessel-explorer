export type ContentType = 'svg' | 'html' | 'text' | 'bytecode' | 'binary'

export interface DetectedContent {
  type: ContentType
  text: string | null
}

export function detectContent(data: Uint8Array): DetectedContent {
  if (!data || data.length === 0) {
    return { type: 'binary', text: null }
  }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const text = decoder.decode(data)
  const trimmed = text.trimStart()

  if (/^<svg/i.test(trimmed)) {
    return { type: 'svg', text }
  }

  if (/^<!|^</.test(trimmed)) {
    return { type: 'html', text }
  }

  // Check for EVM bytecode (common Solidity patterns)
  if (data.length >= 4) {
    // PUSH1 0x80 PUSH1 0x40 (0x6080 6040) — standard Solidity init
    if (data[0] === 0x60 && data[1] === 0x80 && data[2] === 0x60 && data[3] === 0x40) {
      const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('')
      return { type: 'bytecode', text: hex }
    }
    // PUSH1 as first byte + high density of PUSH opcodes
    if (data[0] >= 0x60 && data[0] <= 0x7f) {
      let pushCount = 0
      for (let i = 0; i < Math.min(data.length, 64); i++) {
        if (data[i] >= 0x60 && data[i] <= 0x7f) pushCount++
      }
      if (pushCount > 8) {
        const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('')
        return { type: 'bytecode', text: hex }
      }
    }
  }

  // Check if >90% printable ASCII
  let printable = 0
  for (let i = 0; i < data.length; i++) {
    const b = data[i]
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) {
      printable++
    }
  }

  if (printable / data.length > 0.9) {
    return { type: 'text', text }
  }

  return { type: 'binary', text: null }
}
