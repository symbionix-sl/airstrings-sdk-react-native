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

function makeConfig(overrides?: Partial<AirStringsConfig>): AirStringsConfig {
  return {
    organizationId: 'org_test12345678',
    projectId: 'proj_test12345678',
    environmentId: 'env_test12345678',
    publicKeys: [],
    locale: 'en',
    store: new MemoryStore(),
    ...overrides,
  }
}

function makeSignedBundleJSON(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  overrides?: Partial<StringBundle>,
): { json: string; config: AirStringsConfig } {
  const publicKeyBase64 = toBase64(publicKey)

  const bundle: StringBundle = {
    format_version: 1,
    project_id: 'proj_test12345678',
    locale: 'en',
    revision: 1,
    created_at: '2026-02-25T14:30:00Z',
    key_id: publicKeyBase64,
    signature: '',
    strings: {
      greeting: { value: 'Hello!', format: 'text' },
      farewell: { value: 'Goodbye!', format: 'text' },
    },
    ...overrides,
  }

  const canonicalBytes = signedContent(bundle)
  const signatureBytes = ed.sign(canonicalBytes, privateKey)
  const signatureBase64url = base64urlEncode(signatureBytes)

  const signed = { ...bundle, signature: signatureBase64url }
  const store = new MemoryStore()
  const config = makeConfig({
    publicKeys: [publicKeyBase64],
    store,
  })

  return { json: JSON.stringify(signed), config }
}

