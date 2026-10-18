import { CONVENIENCE_FEE_PAISE, GST_BPS } from './constants';

export interface Totals {
  subtotalPaise: number;
  feePaise: number;
  taxPaise: number;
  totalPaise: number;
}

/** All money is integer paise. Fee is per ticket; GST applies to the fee only. */
export function computeTotals(seatPricesPaise: number[]): Totals {
  for (const p of seatPricesPaise) {
    if (!Number.isInteger(p) || p < 0) throw new Error(`Invalid seat price: ${p}`);
  }
  const subtotalPaise = seatPricesPaise.reduce((a, b) => a + b, 0);
  const feePaise = seatPricesPaise.length * CONVENIENCE_FEE_PAISE;
  const taxPaise = Math.round((feePaise * GST_BPS) / 10_000);
  return { subtotalPaise, feePaise, taxPaise, totalPaise: subtotalPaise + feePaise + taxPaise };
}

/** A showtime may override a tier's base price; overrides are keyed by tier id. */
export function resolveTierPrice(
  tierId: string,
  basePricePaise: number,
  overrides: Record<string, number> | null | undefined,
): number {
  const o = overrides?.[tierId];
  return typeof o === 'number' && Number.isInteger(o) && o >= 0 ? o : basePricePaise;
}

export function formatINR(paise: number): string {
  const rupees = paise / 100;
  return (
    '₹' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}
