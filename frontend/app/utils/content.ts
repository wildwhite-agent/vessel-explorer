export type ContentType = 'svg' | 'html' | 'text' | 'bytecode' | 'binary'

export interface DetectedContent {
  type: ContentType
  text: string | null
}

export interface EvmInstruction {
  offset: number
  opcode: number
  name: string
  pushData: string | null
  invalid: boolean
}

const EVM_OPCODE_NAMES: Record<number, string> = {
  0x00: 'STOP',
  0x01: 'ADD',
  0x02: 'MUL',
  0x03: 'SUB',
  0x04: 'DIV',
  0x05: 'SDIV',
  0x06: 'MOD',
  0x07: 'SMOD',
  0x08: 'ADDMOD',
  0x09: 'MULMOD',
  0x0a: 'EXP',
  0x0b: 'SIGNEXTEND',
  0x10: 'LT',
  0x11: 'GT',
  0x12: 'SLT',
  0x13: 'SGT',
  0x14: 'EQ',
  0x15: 'ISZERO',
  0x16: 'AND',
  0x17: 'OR',
  0x18: 'XOR',
  0x19: 'NOT',
  0x1a: 'BYTE',
  0x1b: 'SHL',
  0x1c: 'SHR',
  0x1d: 'SAR',
  0x20: 'SHA3',
  0x30: 'ADDRESS',
  0x31: 'BALANCE',
  0x32: 'ORIGIN',
  0x33: 'CALLER',
  0x34: 'CALLVALUE',
  0x35: 'CALLDATALOAD',
  0x36: 'CALLDATASIZE',
  0x37: 'CALLDATACOPY',
  0x38: 'CODESIZE',
  0x39: 'CODECOPY',
  0x3a: 'GASPRICE',
  0x3b: 'EXTCODESIZE',
  0x3c: 'EXTCODECOPY',
  0x3d: 'RETURNDATASIZE',
  0x3e: 'RETURNDATACOPY',
  0x3f: 'EXTCODEHASH',
  0x40: 'BLOCKHASH',
  0x41: 'COINBASE',
  0x42: 'TIMESTAMP',
  0x43: 'NUMBER',
  0x44: 'PREVRANDAO',
  0x45: 'GASLIMIT',
  0x46: 'CHAINID',
  0x47: 'SELFBALANCE',
  0x48: 'BASEFEE',
  0x49: 'BLOBHASH',
  0x4a: 'BLOBBASEFEE',
  0x50: 'POP',
  0x51: 'MLOAD',
  0x52: 'MSTORE',
  0x53: 'MSTORE8',
  0x54: 'SLOAD',
  0x55: 'SSTORE',
  0x56: 'JUMP',
  0x57: 'JUMPI',
  0x58: 'PC',
  0x59: 'MSIZE',
  0x5a: 'GAS',
  0x5b: 'JUMPDEST',
  0x5c: 'TLOAD',
  0x5d: 'TSTORE',
  0x5e: 'MCOPY',
  0x5f: 'PUSH0',
  0xf0: 'CREATE',
  0xf1: 'CALL',
  0xf2: 'CALLCODE',
  0xf3: 'RETURN',
  0xf4: 'DELEGATECALL',
  0xf5: 'CREATE2',
  0xfa: 'STATICCALL',
  0xfd: 'REVERT',
  0xfe: 'INVALID',
  0xff: 'SELFDESTRUCT',
}

export function detectContent(data: Uint8Array): DetectedContent {
  if (!data || data.length === 0) {
    return { type: 'binary', text: null }
  }

  let end = data.length
  while (end > 0 && data[end - 1] === 0x00) {
    end--
  }

  const meaningfulData = end === data.length ? data : data.slice(0, end)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const text = decoder.decode(meaningfulData)
  const trimmed = text.trimStart()

  if (/^<svg/i.test(trimmed)) {
    return { type: 'svg', text }
  }

  if (/^<!|^</.test(trimmed)) {
    return { type: 'html', text }
  }

  if (isLikelyEvmBytecode(meaningfulData)) {
    return { type: 'bytecode', text: bytesToHex(meaningfulData) }
  }

  const hexBytecode = parseHexEncodedBytecode(trimmed)
  if (hexBytecode && isLikelyEvmBytecode(hexBytecode)) {
    return { type: 'bytecode', text: bytesToHex(hexBytecode) }
  }

  // Check if >90% printable ASCII after bytecode detection.
  let printable = 0
  for (let i = 0; i < meaningfulData.length; i++) {
    const b = meaningfulData[i]!
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) {
      printable++
    }
  }

  if (meaningfulData.length > 0 && printable / meaningfulData.length > 0.9) {
    return { type: 'text', text }
  }

  return { type: 'binary', text: null }
}