describe('AirStrings', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('t() returns key name as fallback when no strings loaded', () => {
    const airstrings = new AirStrings(makeConfig())
    expect(airstrings.t('nonexistent.key')).toBe('nonexistent.key')
    expect(airstrings.t('onboarding.title')).toBe('onboarding.title')
  })

  it('initial state has correct defaults', () => {
    const airstrings = new AirStrings(makeConfig({ locale: 'en' }))
    expect(airstrings.locale).toBe('en')
    expect(airstrings.revision).toBe(0)
    expect(airstrings.strings).toEqual({})
  })

  it('uses configured locale', () => {
    const airstrings = new AirStrings(makeConfig({ locale: 'it' }))
    expect(airstrings.locale).toBe('it')
  })

  it('serves strings from cache on init', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json, config } = makeSignedBundleJSON(privateKey, publicKey)

    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', {
      json,
      etag: '"rev:1"',
    })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.t('greeting')).toBe('Hello!')
    expect(airstrings.t('farewell')).toBe('Goodbye!')
    expect(airstrings.isReady).toBe(true)
  })

  it('emits strings:updated on successful refresh', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json } = makeSignedBundleJSON(privateKey, publicKey)

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    fetchMock.mockResolvedValueOnce(new Response(json, {
      status: 200,
      headers: { ETag: '"rev:1"' },
    }))

    const store = new MemoryStore()
    const config = makeConfig({
      publicKeys: [toBase64(publicKey)],
      store,
    })

    const airstrings = new AirStrings(config)
    const updates: { locale: string; revision: number }[] = []
    airstrings.on('strings:updated', (data) => updates.push(data))

    await airstrings.whenReady()

    expect(updates.length).toBeGreaterThanOrEqual(1)
    expect(updates[0]!.locale).toBe('en')
    expect(updates[0]!.revision).toBe(1)
  })

  it('anti-downgrade: ignores stale bundles', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)

    const { json: json5 } = makeSignedBundleJSON(privateKey, publicKey, {
      revision: 5,
    })
    const { json: json3 } = makeSignedBundleJSON(privateKey, publicKey, {
      revision: 3,
    })

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    fetchMock.mockResolvedValueOnce(new Response(json5, {
      status: 200,
      headers: { ETag: '"rev:5"' },
    }))

    const store = new MemoryStore()
    const config = makeConfig({
      publicKeys: [toBase64(publicKey)],
      store,
    })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.revision).toBe(5)

    fetchMock.mockResolvedValueOnce(new Response(json3, {
      status: 200,
      headers: { ETag: '"rev:3"' },
    }))

    await airstrings.refresh()
    expect(airstrings.revision).toBe(5)
  })

  it('rejects a tampered bundle from the network: never served, never cached, error surfaced', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json } = makeSignedBundleJSON(privateKey, publicKey)
    const tampered = JSON.parse(json) as { strings: Record<string, { value: string }> }
    tampered.strings['greeting']!.value = 'Hacked!'

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(tampered), {
      status: 200,
      headers: { ETag: '"rev:1"' },
    }))

    const store = new MemoryStore()
    const config = makeConfig({
      publicKeys: [toBase64(publicKey)],
      store,
    })

    const airstrings = new AirStrings(config)
    const errors: AirStringsError[] = []
    airstrings.on('strings:error', ({ error }) => errors.push(error))

    await airstrings.whenReady()

    expect(errors.some((e) => e.code === 'SIGNATURE_VERIFICATION_FAILED')).toBe(true)
    expect(airstrings.t('greeting')).toBe('greeting')
    expect(airstrings.revision).toBe(0)
    expect(airstrings.isReady).toBe(false)
    expect(await store.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
  })

  it('destroy is safe to call without a foreground listener', () => {
    const airstrings = new AirStrings(makeConfig())
    expect(() => {
      airstrings.destroy()
      airstrings.destroy()
    }).not.toThrow()
  })

  it('strings getter returns raw values (backward compat)', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json, config } = makeSignedBundleJSON(privateKey, publicKey, {
      strings: {
        hello: { value: 'Hello!', format: 'text' },
        count: { value: '{n, plural, one {# item} other {# items}}', format: 'icu' },
      },
    })

    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', { json, etag: null })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.strings['hello']).toBe('Hello!')
    expect(airstrings.strings['count']).toBe('{n, plural, one {# item} other {# items}}')
    expect(airstrings.t('hello')).toBe('Hello!')
    expect(airstrings.t('count')).toBe('{n, plural, one {# item} other {# items}}')
  })

  it('format() returns value as-is for text format', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json, config } = makeSignedBundleJSON(privateKey, publicKey, {
      strings: {
        hello: { value: 'Hello!', format: 'text' },
      },
    })

    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', { json, etag: null })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.format('hello')).toBe('Hello!')
    expect(airstrings.format('hello', { unused: 'arg' })).toBe('Hello!')
  })

  it('format() formats ICU plural patterns', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json, config } = makeSignedBundleJSON(privateKey, publicKey, {
      strings: {
        'items.count': { value: '{count, plural, one {# item} other {# items}}', format: 'icu' },
      },
    })

    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', { json, etag: null })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.format('items.count', { count: 1 })).toBe('1 item')
    expect(airstrings.format('items.count', { count: 5 })).toBe('5 items')
  })

  it('format() formats ICU select patterns', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json, config } = makeSignedBundleJSON(privateKey, publicKey, {
      strings: {
        status: { value: '{status, select, active {Active} inactive {Inactive} other {Unknown}}', format: 'icu' },
      },
    })

    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', { json, etag: null })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.format('status', { status: 'active' })).toBe('Active')
    expect(airstrings.format('status', { status: 'inactive' })).toBe('Inactive')
    expect(airstrings.format('status', { status: 'deleted' })).toBe('Unknown')
  })

  it('format() returns key name for missing key', () => {
    const airstrings = new AirStrings(makeConfig())
    expect(airstrings.format('missing.key', { count: 1 })).toBe('missing.key')
  })

  it('whenReady resolves after init + initial refresh (guards race)', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json } = makeSignedBundleJSON(privateKey, publicKey)

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    fetchMock.mockResolvedValueOnce(new Response(json, {
      status: 200,
      headers: { ETag: '"rev:1"' },
    }))

    const airstrings = new AirStrings(makeConfig({
      publicKeys: [toBase64(publicKey)],
      store: new MemoryStore(),
    }))

    await airstrings.whenReady()

    expect(airstrings.isReady).toBe(true)
    expect(airstrings.t('greeting')).toBe('Hello!')
    expect(airstrings.revision).toBe(1)
  })

  it('logs error when bundle fetch returns 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ cdn_base_url: 'https://cdn.airstrings.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))

    const logger = vi.fn()
    const airstrings = new AirStrings(makeConfig({ logger }))
    await airstrings.whenReady()

    const errorCalls = logger.mock.calls.filter((c) => c[0] === 'error')
    expect(errorCalls.length).toBeGreaterThanOrEqual(1)
    expect(errorCalls.some((c) => /Refresh failed/.test(String(c[1])))).toBe(true)
  })

  it('logs error when bootstrap aborts via timeout', async () => {
    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
      })
    })

    const logger = vi.fn()
    vi.useFakeTimers()
    try {
      const airstrings = new AirStrings(makeConfig({ logger }))
      await vi.advanceTimersByTimeAsync(30000)
      vi.useRealTimers()
      await airstrings.whenReady()

      const errorCalls = logger.mock.calls.filter((c) => c[0] === 'error')
      expect(errorCalls.some((c) => /Bootstrap failed/.test(String(c[1])))).toBe(true)
    } finally {
      if (vi.isFakeTimers()) vi.useRealTimers()
    }
  })

  it('logs error when cached bundle has wrong key_id', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json } = makeSignedBundleJSON(privateKey, publicKey)

    const otherPriv = ed.utils.randomPrivateKey()
    const otherPub = ed.getPublicKey(otherPriv)

    const store = new MemoryStore()
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json,
      etag: '"rev:1"',
    })

    const logger = vi.fn()
    const airstrings = new AirStrings(makeConfig({
      publicKeys: [toBase64(otherPub)],
      store,
      logger,
    }))
    await airstrings.whenReady()

    const errorCalls = logger.mock.calls.filter((c) => c[0] === 'error')
    expect(errorCalls.some((c) => /verification failed/i.test(String(c[1])))).toBe(true)
  })

  it('format() returns raw pattern on formatting failure', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = ed.getPublicKey(privateKey)
    const { json, config } = makeSignedBundleJSON(privateKey, publicKey, {
      strings: {
        bad: { value: '{count, plural, one {# item} other {# items}', format: 'icu' },
      },
    })

    await config.store!.save('proj_test12345678', 'env_test12345678', 'en', { json, etag: null })

    const airstrings = new AirStrings(config)
    await airstrings.whenReady()

    expect(airstrings.format('bad', { count: 1 })).toBe('{count, plural, one {# item} other {# items}')
  })
})
