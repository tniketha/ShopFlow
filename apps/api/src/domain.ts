import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
const scrypt = promisify(scryptCallback);
export const MAX_MONEY = 2_000_000_000;
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const id = z.string().uuid();
export const money = z.number().int().min(0).max(MAX_MONEY);
export const quantity = z.number().int().min(1).max(100_000);
export const key = z.string().uuid();
export const linesSchema = z
  .array(z.object({ productId: id, quantity }).strict())
  .min(1)
  .max(100)
  .refine(
    (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
    'Use one line per product',
  );
export const checkoutSchema = z
  .object({ requestKey: key, lines: linesSchema, paidMinor: money })
  .strict();
export const refundSchema = z
  .object({
    requestKey: key,
    reason: z.string().trim().min(3).max(300),
    lines: z
      .array(z.object({ saleLineId: id, quantity }).strict())
      .min(1)
      .max(100)
      .refine(
        (ls) => new Set(ls.map((l) => l.saleLineId)).size === ls.length,
        'Duplicate refund line',
      ),
  })
  .strict();
export function sumMoney(lines: { quantity: number; priceMinor: number }[]) {
  const total = lines.reduce((sum, l) => sum + l.quantity * l.priceMinor, 0);
  if (!Number.isSafeInteger(total) || total > MAX_MONEY || total < 0)
    throw new AppError(400, 'Amount exceeds supported limit');
  return total;
}
export function safeSum(values: number[]) {
  const sum = values.reduce((total, value) => {
    if (!Number.isSafeInteger(value))
      throw new AppError(400, 'Report value exceeds the supported exact range');
    const next = total + value;
    if (!Number.isSafeInteger(next))
      throw new AppError(400, 'Report total exceeds the supported exact range');
    return next;
  }, 0);
  return sum;
}
export function toMinor(value: string) {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value))
    throw new Error('Enter an LKR amount with at most two decimal places');
  const [whole, fraction = ''] = value.split('.');
  return money.parse(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
export function decimalMoney(minor: number) {
  if (!Number.isSafeInteger(minor))
    throw new AppError(400, 'Money value exceeds the supported exact range');
  const amount = BigInt(minor);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const formatMoney = (minor: number) => `LKR ${decimalMoney(minor)}`;
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const fingerprint = (value: unknown) => digest(JSON.stringify(value));
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function replay<T extends { requestHash: string }>(existing: T, hash: string): T {
  if (existing.requestHash !== hash)
    throw new AppError(409, 'This request key was already used for different data');
  return existing;
}
