import { describe, expect, it } from 'vitest';
import {
  AppError,
  checkoutSchema,
  checkPassword,
  csvCell,
  decimalMoney,
  digest,
  hashPassword,
  replay,
  safeSum,
  sumMoney,
  toMinor,
} from '../src/domain.js';
describe('Money and request validation', () => {
  it('converts rupees without floating-point multiplication', () => {
    expect(toMinor('0.29')).toBe(29);
    expect(toMinor('123.4')).toBe(12340);
    expect(toMinor('0')).toBe(0);
  });
  it('formats large exact amounts and rejects unsafe report arithmetic', () => {
    expect(decimalMoney(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    expect(decimalMoney(-29)).toBe('-0.29');
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it.each(['1.001', '-1', '1e3', 'NaN', ' 1', '1,000', '01'])('rejects invalid money %s', (input) =>
    expect(() => toMinor(input)).toThrow(),
  );
  it('rejects unsafe totals and decimal quantities', () => {
    expect(() => sumMoney([{ priceMinor: 2_000_000_000, quantity: 2 }])).toThrow(AppError);
    expect(
      checkoutSchema.safeParse({
        requestKey: crypto.randomUUID(),
        paidMinor: 1,
        lines: [{ productId: crypto.randomUUID(), quantity: 0.5 }],
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate product lines and client price overrides', () => {
    const line = { productId: crypto.randomUUID(), quantity: 1 };
    expect(
      checkoutSchema.safeParse({
        requestKey: crypto.randomUUID(),
        paidMinor: 100,
        lines: [line, line],
      }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({
        requestKey: crypto.randomUUID(),
        paidMinor: 100,
        lines: [{ ...line, priceMinor: 1 }],
      }).success,
    ).toBe(false);
  });
  it('escapes CSV formulas, quotes and newlines', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell(' a"b\nc')).toBe('" a""b\nc"');
    expect(csvCell(' @SUM(A1)')).toBe('"\' @SUM(A1)"');
  });
  it('rejects reusing a request key with a different payload', () => {
    expect(replay({ requestHash: 'same', id: 'a' }, 'same').id).toBe('a');
    expect(() => replay({ requestHash: 'old' }, 'new')).toThrow('different data');
  });
});
describe('Passwords and sessions', () => {
  it('salts and verifies scrypt passwords', async () => {
    const one = await hashPassword('a long secret 123');
    const two = await hashPassword('a long secret 123');
    expect(one).not.toBe(two);
    expect(await checkPassword('a long secret 123', one)).toBe(true);
    expect(await checkPassword('wrong', one)).toBe(false);
    expect(digest('session')).not.toContain('session');
  });
});
