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

  // Check if >90% printable ASCII (must come BEFORE bytecode check)
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

  // Check for EVM bytecode — only match the standard Solidity init sequence
  // Must come AFTER text check (0x60-0x7f overlaps with lowercase ASCII)
  if (data.length >= 5 &&
      data[0] === 0x60 && data[1] === 0x80 &&
      data[2] === 0x60 && data[3] === 0x40 &&
      data[4] === 0x52) {
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('')
    return { type: 'bytecode', text: hex }
  }

  return { type: 'binary', text: null }
}
