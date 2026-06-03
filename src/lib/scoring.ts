export interface SliverData {
  parcel_area: number;
  tax_total: number;
  forfeit_land: boolean;
  government_owned: boolean;
  neighbor_left_value: number;
  neighbor_left_homestead: boolean;
  neighbor_right_value: number;
  neighbor_right_homestead: boolean;
  earliest_delinquent_year: string | null;
}

export function calculateScore(sliver: SliverData): number {
  let score = 0;

  // Neighbor property value (average of both sides)
  const avgNeighborValue = (sliver.neighbor_left_value + sliver.neighbor_right_value) / 2;
  if (avgNeighborValue > 300000) score += 30;
  else if (avgNeighborValue > 200000) score += 20;
  else if (avgNeighborValue > 0) score += 10;

  // Homestead status
  if (sliver.neighbor_left_homestead && sliver.neighbor_right_homestead) score += 30;
  else if (sliver.neighbor_left_homestead || sliver.neighbor_right_homestead) score += 20;

  // No delinquency on neighbors = good
  score += 10;

  // Sliver size — smaller = easier impulse buy
  if (sliver.parcel_area < 500) score += 10;

  // Acquisition cost — cheaper = better ROI
  if (sliver.tax_total < 200) score += 10;

  // Government owned or tax-forfeited = ready to buy now
  if (sliver.forfeit_land || sliver.government_owned) score += 10;

  return Math.min(100, Math.max(0, score));
}

// Government ownership patterns — works across ALL counties
const GOV_OWNER_PATTERNS = [
  "county", "state of minnesota", "city of", "township",
  "hennepin", "dakota", "ramsey", "scott", "carver", "washington", "anoka",
  "metropolitan council", "met council", "mndot", "mn dot",
  "department of", "dept of", "housing authority",
  "school district", "isd ", "public works",
  "tax forfeited", "forfeited", "in rem",
];

export function isGovernmentOwned(ownerName: string): boolean {
  if (!ownerName) return false;
  const lower = ownerName.toLowerCase().trim();
  return GOV_OWNER_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function getPriority(sliver: {
  forfeit_land: boolean;
  government_owned: boolean;
  owner_name: string;
  earliest_delinquent_year: string | null;
}): number {
  // Priority 1: Government owned OR tax-forfeited — BUY NOW
  if (sliver.forfeit_land || sliver.government_owned) return 1;

  // Priority 2: Long-delinquent (5+ years) — heading toward forfeiture
  if (sliver.earliest_delinquent_year) {
    const yr = parseInt(sliver.earliest_delinquent_year);
    const currentYear = new Date().getFullYear() % 100;
    if (!isNaN(yr) && (currentYear - yr) >= 5) return 2;
  }

  // Priority 3: Everything else
  return 3;
}

export function getScoreLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "High Chance", color: "#22c55e" };
  if (score >= 40) return { label: "Moderate", color: "#f59e0b" };
  return { label: "Long Shot", color: "#ef4444" };
}

export function getPriorityLabel(priority: number): { label: string; color: string } {
  if (priority === 1) return { label: "Buy Now", color: "#f97316" };
  if (priority === 2) return { label: "Delinquent 5yr+", color: "#eab308" };
  return { label: "Flagged", color: "#6b7280" };
}
