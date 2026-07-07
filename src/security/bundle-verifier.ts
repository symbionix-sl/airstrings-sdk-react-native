import { StringBundle } from '../models/string-bundle'
import { signedContent } from '../models/canonical-json'
import { decode as base64urlDecode, decodeBase64 } from './base64url'
import { verifySignature } from './ed25519'
import { AirStringsError, airStringsError } from '../airstrings-error'

export async function verifyBundle(
  bundle: StringBundle,
  publicKeys: readonly string[],
): Promise<AirStringsError | null> {
  if (!publicKeys.includes(bundle.key_id)) {
    return airStringsError('UNKNOWN_KEY_ID', `Unknown key_id: ${bundle.key_id}`)
  }

  const keyData = decodeBase64(bundle.key_id)
  if (!keyData) {
    return airStringsError('INVALID_KEY_ID_ENCODING', `key_id is not valid base64: ${bundle.key_id}`)
  }
  if (keyData.length !== 32) {
    return airStringsError('INVALID_KEY_ID_ENCODING', `key_id must decode to 32 bytes, got ${keyData.length}: ${bundle.key_id}`)
  }

  const signatureBytes = base64urlDecode(bundle.signature)
  if (!signatureBytes || signatureBytes.length !== 64) {
    return airStringsError('INVALID_SIGNATURE_ENCODING', 'Signature must decode to exactly 64 bytes')
  }

  const canonicalBytes = signedContent(bundle)
  const valid = verifySignature(signatureBytes, canonicalBytes, keyData)
  if (!valid) {
    return airStringsError('SIGNATURE_VERIFICATION_FAILED', 'Ed25519 signature verification failed')
  }

  if (bundle.format_version !== 1) {
    return airStringsError('UNSUPPORTED_FORMAT_VERSION', `Unsupported format_version: ${bundle.format_version}`)
  }

  return null
}
