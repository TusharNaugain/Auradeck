/**
 * Response transformation helpers: field masking for sensitive organisational data.
 * taxNumber is never returned in full (privacy), only masked to last 4 digits.
 */

export function maskTaxNumber(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/[^A-Za-z0-9]/g, '')
  return `XXXXXXX${digits.slice(-4)}`
}

export function maskPhone(input: string | null | undefined): string | null {
  if (!input) return null
  return `${input.slice(0, 3)}XXXX${input.slice(-3)}`
}
