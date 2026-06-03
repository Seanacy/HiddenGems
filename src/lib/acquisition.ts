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

// Estimate what you can sell a sliver for based on neighbor property values
// Logic: neighbors with higher home values will pay more for adjacent land
// Base price is per-sqft derived from surrounding property values
// A $300K homeowner will pay $3-5/sqft for a sliver they want
// A $500K homeowner will pay $5-10/sqft
export function estimateResaleValue(
  parcelArea: number,
  neighborLeftValue: number,
  neighborRightValue: number,
  countyAvgIncome: number
): {
  low: number;
  mid: number;
  high: number;
} {
  const avgNeighborValue = (neighborLeftValue + neighborRightValue) / 2;

  // Per square foot pricing based on neighbor wealth
  let perSqFtLow: number;
  let perSqFtHigh: number;

  if (avgNeighborValue > 400000) {
    perSqFtLow = 6; perSqFtHigh = 12;
  } else if (avgNeighborValue > 300000) {
    perSqFtLow = 4; perSqFtHigh = 8;
  } else if (avgNeighborValue > 200000) {
    perSqFtLow = 3; perSqFtHigh = 6;
  } else if (avgNeighborValue > 100000) {
    perSqFtLow = 2; perSqFtHigh = 4;
  } else {
    // No neighbor data — use county income as proxy
    if (countyAvgIncome > 150000) {
      perSqFtLow = 5; perSqFtHigh = 10;
    } else if (countyAvgIncome > 130000) {
      perSqFtLow = 3; perSqFtHigh = 7;
    } else if (countyAvgIncome > 100000) {
      perSqFtLow = 2; perSqFtHigh = 5;
    } else {
      perSqFtLow = 1; perSqFtHigh = 3;
    }
  }

  // Minimum sale price — even a tiny strip has a floor value
  // because the neighbor is really paying for the convenience, not the land
  const MIN_SALE = 200;

  const low = Math.max(MIN_SALE, Math.round(parcelArea * perSqFtLow));
  const high = Math.max(MIN_SALE, Math.round(parcelArea * perSqFtHigh));
  const mid = Math.round((low + high) / 2);

  return { low, mid, high };
}

export function estimateProfit(
  acquisitionTotal: number,
  resaleMid: number
): {
  profit: number;
  roi: number;
} {
  const profit = Math.round(resaleMid - acquisitionTotal);
  const roi = acquisitionTotal > 0 ? Math.round((profit / acquisitionTotal) * 100) : 0;
  return { profit, roi };
}
