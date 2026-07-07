import { AsyncStorageLike, AsyncStorageStore } from './async-storage-store'
import { MemoryStore } from './memory-store'

export interface StoredBundle {
  readonly json: string
  readonly etag: string | null
}

export interface BundleStore {
  load(projectId: string, environmentId: string, locale: string): Promise<StoredBundle | null>
  save(projectId: string, environmentId: string, locale: string, bundle: StoredBundle): Promise<void>
  delete(projectId: string, environmentId: string, locale: string): Promise<void>
}

export function createBundleStore(custom?: BundleStore): BundleStore {
  if (custom) return custom
  const storage = loadDefaultAsyncStorage()
  if (storage) return new AsyncStorageStore(storage)
  return new MemoryStore()
}

function isAsyncStorageLike(v: unknown): v is AsyncStorageLike {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj['getItem'] === 'function' &&
    typeof obj['setItem'] === 'function' &&
    typeof obj['removeItem'] === 'function'
  )
}

function loadDefaultAsyncStorage(): AsyncStorageLike | null {
  if (typeof require !== 'function') return null
  try {
    const mod: unknown = require('@react-native-async-storage/async-storage')
    if (typeof mod !== 'object' || mod === null) return null
    const viaDefault = (mod as Record<string, unknown>)['default']
    if (isAsyncStorageLike(viaDefault)) return viaDefault
    if (isAsyncStorageLike(mod)) return mod
    return null
  } catch {
    return null
  }
}
