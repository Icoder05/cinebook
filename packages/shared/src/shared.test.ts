import { describe, expect, it } from 'vitest';
import {
  cardOutcome,
  computeTotals,
  expiryInFuture,
  formatINR,
  luhnValid,
  paySchema,
  resolveTierPrice,
  TEST_CARDS,
} from './index';

describe('pricing', () => {
  it('adds ₹30 per ticket and 18% GST on the fee only, in integer paise', () => {
    expect(computeTotals([45000, 25000, 18000])).toEqual({
      subtotalPaise: 88000,
      feePaise: 9000,
      taxPaise: 1620,
      totalPaise: 98620,
    });
  });

  it('rejects fractional or negative prices', () => {
    expect(() => computeTotals([100.5])).toThrow();
    expect(() => computeTotals([-1])).toThrow();
  });

  it('applies a showtime override over the tier base price', () => {
    expect(resolveTierPrice('t1', 25000, { t1: 30000 })).toBe(30000);
    expect(resolveTierPrice('t2', 25000, { t1: 30000 })).toBe(25000);
    expect(resolveTierPrice('t1', 25000, null)).toBe(25000);
  });

  it('formats rupees Indian-style', () => {
    expect(formatINR(98620)).toBe('₹986.20');
    expect(formatINR(12345600)).toBe('₹1,23,456');
  });
});

describe('fake gateway rules', () => {
  it('validates card numbers with Luhn', () => {
    for (const c of Object.values(TEST_CARDS)) expect(luhnValid(c)).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
  });

  it('maps test cards to deterministic outcomes', () => {
    expect(cardOutcome(TEST_CARDS.success)).toBe('SUCCESS');
    expect(cardOutcome(TEST_CARDS.fail)).toBe('FAIL');
    expect(cardOutcome(TEST_CARDS.timeout)).toBe('TIMEOUT');
  });

  it('checks expiry against the end of the month', () => {
    const now = new Date(2026, 9, 17);
    expect(expiryInFuture('10/26', now)).toBe(true);
    expect(expiryInFuture('09/26', now)).toBe(false);
  });

  it('validates pay bodies per method', () => {
    expect(paySchema.safeParse({ method: 'upi', upiId: 'asha@okhdfc' }).success).toBe(true);
    expect(paySchema.safeParse({ method: 'upi', upiId: 'asha' }).success).toBe(false);
    expect(paySchema.safeParse({ method: 'netbanking', bank: 'NOPE' }).success).toBe(false);
    const card = paySchema.parse({ method: 'card', cardNumber: TEST_CARDS.success, name: 'A B', expiry: '12/39' });
    expect(card).toMatchObject({ cardNumber: '4242424242424242' });
  });
});
