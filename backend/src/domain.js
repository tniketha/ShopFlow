import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
const scrypt = promisify(scryptCallback);
export const MAX_MONEY = 2_000_000_000;
export class AppError extends Error {
  statusCode;
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
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
export function sumMoney(lines) {
  const total = lines.reduce((sum, l) => sum + l.quantity * l.priceMinor, 0);
  if (!Number.isSafeInteger(total) || total > MAX_MONEY || total < 0)
    throw new AppError(400, 'Amount exceeds supported limit');
  return total;
}
export function safeSum(values) {
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
export function toMinor(value) {
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value))
    throw new Error('Enter an LKR amount with at most two decimal places');
  const [whole, fraction = ''] = value.split('.');
  return money.parse(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
export function decimalMoney(minor) {
  if (!Number.isSafeInteger(minor))
    throw new AppError(400, 'Money value exceeds the supported exact range');
  const amount = BigInt(minor);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const formatMoney = (minor) => `LKR ${decimalMoney(minor)}`;
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const fingerprint = (value) => digest(JSON.stringify(value));
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password, stored) {
  const [algorithm, salt, encoded] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = await scrypt(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function replay(existing, hash) {
  if (existing.requestHash !== hash)
    throw new AppError(409, 'This request key was already used for different data');
  return existing;
}
