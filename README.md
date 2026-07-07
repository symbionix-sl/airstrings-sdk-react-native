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

Seed bundles are untrusted input: every candidate runs the full Ed25519 verification pipeline plus `project_id` and locale checks. The highest verified revision wins across cache / seed / network (ties go to the cache), and a winning seed is persisted to the cache. A tampered or mismatched seed emits `strings:error` and is never served or cached; a missing seed is a silent no-op. Keep the committed seed fresh by running `airstrings bundles pull` in CI or as a pre-release step.

## Caching & offline

- Bundles are cached per `{projectId}:{environmentId}:{locale}` and re-verified on every load.
- Offline: cached (or seeded) strings are served; with no cache and no seed, `t(key)` returns the key name. The SDK never throws and never blocks app startup.
- Conditional requests use ETag / `If-None-Match`, and the SDK auto-refreshes when the app returns to the foreground.
- Without AsyncStorage the SDK falls back to an in-memory cache (process lifetime only). Any custom backend can be injected via the `store` config option (`BundleStore` interface).
- ponytail: AsyncStorage is the default cache today; an MMKV adapter can slot in later through the same `BundleStore` interface.

## Demo

A runnable demo lives in [`Demo/`](Demo/) — a single-screen app wired to a fully local stack (Postgres + MinIO + the Go backend). From `Demo/`, run `make setup`, then `make ios` or `make android`. See [Demo/README.md](Demo/README.md).

## ICU formatting on Hermes

ICU plural and number formatting requires `Intl.PluralRules` / `Intl.NumberFormat`. The default Hermes engine on current React Native (iOS and Android) does not include them, so `format()` returns the raw ICU pattern. To enable full formatting, add the FormatJS polyfills (`@formatjs/intl-getcanonicallocales`, `@formatjs/intl-pluralrules`, `@formatjs/intl-numberformat`) before the SDK.

## License

MIT © [Symbionix](https://symbionix.io)
