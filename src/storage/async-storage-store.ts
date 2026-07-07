import { BundleStore, StoredBundle } from './bundle-store'

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export class AsyncStorageStore implements BundleStore {
  private readonly storage: AsyncStorageLike

  constructor(storage: AsyncStorageLike) {
    this.storage = storage
  }

  private key(projectId: string, environmentId: string, locale: string): string {
    return `airstrings:${projectId}:${environmentId}:${locale}`
  }

  async load(projectId: string, environmentId: string, locale: string): Promise<StoredBundle | null> {
    const raw = await this.storage.getItem(this.key(projectId, environmentId, locale))
    if (raw === null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return null
      const obj = parsed as Record<string, unknown>
      if (typeof obj['json'] !== 'string') return null
      return {
        json: obj['json'],
        etag: typeof obj['etag'] === 'string' ? obj['etag'] : null,
      }
    } catch {
      return null
    }
  }

  async save(projectId: string, environmentId: string, locale: string, bundle: StoredBundle): Promise<void> {
    await this.storage.setItem(
      this.key(projectId, environmentId, locale),
      JSON.stringify({ json: bundle.json, etag: bundle.etag }),
    )
  }

  async delete(projectId: string, environmentId: string, locale: string): Promise<void> {
    await this.storage.removeItem(this.key(projectId, environmentId, locale))
  }
}
