export const HOLD_MINUTES = 10;
export const MAX_SEATS_PER_BOOKING = 10;
/** ₹30 per ticket, stored in paise. */
export const CONVENIENCE_FEE_PAISE = 3000;
/** 18% GST on the convenience fee, in basis points. */
export const GST_BPS = 1800;
export const CANCEL_CUTOFF_HOURS = 2;
export const TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330;

export const FORMATS = ['2D', '3D', 'IMAX', '4DX'] as const;
export type Format = (typeof FORMATS)[number];

export const MOVIE_STATUSES = ['now_showing', 'upcoming'] as const;
export type MovieStatus = (typeof MOVIE_STATUSES)[number];

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = ['INITIATED', 'SUCCESS', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['card', 'upi', 'netbanking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BANKS = [
  { code: 'SBI', name: 'State Bank of India' },
  { code: 'HDFC', name: 'HDFC Bank' },
  { code: 'ICICI', name: 'ICICI Bank' },
  { code: 'AXIS', name: 'Axis Bank' },
  { code: 'KOTAK', name: 'Kotak Mahindra Bank' },
  { code: 'PNB', name: 'Punjab National Bank' },
] as const;
export const BANK_CODES = BANKS.map((b) => b.code) as unknown as readonly [string, ...string[]];

/** Seat state as seen by a particular viewer. */
export const SEAT_STATES = ['AVAILABLE', 'HELD', 'HELD_BY_ME', 'BOOKED', 'BLOCKED'] as const;
export type SeatState = (typeof SEAT_STATES)[number];
