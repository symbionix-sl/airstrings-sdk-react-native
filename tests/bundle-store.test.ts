import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/storage/memory-store'
import { AsyncStorageLike, AsyncStorageStore } from '../src/storage/async-storage-store'
import { BundleStore, createBundleStore } from '../src/storage/bundle-store'

class FakeAsyncStorage implements AsyncStorageLike {
  readonly data = new Map<string, string>()

  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key)
  }
}

const implementations: [string, () => BundleStore][] = [
  ['MemoryStore', () => new MemoryStore()],
  ['AsyncStorageStore', () => new AsyncStorageStore(new FakeAsyncStorage())],
]

describe.each(implementations)('BundleStore (%s)', (_name, makeStore) => {
  it('save and load round-trip', async () => {
    const store = makeStore()
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{"format_version":1,"strings":{}}',
      etag: '"rev:42"',
    })

    const loaded = await store.load('proj_test12345678', 'env_test12345678', 'en')
    expect(loaded).not.toBeNull()
    expect(loaded!.json).toBe('{"format_version":1,"strings":{}}')
    expect(loaded!.etag).toBe('"rev:42"')
  })

  it('returns null when empty', async () => {
    const store = makeStore()
    const loaded = await store.load('proj_nonexistent', 'env_test12345678', 'en')
    expect(loaded).toBeNull()
  })

  it('isolates per locale', async () => {
    const store = makeStore()
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{"locale":"en"}',
      etag: '"en:1"',
    })
    await store.save('proj_test12345678', 'env_test12345678', 'fr', {
      json: '{"locale":"fr"}',
      etag: '"fr:1"',
    })

    const enLoaded = await store.load('proj_test12345678', 'env_test12345678', 'en')
    const frLoaded = await store.load('proj_test12345678', 'env_test12345678', 'fr')

    expect(enLoaded!.json).toBe('{"locale":"en"}')
    expect(frLoaded!.json).toBe('{"locale":"fr"}')
    expect(enLoaded!.etag).toBe('"en:1"')
    expect(frLoaded!.etag).toBe('"fr:1"')
  })

  it('delete removes cache', async () => {
    const store = makeStore()
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{"test":true}',
      etag: null,
    })
    expect(await store.load('proj_test12345678', 'env_test12345678', 'en')).not.toBeNull()

    await store.delete('proj_test12345678', 'env_test12345678', 'en')
    expect(await store.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
  })

  it('stores with null etag', async () => {
    const store = makeStore()
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{"test":true}',
      etag: null,
    })

    const loaded = await store.load('proj_test12345678', 'env_test12345678', 'en')
    expect(loaded).not.toBeNull()
    expect(loaded!.json).toBe('{"test":true}')
    expect(loaded!.etag).toBeNull()
  })

  it('overwrites existing cache', async () => {
    const store = makeStore()
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{"revision":1}',
      etag: '"v1"',
    })
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{"revision":2}',
      etag: '"v2"',
    })

    const loaded = await store.load('proj_test12345678', 'env_test12345678', 'en')
    expect(loaded!.json).toBe('{"revision":2}')
    expect(loaded!.etag).toBe('"v2"')
  })

  it('isolates per project', async () => {
    const store = makeStore()
    await store.save('proj_aaa', 'env_test12345678', 'en', {
      json: '{"project":"aaa"}',
      etag: null,
    })
    await store.save('proj_bbb', 'env_test12345678', 'en', {
      json: '{"project":"bbb"}',
      etag: null,
    })

    const aaa = await store.load('proj_aaa', 'env_test12345678', 'en')
    const bbb = await store.load('proj_bbb', 'env_test12345678', 'en')

    expect(aaa!.json).toBe('{"project":"aaa"}')
    expect(bbb!.json).toBe('{"project":"bbb"}')
  })

  it('isolates per environment', async () => {
    const store = makeStore()
    await store.save('proj_test12345678', 'env_production0', 'en', {
      json: '{"env":"prod"}',
      etag: null,
    })
    await store.save('proj_test12345678', 'env_staging00000', 'en', {
      json: '{"env":"staging"}',
      etag: null,
    })

    const prod = await store.load('proj_test12345678', 'env_production0', 'en')
    const staging = await store.load('proj_test12345678', 'env_staging00000', 'en')

    expect(prod!.json).toBe('{"env":"prod"}')
    expect(staging!.json).toBe('{"env":"staging"}')
  })
})

describe('AsyncStorageStore', () => {
  it('namespaces keys with an airstrings prefix', async () => {
    const fake = new FakeAsyncStorage()
    const store = new AsyncStorageStore(fake)
    await store.save('proj_test12345678', 'env_test12345678', 'en', {
      json: '{}',
      etag: null,
    })

    expect([...fake.data.keys()]).toEqual(['airstrings:proj_test12345678:env_test12345678:en'])
  })

  it('degrades gracefully on corrupted stored JSON', async () => {
    const fake = new FakeAsyncStorage()
    await fake.setItem('airstrings:proj_test12345678:env_test12345678:en', 'not json {{{')

    const store = new AsyncStorageStore(fake)
    expect(await store.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
  })

  it('degrades gracefully when stored value has the wrong shape', async () => {
    const fake = new FakeAsyncStorage()
    await fake.setItem('airstrings:proj_test12345678:env_test12345678:en', '{"etag":"x"}')
    await fake.setItem('airstrings:proj_test12345678:env_test12345678:fr', '"just a string"')

    const store = new AsyncStorageStore(fake)
    expect(await store.load('proj_test12345678', 'env_test12345678', 'en')).toBeNull()
    expect(await store.load('proj_test12345678', 'env_test12345678', 'fr')).toBeNull()
  })

  it('normalizes a non-string etag to null', async () => {
    const fake = new FakeAsyncStorage()
    await fake.setItem(
      'airstrings:proj_test12345678:env_test12345678:en',
      '{"json":"{}","etag":42}',
    )

    const store = new AsyncStorageStore(fake)
    const loaded = await store.load('proj_test12345678', 'env_test12345678', 'en')
    expect(loaded).not.toBeNull()
    expect(loaded!.etag).toBeNull()
  })
})

describe('createBundleStore', () => {
  it('returns the injected custom store', () => {
    const custom = new MemoryStore()
    expect(createBundleStore(custom)).toBe(custom)
  })

  it('falls back to MemoryStore when AsyncStorage is unavailable', () => {
    expect(createBundleStore()).toBeInstanceOf(MemoryStore)
  })
})
