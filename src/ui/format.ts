/** 1 → "1st", 12 → "12th", 23 → "23rd". */
export function ord(n: number): string {
  if (!n || !isFinite(n)) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const pct = (v: number, digits = 0) => (v * 100).toFixed(digits) + '%';

export const signed = (n: number, digits = 1) => (n >= 0 ? '+' : '') + n.toFixed(digits);

export const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

export const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
