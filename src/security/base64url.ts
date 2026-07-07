const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const VALUES = new Map<string, number>()
for (let i = 0; i < ALPHABET.length; i++) {
  VALUES.set(ALPHABET[i]!, i)
}

function decodeAlphabet(chars: string): Uint8Array | null {
  if (chars.length % 4 === 1) return null
  const bytes = new Uint8Array(Math.floor((chars.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let index = 0
  for (const ch of chars) {
    const value = VALUES.get(ch)
    if (value === undefined) return null
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (buffer >>> bits) & 0xff
    }
  }
  return bytes
}

export function decode(input: string): Uint8Array | null {
  return decodeAlphabet(input.replace(/-/g, '+').replace(/_/g, '/'))
}

export function decodeBase64(input: string): Uint8Array | null {
  let end = input.length
  while (end > 0 && input[end - 1] === '=') end--
  if (input.length - end > 2) return null
  return decodeAlphabet(input.slice(0, end))
}

export function encode(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : null
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : null
    result += ALPHABET[b0 >> 2]!
    result += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!
    if (b1 !== null) result += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!
    if (b2 !== null) result += ALPHABET[b2 & 0x3f]!
  }
  return result
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
