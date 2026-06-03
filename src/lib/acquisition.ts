// Estimated acquisition cost calculator
// Based on verified Dakota County and Hennepin County forfeited land sale terms

const STATE_SURCHARGE_RATE = 0.03; // 3% of sale price
const STATE_DEED_FEE = 25;
const CONSERVATION_FEE = 5;
const RECORDING_FEE = 46;
const MIN_DEED_TAX = 1.65;
const DEED_TAX_RATE = 0.0033; // 0.33% of sale price

export function estimateAcquisitionCost(marketValue: number): {
  basePrice: number;
  surcharge: number;
  deedTax: number;
  fees: number;
  total: number;
} {
  const basePrice = marketValue;
  const surcharge = Math.round(basePrice * STATE_SURCHARGE_RATE * 100) / 100;
  const deedTax = Math.max(MIN_DEED_TAX, Math.round(basePrice * DEED_TAX_RATE * 100) / 100);
  const fees = STATE_DEED_FEE + CONSERVATION_FEE + RECORDING_FEE;
  const total = Math.round((basePrice + surcharge + deedTax + fees) * 100) / 100;

  return { basePrice, surcharge, deedTax, fees, total };
}

export function formatCost(amount: number): string {
  if (amount === 0) return "Contact County";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
