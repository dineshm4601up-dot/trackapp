/**
 * Exact decimal arithmetic for display totals (quantity × unit price), using
 * scaled BigInt integers. No binary floating-point is involved; the database
 * remains the source of truth for stored values.
 */
const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;
const TEN = BigInt(10);

function toScaled(value: string, scale: number): bigint | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const [, sign, integer, fraction = ""] = match;
  if (fraction.length > scale) return null;
  const scaled = BigInt(integer + fraction.padEnd(scale, "0"));
  return sign ? -scaled : scaled;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const text = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

/** quantity (≤ 3 dp) × unit price (≤ 2 dp) → amount with 2 dp, rounded half-up. */
export function lineAmount(quantity: string, unitPrice: string): string | null {
  const q = toScaled(quantity, 3);
  const p = toScaled(unitPrice, 2);
  if (q === null || p === null) return null;
  const product = q * p; // scale 5
  const divisor = TEN ** BigInt(3);
  const half = divisor / BigInt(2);
  return fromScaled((product + (product >= BigInt(0) ? half : -half)) / divisor, 2);
}

/** Sum of 2-dp amounts. */
export function sumAmounts(amounts: string[]): string {
  return fromScaled(
    amounts.reduce((total, amount) => total + (toScaled(amount, 2) ?? BigInt(0)), BigInt(0)),
    2,
  );
}

/** NUMERIC values arrive from the API as JS numbers; render them as exact text at their column scale. */
export function numericText(value: number | null | undefined, scale: number): string {
  return value === null || value === undefined ? "" : value.toFixed(scale);
}

/** Quantity text without trailing zeros: 2.500 → "2.5", 10.000 → "10". */
export function formatQuantity(value: number | string): string {
  const text = typeof value === "number" ? value.toFixed(3) : value;
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** a − b at the given scale (exact). Null if either is not a valid decimal at that scale. */
export function decimalDiff(a: string, b: string, scale: number): string | null {
  const x = toScaled(a, scale);
  const y = toScaled(b, scale);
  return x === null || y === null ? null : fromScaled(x - y, scale);
}

/** Sign of a − b (−1, 0, 1), or null if either value is invalid. */
export function compareDecimal(a: string, b: string, scale: number): -1 | 0 | 1 | null {
  const x = toScaled(a, scale);
  const y = toScaled(b, scale);
  if (x === null || y === null) return null;
  return x === y ? 0 : x > y ? 1 : -1;
}
