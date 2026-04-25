export function normalizePhoneMY(raw: string): string | null {
  const trimmed = (raw ?? '').replace(/[\s\-()]/g, '');
  if (!trimmed) return null;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/^\+/, '');
  if (/^60\d{8,11}$/.test(digits)) return '+' + digits;
  if (/^0\d{8,11}$/.test(digits)) return '+60' + digits.slice(1);
  if (/^[1-9]\d{7,10}$/.test(digits)) return '+60' + digits;
  return null;
}
