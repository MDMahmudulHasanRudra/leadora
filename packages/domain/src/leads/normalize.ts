import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** E.164 for a valid number, or null. Local numbers are read in the organization's default country. */
export function normalizePhone(raw: string, defaultCountry: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = parsePhoneNumberFromString(value, defaultCountry as CountryCode);
  return parsed?.isValid() ? parsed.number : null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Escapes LIKE wildcards so user search text matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
