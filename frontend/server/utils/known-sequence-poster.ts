import { createHash } from 'node:crypto'

// Exact on-chain SVGs audited and rendered offline. Never parse new SVG artwork
// on the server; changed content receives the neutral fallback instead.
const posters: Record<string, string> = {
  'cf54438fc49cbcefaf0f29fdfaddf71a3b2ce553b75100abccc1a1ebc005815a': 'sequence-5-poster.png',
  '88d82fc0c391ddbac8978b03bf68cbb5f20ac8d63363f944da2400df0a8f4949': 'sequence-7-poster.png',
  '86a3abb6acf659bd8b4000b6d711fa515369071112626a14e110c8806bc797d0': 'sequence-8-poster.png',
}

export function knownSequencePoster(bytes: Uint8Array): string | undefined {
  return posters[createHash('sha256').update(bytes).digest('hex')]
}
