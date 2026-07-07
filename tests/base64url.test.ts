import { describe, it, expect } from 'vitest'
import { encode, decode, decodeBase64 } from '../src/security/base64url'

describe('Base64URL', () => {
  it('decodes valid base64url', () => {
    const decoded = decode('SGVsbG8')
    expect(decoded).not.toBeNull()
    expect(new TextDecoder().decode(decoded!)).toBe('Hello')
  })

  it('decodes URL-safe characters correctly', () => {
    const decoded = decode('a-b_cw')
    expect(decoded).not.toBeNull()
    const standard = Uint8Array.from(atob('a+b/cw=='), c => c.charCodeAt(0))
    expect(decoded).toEqual(standard)
  })

  it('handles missing padding', () => {
    const decoded = decode('YWI')
    expect(decoded).not.toBeNull()
    expect(new TextDecoder().decode(decoded!)).toBe('ab')
  })

  it('round-trips encode then decode', () => {
    const original = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
    const encoded = encode(original)
    const decoded = decode(encoded)
    expect(decoded).toEqual(original)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })

  it('64-byte signature encodes to exactly 86 characters', () => {
    const signatureBytes = new Uint8Array(64).fill(0xab)
    const encoded = encode(signatureBytes)
    expect(encoded.length).toBe(86)
    const decoded = decode(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.length).toBe(64)
    expect(decoded).toEqual(signatureBytes)
  })

  it('decodes empty string', () => {
    const decoded = decode('')
    expect(decoded).not.toBeNull()
    expect(decoded!.length).toBe(0)
  })

  it('returns null for invalid input', () => {
    const decoded = decode('!!!invalid!!!')
    expect(decoded).toBeNull()
  })

  it('matches encode output against btoa for random bytes', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)
    const expected = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(encode(bytes)).toBe(expected)
  })
})

describe('decodeBase64 (standard alphabet)', () => {
  it('decodes standard base64 with padding', () => {
    const decoded = decodeBase64('SGVsbG8=')
    expect(decoded).not.toBeNull()
    expect(new TextDecoder().decode(decoded!)).toBe('Hello')
  })

  it('decodes a 44-character Ed25519 public key encoding to 32 bytes', () => {
    const keyBytes = new Uint8Array(32).fill(0x7f)
    const keyBase64 = btoa(String.fromCharCode(...keyBytes))
    expect(keyBase64.length).toBe(44)
    const decoded = decodeBase64(keyBase64)
    expect(decoded).toEqual(keyBytes)
  })

  it('returns null for url-safe characters', () => {
    expect(decodeBase64('a-b_cw')).toBeNull()
  })

  it('returns null for interior padding', () => {
    expect(decodeBase64('SG=sbG8=')).toBeNull()
  })
})
