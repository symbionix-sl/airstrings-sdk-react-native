# Changelog

All notable changes to `@airstrings/react-native` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-07

### Added
- Initial release of the AirStrings React Native SDK.
- Fetches Ed25519-signed string bundles from the AirStrings CDN and verifies them with `@noble/ed25519` against integrator-supplied public keys.
- Key rotation via multiple configured public keys (`key_id` lookup).
- Caches bundles in AsyncStorage, keyed by `{projectId}:{environmentId}:{locale}`, with an automatic in-memory fallback and an injectable `BundleStore`.
- Re-verifies cached bundles on load (defense in depth).
- Anti-downgrade protection: never replaces a higher-revision bundle with a lower one.
- Bundled fallback (seed): committed signed bundles are seeded at startup via Metro `require`, so a cold offline start serves real strings instead of key names. Every seed candidate runs the full verification pipeline plus `project_id` and locale checks.
- ICU MessageFormat support via a self-contained runtime — `intl-messageformat` is bundled into `dist`, so consumers install no extra formatting dependency (`format()` method).
- ETag-based conditional requests (`If-None-Match` / 304) and foreground refresh (refreshes when the app returns to the foreground).
- Typed event emitter (`strings:updated`, `strings:error`).
- Dual ESM + CJS distribution with TypeScript declarations.

### Known limitations
- ICU plural and number formatting requires `Intl.PluralRules` / `Intl.NumberFormat`. The default Hermes engine on current React Native (iOS and Android) does not include them, so `format()` returns the raw ICU pattern. Add the FormatJS polyfills (`@formatjs/intl-getcanonicallocales`, `@formatjs/intl-pluralrules`, `@formatjs/intl-numberformat`) before the SDK to enable full formatting.

[Unreleased]: https://github.com/symbionix-sl/airstrings-sdk-react-native/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/symbionix-sl/airstrings-sdk-react-native/releases/tag/v0.1.0
