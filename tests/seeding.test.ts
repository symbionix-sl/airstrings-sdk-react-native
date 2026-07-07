import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as ed from '@noble/ed25519'
import '../src/security/ed25519'
import { AirStrings } from '../src/airstrings'
import { AirStringsConfig } from '../src/airstrings-config'
import { AirStringsError } from '../src/airstrings-error'
import { signedContent } from '../src/models/canonical-json'
import { encode as base64urlEncode } from '../src/security/base64url'
import { MemoryStore } from '../src/storage/memory-store'
import { StringBundle } from '../src/models/string-bundle'

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

interface Keypair {
  readonly privateKey: Uint8Array
  readonly publicKeyBase64: string
}

function makeKeypair(): Keypair {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = ed.getPublicKey(privateKey)
  return { privateKey, publicKeyBase64: toBase64(publicKey) }
}

function makeSignedBundleJSON(keys: Keypair, overrides?: Partial<StringBundle>): string {
  const bundle: StringBundle = {
    format_version: 1,
    project_id: 'proj_test12345678',
    locale: 'en',
    revision: 1,
    created_at: '2026-02-25T14:30:00Z',
    key_id: keys.publicKeyBase64,
    signature: '',
    strings: {
      greeting: { value: 'Hello!', format: 'text' },
    },
    ...overrides,
  }

  const signatureBytes = ed.sign(signedContent(bundle), keys.privateKey)
  return JSON.stringify({ ...bundle, signature: base64urlEncode(signatureBytes) })
}

function makeConfig(keys: Keypair, overrides?: Partial<AirStringsConfig>): AirStringsConfig {
  return {
    organizationId: 'org_test12345678',
    projectId: 'proj_test12345678',
    environmentId: 'env_test12345678',
    publicKeys: [keys.publicKeyBase64],
    locale: 'en',
    store: new MemoryStore(),
    ...overrides,
  }
}

function collectErrors(airstrings: AirStrings): AirStringsError[] {
  const errors: AirStringsError[] = []
  airstrings.on('strings:error', ({ error }) => errors.push(error))
  return errors
}

