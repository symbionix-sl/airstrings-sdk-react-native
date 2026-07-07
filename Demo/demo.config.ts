export const LOCALES = ['en', 'fr', 'es'] as const;

export type Locale = (typeof LOCALES)[number];

export const PLURAL_COUNTS = [0, 1, 2, 5] as const;
