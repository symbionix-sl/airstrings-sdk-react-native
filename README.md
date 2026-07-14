# @airstrings/react-native

The official **AirStrings React Native SDK** — fetches, verifies, caches, and serves Ed25519-signed localized string bundles from the [AirStrings](https://airstrings.com) CDN.

- **Signed bundles.** Every bundle is verified with Ed25519 before strings are exposed. Tampered or unsigned content is rejected, never served.
- **Cache-first.** Bundles are cached in AsyncStorage and re-verified on every load. Anti-downgrade: a higher-revision bundle is never replaced by a lower one.
- **Offline-safe.** Bundled fallback seeds committed bundles at startup, so a cold offline start serves real strings instead of key names.
- **ICU MessageFormat.** Plurals, selects, number/date formatting via [`intl-messageformat`](https://www.npmjs.com/package/intl-messageformat).

## Install

```bash
npm install @airstrings/react-native @react-native-async-storage/async-storage
```

`@react-native-async-storage/async-storage` is a peer dependency used as the default cache backend. Requires React Native 0.72+.

## Quick start

```ts
import { AirStrings } from '@airstrings/react-native'

const airstrings = new AirStrings({
  organizationId: 'org_xxx',
  projectId: 'proj_xxx',
  environmentId: 'env_xxx',
  publicKeys: ['BASE64_ED25519_PUBLIC_KEY'],
  locale: 'en-US',
  seed: [
    require('./airstrings/bundles/en-US.json'),
    require('./airstrings/bundles/ja.json'),
  ],
})

airstrings.on('strings:updated', ({ locale, revision }) => {
  console.log(`Loaded ${locale} (revision ${revision})`)
})

airstrings.t('greeting')
airstrings.format('items.count', { count: 3 })
```

React integration is a few lines:

```ts
const useStrings = (a: AirStrings) =>
  useSyncExternalStore(
    (cb) => a.on('strings:updated', cb),
    () => a.strings,
  )
```

## Bundled fallback (offline cold start)

1. Pull published bundles: `airstrings bundles pull`
2. Commit the resulting `airstrings/bundles/` directory to your repo.
3. Pass the files via the `seed` option using Metro's `require`, as shown above.

Seed bundles are untrusted input: every candidate runs the full Ed25519 verification pipeline plus `project_id` and locale checks. The highest verified revision wins across cache / seed / network (ties go to the cache), and a winning seed is persisted to the cache. A tampered or wrong-project seed emits `strings:error` and is never served or cached; entries for other locales are skipped silently; a missing seed is a silent no-op. Keep the committed seed fresh by running `airstrings bundles pull` in CI or as a pre-release step.

## String Variants (experiments)

Experiment-backed strings resolve to a variant deterministically from a stable assignment id you supply — no server round-trip, no local state to persist. The same id always maps to the same variant. Experiment definitions are covered by the bundle's Ed25519 signature; if that verification fails, the SDK soft-fails to the base string values (experiment content is never served unverified).

```ts
airstrings.setAssignmentId(userId) // or null to clear

airstrings.onExposure(({ key, experimentId, variant, locale, assignmentId }) => {
  analytics.track('experiment_exposure', { key, experimentId, variant, locale, assignmentId })
})

airstrings.t('cta') // returns the assigned variant's value
```

`t(key)` / `format(key)` return the assigned variant's value; an `experiment:exposure` event fires once per unique `(key, experimentId, variant, assignmentId)` the first time that string is read, so you can forward exposures to your own analytics.

## Caching & offline

- Bundles are cached per `{projectId}:{environmentId}:{locale}` and re-verified on every load.
- Offline: cached (or seeded) strings are served; with no cache and no seed, `t(key)` returns the key name. The SDK never throws and never blocks app startup.
- Conditional requests use ETag / `If-None-Match`, and the SDK auto-refreshes when the app returns to the foreground.
- Without AsyncStorage the SDK falls back to an in-memory cache (process lifetime only). Any custom backend can be injected via the `store` config option (`BundleStore` interface).
- ponytail: AsyncStorage is the default cache today; an MMKV adapter can slot in later through the same `BundleStore` interface.

## Demo

A runnable demo lives in [`Demo/`](Demo/) — a single-screen app wired to a fully local stack (Postgres + MinIO + the Go backend). From `Demo/`, run `make setup`, then `make ios` or `make android`. See [Demo/README.md](Demo/README.md).

## ICU formatting on Hermes

ICU plural formatting needs `Intl.PluralRules`, which the default Hermes engine (iOS and Android) does not ship. The SDK bundles a guarded `Intl.PluralRules` polyfill with plural-rules data for `en`, `fr`, and `es`, so plurals format out of the box for those locales — the polyfill is applied only when the native API is missing, so it's a no-op on engines that already provide it. `Intl.NumberFormat` (used to format `#`) is present natively on Hermes. For locales beyond the bundled set, `format()` falls back to the raw ICU pattern.

To add locales, install `@formatjs/intl-pluralrules` in your app and import their plural-rules data after the SDK (it registers on the same polyfilled `Intl.PluralRules`):

```ts
import '@airstrings/react-native'
import '@formatjs/intl-pluralrules/locale-data/de'
```

## License

MIT © [Symbionix](https://symbionix.io)