describe('bundled fallback seeding', () => {
  let keys: Keypair

  beforeEach(() => {
    keys = makeKeypair()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves seeded strings on offline cold start (parsed object)', async () => {
    const json = makeSignedBundleJSON(keys)
    const airstrings = new AirStrings(makeConfig(keys, { seed: [JSON.parse(json)] }))
    const updates: { locale: string; revision: number }[] = []
    airstrings.on('strings:updated', (data) => updates.push(data))

    await airstrings.whenReady()

    expect(airstrings.t('greeting')).toBe('Hello!')
    expect(airstrings.isReady).toBe(true)
    expect(airstrings.revision).toBe(1)
    expect(updates).toContainEqual({ locale: 'en', revision: 1 })
  })

  it('serves seeded strings on offline cold start (raw JSON string)', async () => {
    const json = makeSignedBundleJSON(keys)
    const airstrings = new AirStrings(makeConfig(keys, { seed: [json] }))

    await airstrings.whenReady()

    expect(airstrings.t('greeting')).toBe('Hello!')
    expect(airstrings.isReady).toBe(true)
  })

  it('persists the winning seed to the cache', async () => {
    const json = makeSignedBundleJSON(keys)
    const config = makeConfig(keys, { seed: [json] })
    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    const stored = await config.store!.load('proj_test12345678', 'env_test12345678', 'en')
    expect(stored).not.toBeNull()
    expect(stored!.json).toBe(json)
    expect(stored!.etag).toBeNull()
  })

  it('rejects a tampered seed, never caches it, and falls back to key names', async () => {
    const json = makeSignedBundleJSON(keys)
    const tampered = JSON.parse(json) as { strings: Record<string, { value: string }> }
    tampered.strings['greeting']!.value = 'Hacked!'

    const config = makeConfig(keys, { seed: [tampered] })
    const airstrings = new AirStrings(config)
    const errors = collectErrors(airstrings)

    await airstrings.whenReady()

    expect(errors.some((e) => e.code === 'SIGNATURE_VERIFICATION_FAILED')).toBe(true)
    expect(airstrings.t('greeting')).toBe('greeting')
    expect(airstrings.revision).toBe(0)
    expect(await config.store!.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
  })

  it('keeps the cached bundle when the seed has a lower revision', async () => {
    const cachedJson = makeSignedBundleJSON(keys, {
      revision: 5,
      strings: { greeting: { value: 'Cached', format: 'text' } },
    })
    const seedJson = makeSignedBundleJSON(keys, {
      revision: 3,
      strings: { greeting: { value: 'Seeded', format: 'text' } },
    })

    const config = makeConfig(keys, { seed: [seedJson] })
    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', {
      json: cachedJson,
      etag: '"rev:5"',
    })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.revision).toBe(5)
    expect(airstrings.t('greeting')).toBe('Cached')
    const stored = await config.store!.load('proj_test12345678', 'env_test12345678', 'en')
    expect(stored!.json).toBe(cachedJson)
    expect(stored!.etag).toBe('"rev:5"')
  })

  it('applies and persists the seed when it is newer than the cache', async () => {
    const cachedJson = makeSignedBundleJSON(keys, {
      revision: 1,
      strings: { greeting: { value: 'Cached', format: 'text' } },
    })
    const seedJson = makeSignedBundleJSON(keys, {
      revision: 2,
      strings: { greeting: { value: 'Seeded', format: 'text' } },
    })

    const config = makeConfig(keys, { seed: [seedJson] })
    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', {
      json: cachedJson,
      etag: '"rev:1"',
    })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.revision).toBe(2)
    expect(airstrings.t('greeting')).toBe('Seeded')
    const stored = await config.store!.load('proj_test12345678', 'env_test12345678', 'en')
    expect(stored!.json).toBe(seedJson)
  })

  it('keeps the cached bundle on a revision tie', async () => {
    const cachedJson = makeSignedBundleJSON(keys, {
      revision: 2,
      strings: { greeting: { value: 'Cached', format: 'text' } },
    })
    const seedJson = makeSignedBundleJSON(keys, {
      revision: 2,
      strings: { greeting: { value: 'Seeded', format: 'text' } },
    })

    const config = makeConfig(keys, { seed: [seedJson] })
    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', {
      json: cachedJson,
      etag: '"rev:2"',
    })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.revision).toBe(2)
    expect(airstrings.t('greeting')).toBe('Cached')
    const stored = await config.store!.load('proj_test12345678', 'env_test12345678', 'en')
    expect(stored!.json).toBe(cachedJson)
  })

  it('behaves exactly as before when no seed is configured', async () => {
    const json = makeSignedBundleJSON(keys)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(json, {
        status: 200,
        headers: { ETag: '"rev:1"' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const logger = vi.fn()
    const airstrings = new AirStrings(makeConfig(keys, { logger }))
    const errors = collectErrors(airstrings)

    await airstrings.whenReady()

    expect(airstrings.t('greeting')).toBe('Hello!')
    expect(airstrings.revision).toBe(1)
    expect(errors).toEqual([])
    expect(logger.mock.calls.filter((c) => c[0] === 'error' || c[0] === 'warn')).toEqual([])
  })

  it('rejects a seed with a mismatched project_id', async () => {
    const json = makeSignedBundleJSON(keys, { project_id: 'proj_otherproj123' })

    const config = makeConfig(keys, { seed: [json] })
    const airstrings = new AirStrings(config)
    const errors = collectErrors(airstrings)

    await airstrings.whenReady()

    expect(errors.some((e) => e.code === 'SEED_PROJECT_MISMATCH')).toBe(true)
    expect(airstrings.t('greeting')).toBe('greeting')
    expect(await config.store!.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
  })

  it('never serves or caches a seed for a locale other than the requested one', async () => {
    const jaJson = makeSignedBundleJSON(keys, {
      locale: 'ja',
      strings: { greeting: { value: 'こんにちは', format: 'text' } },
    })

    const config = makeConfig(keys, { seed: [jaJson] })
    const airstrings = new AirStrings(config)
    const updates: { locale: string; revision: number }[] = []
    airstrings.on('strings:updated', (data) => updates.push(data))

    await airstrings.whenReady()

    expect(airstrings.t('greeting')).toBe('greeting')
    expect(airstrings.revision).toBe(0)
    expect(updates).toEqual([])
    expect(await config.store!.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
    expect(await config.store!.load('proj_test12345678', 'env_test12345678', 'ja')).toBeNull()
  })

  it('rejects an unparseable seed entry with an error', async () => {
    const config = makeConfig(keys, { seed: ['not json {{{'] })
    const airstrings = new AirStrings(config)
    const errors = collectErrors(airstrings)

    await airstrings.whenReady()

    expect(errors.some((e) => e.code === 'BUNDLE_DECODE_FAILED')).toBe(true)
    expect(await config.store!.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
  })

  it('lets a newer fetched bundle win over the seed', async () => {
    const seedJson = makeSignedBundleJSON(keys, {
      revision: 1,
      strings: { greeting: { value: 'Seeded', format: 'text' } },
    })
    const fetchedJson = makeSignedBundleJSON(keys, {
      revision: 2,
      strings: { greeting: { value: 'Fetched', format: 'text' } },
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(fetchedJson, {
        status: 200,
        headers: { ETag: '"rev:2"' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const airstrings = new AirStrings(makeConfig(keys, { seed: [seedJson] }))
    await airstrings.whenReady()

    expect(airstrings.revision).toBe(2)
    expect(airstrings.t('greeting')).toBe('Fetched')
  })

  it('ignores a fetched bundle older than the seed', async () => {
    const seedJson = makeSignedBundleJSON(keys, {
      revision: 5,
      strings: { greeting: { value: 'Seeded', format: 'text' } },
    })
    const fetchedJson = makeSignedBundleJSON(keys, {
      revision: 3,
      strings: { greeting: { value: 'Fetched', format: 'text' } },
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(fetchedJson, {
        status: 200,
        headers: { ETag: '"rev:3"' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const config = makeConfig(keys, { seed: [seedJson] })
    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.revision).toBe(5)
    expect(airstrings.t('greeting')).toBe('Seeded')
    const stored = await config.store!.load('proj_test12345678', 'env_test12345678', 'en')
    expect(stored!.json).toBe(seedJson)
  })

  it('seeds the new locale on setLocale', async () => {
    const enJson = makeSignedBundleJSON(keys)
    const jaJson = makeSignedBundleJSON(keys, {
      locale: 'ja',
      strings: { greeting: { value: 'こんにちは', format: 'text' } },
    })

    const airstrings = new AirStrings(makeConfig(keys, { seed: [enJson, jaJson] }))
    const errors = collectErrors(airstrings)
    await airstrings.whenReady()

    expect(airstrings.t('greeting')).toBe('Hello!')

    await airstrings.setLocale('ja')

    expect(airstrings.locale).toBe('ja')
    expect(airstrings.t('greeting')).toBe('こんにちは')
    expect(errors).toEqual([])
  })
})
