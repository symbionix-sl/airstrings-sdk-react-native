# AirStrings React Native SDK

`@airstrings/react-native` — TypeScript SDK that fetches, Ed25519-verifies, caches (AsyncStorage), and serves signed localized string bundles, with bundled-fallback seeding via Metro `require`. Port of the web SDK: same layer rules (`models/`, `security/`, `networking/`, `storage/`, `events/`, orchestrated by `airstrings.ts`) and the same non-negotiables (signed-only delivery, re-verify on cache load, anti-downgrade, never throw from the public API).

Contracts (source of truth): `../../docs/contracts/bundle-format.md`, `../../docs/contracts/bundled-fallback.md`.

- Test: `npm test` (vitest, no network)
- Build: `npm run build` (tsup, ESM + CJS)
- Typecheck: `npm run typecheck` — Lint: `npm run lint`
