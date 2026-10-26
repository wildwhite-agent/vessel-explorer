import sharp from 'sharp'

// Never pass active/XML formats to a native decoder or execute artwork scripts.
// HTML/SVG-only images use a neutral static poster until a raster poster exists.
export async function sequencePoster(media: { bytes: Uint8Array; mime: string }, fallback?: Uint8Array): Promise<Buffer> {
  const bytes = Buffer.from(media.bytes)
  const raster = (bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === 'PNG')
    || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || bytes.subarray(0, 6).toString().match(/^GIF8[79]a$/)
    || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
  const blank = () => fallback ? Promise.resolve(Buffer.from(fallback)) : sharp({ create: { width: 1200, height: 630, channels: 3, background: '#171717' } }).png().toBuffer()
  if (!raster) return blank()
  try {
    return await sharp(bytes, { limitInputPixels: 16_000_000, pages: 1, failOn: 'warning' })
      .timeout({ seconds: 3 })
      .autoOrient()
      .resize(1200, 630, { fit: 'contain', background: '#000000' })
      .png().toBuffer()
  } catch {
    return blank()
  }
}
