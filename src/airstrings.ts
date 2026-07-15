import { AirStringsConfig } from './airstrings-config'
import { AirStringsError, airStringsError } from './airstrings-error'
import { Emitter } from './events/emitter'
import { parseBundle, StringBundle, StringEntry } from './models/string-bundle'
import { BundleFetcher } from './networking/bundle-fetcher'
import { verifyBundle, verifyExperiments } from './security/bundle-verifier'
import { selectVariant } from './security/experiment-selection'
import { BundleStore, createBundleStore } from './storage/bundle-store'
import { Logger, noopLogger } from './types'
import IntlMessageFormat from 'intl-messageformat'

const DEFAULT_CDN_URL = 'https://cdn.airstrings.com'
const DEFAULT_API_URL = 'https://api.airstrings.com'

export interface ExposureEvent {
  key: string
  experimentId: string
  variant: string
  locale: string
  assignmentId: string
}

export interface AirStringsEvents {
  'strings:updated': { locale: string; revision: number }
  'strings:error': { error: AirStringsError }
  'experiment:exposure': ExposureEvent
}

interface AppStateSubscriptionLike {
  remove(): void
}

interface AppStateLike {
  addEventListener(type: 'change', handler: (state: string) => void): AppStateSubscriptionLike
}

function loadAppState(): AppStateLike | null {
  if (typeof require !== 'function') return null
  try {
    const mod: unknown = require('react-native')
    if (typeof mod !== 'object' || mod === null) return null
    const appState = (mod as Record<string, unknown>)['AppState']
    if (
      typeof appState === 'object' &&
      appState !== null &&
      typeof (appState as Record<string, unknown>)['addEventListener'] === 'function'
    ) {
      return appState as AppStateLike
    }
    return null
  } catch {
    return null
  }
}

function hasExperiments(bundle: StringBundle): boolean {
  for (const key of Object.keys(bundle.strings)) {
    if (bundle.strings[key]!.experiment !== undefined) return true
  }
  return false
}

