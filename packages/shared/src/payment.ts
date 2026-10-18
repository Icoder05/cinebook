export function luhnValid(input: string): boolean {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export type FakeOutcome = 'SUCCESS' | 'FAIL' | 'TIMEOUT';

/** Deterministic gateway: card ending 0000 fails, 1111 times out, everything else succeeds. */
export function cardOutcome(cardNumber: string): FakeOutcome {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.endsWith('0000')) return 'FAIL';
  if (digits.endsWith('1111')) return 'TIMEOUT';
  return 'SUCCESS';
}

/** UPI ids starting with "fail" fail, so the UPI tab can demo failures too. */
export function upiOutcome(upiId: string): FakeOutcome {
  return upiId.toLowerCase().startsWith('fail') ? 'FAIL' : 'SUCCESS';
}

export function expiryInFuture(mmYY: string, now = new Date()): boolean {
  const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(mmYY);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  // Card is valid through the last day of its expiry month.
  const endOfMonth = new Date(year, month, 1);
  return endOfMonth > now;
}

export const TEST_CARDS = {
  success: '4242 4242 4242 4242',
  fail: '4000 0200 0000 0000',
  timeout: '4111 1111 1111 1111',
} as const;
