import { z } from 'zod';
import { BANK_CODES, MAX_SEATS_PER_BOOKING } from '../constants';
import { expiryInFuture, luhnValid, UPI_REGEX } from '../payment';
import { uuid } from './common';

export const holdSchema = z.object({
  seatIds: z
    .array(uuid)
    .min(1, 'Pick at least one seat')
    .max(MAX_SEATS_PER_BOOKING, `You can book up to ${MAX_SEATS_PER_BOOKING} seats`)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate seats'),
});
export type HoldInput = z.infer<typeof holdSchema>;

const cardNumber = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^\d{12,19}$/, 'Enter a valid card number')
      .refine(luhnValid, 'Card number is invalid'),
  );

export const cardPaymentSchema = z.object({
  method: z.literal('card'),
  cardNumber,
  name: z.string().trim().min(2, 'Enter the name on card').max(60),
  expiry: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Use MM/YY')
    .refine((v) => expiryInFuture(v), 'Card has expired'),
});

export const upiPaymentSchema = z.object({
  method: z.literal('upi'),
  upiId: z.string().trim().regex(UPI_REGEX, 'Use the format name@bank'),
});

export const netbankingPaymentSchema = z.object({
  method: z.literal('netbanking'),
  bank: z.enum(BANK_CODES as [string, ...string[]], { message: 'Choose a bank' }),
});

/** What the API accepts. CVV is validated in the browser and never sent. */
export const paySchema = z.discriminatedUnion('method', [
  cardPaymentSchema,
  upiPaymentSchema,
  netbankingPaymentSchema,
]);
export type PayInput = z.infer<typeof paySchema>;

/** Card form used by the gateway page (adds CVV, which stays client-side). */
export const cardFormSchema = cardPaymentSchema.extend({
  cvv: z.string().regex(/^\d{3,4}$/, 'Enter the 3 or 4 digit CVV'),
});
export type CardFormInput = z.input<typeof cardFormSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid Idempotency-Key');

export const bookingsQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});