function sameOverrides(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function exposureDedupeKey(event: ExposureEvent): string {
  return event.key + '\n' + event.experimentId + '\n' + event.variant + '\n' + event.assignmentId
}

export class AirStrings {
  private readonly config: AirStringsConfig
  private fetcher: BundleFetcher | null = null
  private readonly store: BundleStore
  private readonly logger: Logger
  private readonly emitter = new Emitter<AirStringsEvents>()

  private cachedETags = new Map<string, string>()
  private currentStrings: Readonly<Record<string, string>> = Object.freeze({})
  private currentEntries: Readonly<Record<string, StringEntry>> = Object.freeze({})
  private currentRevision = 0
  private currentLocale: string
  private ready = false
  private foregroundCleanup: (() => void) | null = null
  private readonly initPromise: Promise<void>

  private assignmentId: string | null = null
  private experimentsTrusted = false
  private variantOverrides: Record<string, string> = {}
  private pendingExposures = new Map<string, ExposureEvent>()
  private firedExposures = new Set<string>()

  constructor(config: AirStringsConfig) {
    this.config = config
    this.logger = config.logger ?? noopLogger
    this.currentLocale = config.locale
    this.store = createBundleStore(config.store)

    this.initPromise = this.init().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger('error', `Initialization failed: ${err.message}`, { stack: err.stack })
    })

    this.observeForeground()
  }

  private async init(): Promise<void> {
    await this.loadCachedBundle()
    const seeding = this.seedLocale(this.currentLocale)
    const cdnUrl = await this.bootstrap()
    await seeding
    this.fetcher = new BundleFetcher(cdnUrl)
    await this.refresh()
  }

  async whenReady(): Promise<void> {
    await this.initPromise
  }

  t(key: string): string {
    this.drainExposures(key)
    return this.variantOverrides[key] ?? this.currentStrings[key] ?? key
  }

  format(key: string, args: Record<string, unknown> = {}): string {
    const entry = this.currentEntries[key]
    if (!entry) return key

    this.drainExposures(key)
    const value = this.variantOverrides[key] ?? entry.value

    if (entry.format === 'text') return value

    try {
      const msg = new IntlMessageFormat(value, this.currentLocale)
      return msg.format(args) as string
    } catch {
      return value
    }
  }

  get strings(): Readonly<Record<string, string>> {
    return this.currentStrings
  }

  get locale(): string {
    return this.currentLocale
  }

  get revision(): number {
    return this.currentRevision
  }

  get isReady(): boolean {
    return this.ready
  }

  on<K extends keyof AirStringsEvents>(
    event: K,
    handler: (data: AirStringsEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, handler)
  }

  /**
   * Subscribe to experiment exposure events. The handler fires at most once
   * per unique `(key, experimentId, variant, assignmentId)` for the lifetime
   * of this instance — repeated reads, including a user re-entering the same
   * screen, do not fire it again. It resets only on a new instance (app
   * relaunch) or a changed assignment id. This is *exposure* (attribute a user
   * to a variant once per session — join to conversions on `assignmentId`),
   * not impressions; for per-render counts, emit your own event on view
   * mount/appear. Returns an unsubscribe function.
   */
  onExposure(handler: (event: ExposureEvent) => void): () => void {
    return this.on('experiment:exposure', handler)
  }

  setAssignmentId(id: string | null): void {
    this.assignmentId = id
    if (this.recomputeVariants()) {
      this.emitter.emit('strings:updated', { locale: this.currentLocale, revision: this.currentRevision })
    }
  }

  async setLocale(bcp47: string): Promise<void> {
    this.currentLocale = bcp47

    const cached = await this.store.load(this.config.projectId, this.config.environmentId, bcp47)
    if (cached) {
      const bundle = parseBundle(cached.json)
      if (bundle) {
        const error = await verifyBundle(bundle, this.config.publicKeys)
        if (error) {
          this.logger('error', `Cached bundle verification failed for ${bcp47}`, { code: error.code })
          await this.store.delete(this.config.projectId, this.config.environmentId, bcp47)
          this.clearStrings()
        } else {
          const trusted = await this.computeTrust(bundle)
          this.applyBundle(bundle, trusted)
          this.cachedETags.set(bcp47, cached.etag ?? '')
        }
      }
    } else {
      this.clearStrings()
    }

    await this.seedLocale(bcp47)
    await this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.fetcher) {
      if (this.initPromise) await this.initPromise
      if (!this.fetcher) return
    }

    const fetcher = this.fetcher
    const locale = this.currentLocale

    try {
      const result = await fetcher.fetch(
        this.config.organizationId,
        this.config.projectId,
        this.config.environmentId,
        locale,
        this.cachedETags.get(locale) ?? null,
        this.logger,
      )

      if (result.status === 'not_modified') {
        this.logger('info', `Bundle up to date: ${locale}`)
        if (!this.ready) this.ready = true
        return
      }

      if (!result.json) return

      const bundle = parseBundle(result.json)
      if (!bundle) {
        this.emitter.emit('strings:error', {
          error: airStringsError('BUNDLE_DECODE_FAILED', 'Failed to parse bundle JSON'),
        })
        return
      }

      const verifyError = await verifyBundle(bundle, this.config.publicKeys)
      if (verifyError) {
        this.logger('error', 'Signature verification failed', { code: verifyError.code })
        this.emitter.emit('strings:error', { error: verifyError })
        return
      }

      if (bundle.locale === this.currentLocale && bundle.revision < this.currentRevision) {
        this.logger('warn', `Ignoring stale bundle: rev ${bundle.revision} < current ${this.currentRevision}`)
        return
      }

      await this.store.save(this.config.projectId, this.config.environmentId, locale, {
        json: result.json,
        etag: result.etag ?? null,
      })
      this.cachedETags.set(locale, result.etag ?? '')

      if (locale === this.currentLocale) {
        const trusted = await this.computeTrust(bundle)
        this.applyBundle(bundle, trusted)
        this.ready = true
        this.emitter.emit('strings:updated', { locale, revision: bundle.revision })
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger('error', `Refresh failed for ${locale}: ${err.message}`, { stack: err.stack })
      if (!this.ready) {
        const cached = await this.store.load(this.config.projectId, this.config.environmentId, locale)
        if (cached) {
          this.ready = true
        }
      }
    }
  }

  destroy(): void {
    if (this.foregroundCleanup) {
      this.foregroundCleanup()
      this.foregroundCleanup = null
    }
  }

  private async bootstrap(): Promise<string> {
    const apiBase = (this.config.apiBaseURL ?? DEFAULT_API_URL).replace(/\/$/, '')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(`${apiBase}/v1/sdk/bootstrap`, { signal: controller.signal })
      if (!res.ok) {
        this.logger('warn', `Bootstrap returned non-OK status ${res.status}, using default CDN`)
        return DEFAULT_CDN_URL
      }
      const json = await res.json() as { cdn_base_url?: string }
      return json.cdn_base_url ?? DEFAULT_CDN_URL
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger('error', `Bootstrap failed: ${err.message}`, { stack: err.stack })
      return DEFAULT_CDN_URL
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async loadCachedBundle(): Promise<void> {
    const cached = await this.store.load(this.config.projectId, this.config.environmentId, this.currentLocale)
    if (!cached) return

    const bundle = parseBundle(cached.json)
    if (!bundle) {
      await this.store.delete(this.config.projectId, this.config.environmentId, this.currentLocale)
      return
    }

    const error = await verifyBundle(bundle, this.config.publicKeys)
    if (error) {
      this.logger('error', 'Cached bundle verification failed, clearing cache')
      await this.store.delete(this.config.projectId, this.config.environmentId, this.currentLocale)
      return
    }

    const trusted = await this.computeTrust(bundle)
    this.applyBundle(bundle, trusted)
    this.ready = true
    this.cachedETags.set(this.currentLocale, cached.etag ?? '')
  }

  private async seedLocale(locale: string): Promise<void> {
    try {
      await this.runSeed(locale)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger('error', `Seeding failed for ${locale}: ${err.message}`, { stack: err.stack })
    }
  }

  private async runSeed(locale: string): Promise<void> {
    const { seed } = this.config
    if (!seed || seed.length === 0) return

    let best: { bundle: StringBundle; json: string } | null = null

    for (const entry of seed) {
      const json = typeof entry === 'string' ? entry : JSON.stringify(entry)
      const bundle = parseBundle(json)
      if (!bundle) {
        this.rejectSeed(locale, airStringsError('BUNDLE_DECODE_FAILED', 'Failed to parse seed bundle JSON'))
        continue
      }
      if (bundle.locale !== locale) continue

      const verifyError = await verifyBundle(bundle, this.config.publicKeys)
      if (verifyError) {
        this.rejectSeed(locale, verifyError)
        continue
      }
      if (bundle.project_id !== this.config.projectId) {
        this.rejectSeed(locale, airStringsError(
          'SEED_PROJECT_MISMATCH',
          `Seed bundle project_id ${bundle.project_id} does not match configured projectId`,
        ))
        continue
      }
      if (!best || bundle.revision > best.bundle.revision) {
        best = { bundle, json }
      }
    }

    if (!best) return
    if (best.bundle.revision <= this.currentRevision) return

    await this.store.save(this.config.projectId, this.config.environmentId, locale, {
      json: best.json,
      etag: null,
    })
    this.cachedETags.delete(locale)

    if (locale === this.currentLocale) {
      const trusted = await this.computeTrust(best.bundle)
      this.applyBundle(best.bundle, trusted)
      this.ready = true
      this.emitter.emit('strings:updated', { locale, revision: best.bundle.revision })
    }
  }

  private rejectSeed(locale: string, error: AirStringsError): void {
    this.logger('error', `Seed bundle rejected for ${locale}`, { code: error.code })
    this.emitter.emit('strings:error', { error })
  }

  private async computeTrust(bundle: StringBundle): Promise<boolean> {
    if (!hasExperiments(bundle)) return false
    return verifyExperiments(bundle, this.config.publicKeys)
  }

  private applyBundle(bundle: StringBundle, experimentsTrusted: boolean): void {
    this.experimentsTrusted = experimentsTrusted
    this.currentEntries = Object.freeze({ ...bundle.strings })
    const values: Record<string, string> = {}
    for (const key of Object.keys(bundle.strings)) {
      values[key] = bundle.strings[key]!.value
    }
    this.currentStrings = Object.freeze(values)
    this.currentRevision = bundle.revision
    this.recomputeVariants()
  }

  private recomputeVariants(): boolean {
    const previous = this.variantOverrides
    const next: Record<string, string> = {}
    this.pendingExposures.clear()

    if (this.experimentsTrusted && this.assignmentId !== null) {
      const assignmentId = this.assignmentId
      for (const key of Object.keys(this.currentEntries)) {
        const entry = this.currentEntries[key]!
        if (!entry.experiment) continue
        const selection = selectVariant(entry, assignmentId)
        if (!selection) continue
        next[key] = selection.value
        const event: ExposureEvent = {
          key,
          experimentId: entry.experiment.id,
          variant: selection.variant,
          locale: this.currentLocale,
          assignmentId,
        }
        const dedupeKey = exposureDedupeKey(event)
        if (!this.firedExposures.has(dedupeKey)) {
          this.pendingExposures.set(dedupeKey, event)
        }
      }
    }

    this.variantOverrides = next
    return !sameOverrides(previous, next)
  }

  private drainExposures(key: string): void {
    if (this.pendingExposures.size === 0) return
    for (const [dedupeKey, event] of this.pendingExposures) {
      if (event.key !== key) continue
      this.pendingExposures.delete(dedupeKey)
      this.firedExposures.add(dedupeKey)
      queueMicrotask(() => this.emitter.emit('experiment:exposure', event))
    }
  }

  private clearStrings(): void {
    this.currentStrings = Object.freeze({})
    this.currentEntries = Object.freeze({})
    this.currentRevision = 0
    this.experimentsTrusted = false
    this.variantOverrides = {}
    this.pendingExposures.clear()
    this.firedExposures.clear()
  }

  private observeForeground(): void {
    const appState = loadAppState()
    if (!appState) return

    const subscription = appState.addEventListener('change', (state) => {
      if (state === 'active') {
        this.refresh()
      }
    })
    this.foregroundCleanup = () => {
      subscription.remove()
    }
  }
}
