import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'

ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed.etc.concatBytes(...m))

export function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed.verify(signature, message, publicKey)
  } catch {
    return false
  }
}