export function disassembleEvmBytecode(hex: string): EvmInstruction[] {
  const clean = cleanHex(hex)
  const instructions: EvmInstruction[] = []

  for (let i = 0; i < clean.length; i += 2) {
    const offset = i / 2
    const opcode = parseInt(clean.slice(i, i + 2), 16)

    if (opcode >= 0x60 && opcode <= 0x7f) {
      const byteCount = opcode - 0x5f
      const dataStart = i + 2
      const dataEnd = dataStart + byteCount * 2
      instructions.push({
        offset,
        opcode,
        name: `PUSH${byteCount}`,
        pushData: clean.slice(dataStart, dataEnd),
        invalid: dataEnd > clean.length,
      })
      i = dataEnd - 2
      continue
    }

    if (opcode >= 0x80 && opcode <= 0x8f) {
      instructions.push({ offset, opcode, name: `DUP${opcode - 0x7f}`, pushData: null, invalid: false })
      continue
    }

    if (opcode >= 0x90 && opcode <= 0x9f) {
      instructions.push({ offset, opcode, name: `SWAP${opcode - 0x8f}`, pushData: null, invalid: false })
      continue
    }

    if (opcode >= 0xa0 && opcode <= 0xa4) {
      instructions.push({ offset, opcode, name: `LOG${opcode - 0xa0}`, pushData: null, invalid: false })
      continue
    }

    const name = EVM_OPCODE_NAMES[opcode]
    instructions.push({
      offset,
      opcode,
      name: name || 'INVALID',
      pushData: null,
      invalid: !name || opcode === 0xfe,
    })
  }

  return instructions
}

export function formatEvmDisassembly(hex: string): string {
  return disassembleEvmBytecode(hex).map((instruction) => {
    const offset = instruction.offset.toString(16).padStart(4, '0')
    const opcode = instruction.opcode.toString(16).padStart(2, '0')
    const raw = instruction.pushData
      ? `${opcode} ${instruction.pushData.match(/.{1,2}/g)?.join(' ') || ''}`
      : opcode
    const op = instruction.pushData
      ? `${instruction.name} 0x${instruction.pushData}`
      : instruction.name
    const suffix = instruction.invalid ? ' ; invalid/truncated' : ''
    return `${offset}  ${raw.padEnd(18, ' ')} ${op}${suffix}`
  }).join('\n')
}

function bytesToHex(data: Uint8Array): string {
  return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('')
}

function cleanHex(hex: string): string {
  return hex.replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase()
}

function parseHexEncodedBytecode(text: string): Uint8Array | null {
  const clean = cleanHex(text)
  if (clean.length < 16 || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    return null
  }

  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function isLikelyEvmBytecode(data: Uint8Array): boolean {
  if (data.length < 8) return false

  const hex = bytesToHex(data)
  const instructions = disassembleEvmBytecode(hex)
  if (!instructions.length) return false

  const invalidCount = instructions.filter(instruction => instruction.invalid).length
  if (invalidCount > 2 || invalidCount / instructions.length > 0.05) return false

  const names = new Set(instructions.map(instruction => instruction.name))
  const pushCount = instructions.filter(instruction => /^PUSH\d+$/.test(instruction.name)).length
  const dupOrSwapCount = instructions.filter(instruction => /^DUP\d+$|^SWAP\d+$/.test(instruction.name)).length

  let score = 0
  const firstOpcode = data[0]!
  if ((firstOpcode >= 0x60 && firstOpcode <= 0x7f) || firstOpcode === 0x5f) score += 2
  if (names.has('CODECOPY')) score += 2
  if (names.has('RETURN') || names.has('REVERT') || names.has('STOP') || names.has('SELFDESTRUCT')) score += 2
  if (names.has('MSTORE') || names.has('MSTORE8') || names.has('MLOAD') || names.has('CALLDATALOAD') || names.has('CALLDATASIZE') || names.has('CALLDATACOPY')) score += 1
  if (names.has('JUMP') || names.has('JUMPI') || names.has('JUMPDEST')) score += 1
  if (dupOrSwapCount > 0) score += 1
  if (pushCount / instructions.length >= 0.2) score += 1
  if (hex.startsWith('6080604052') || hex.startsWith('6060604052')) score += 3

  return score >= 4
}
