export interface SliverData {
  parcel_area: number;
  tax_total: number;
  forfeit_land: boolean;
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

  // Neighbor tax delinquency (no delinquency = good)
  // We check this on the sliver's neighbors during the scan phase
  // For now, assume no delinquency adds points
  score += 10;

  // Sliver size — smaller = easier impulse buy
  if (sliver.parcel_area < 500) score += 10;

  // Acquisition cost — cheaper = better ROI
  if (sliver.tax_total < 200) score += 10;

  // Tax-forfeited = ready to buy now
  if (sliver.forfeit_land) score += 10;

  return Math.min(100, Math.max(0, score));
}

export function getPriority(sliver: {
  forfeit_land: boolean;
  owner_name: string;
  earliest_delinquent_year: string | null;
}): number {
  // Priority 1: Tax-forfeited
  if (sliver.forfeit_land) return 1;

  // Priority 2: Long-delinquent (5+ years)
  if (sliver.earliest_delinquent_year) {
    const yr = parseInt(sliver.earliest_delinquent_year);
    const currentYear = new Date().getFullYear() % 100; // 2-digit year
    if (!isNaN(yr) && (currentYear - yr) >= 5) return 2;
  }

  // Priority 3: Everything else (including dissolved corps — detected separately)
  return 3;
}

export function getScoreLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "High Chance", color: "#22c55e" };
  if (score >= 40) return { label: "Moderate", color: "#f59e0b" };
  return { label: "Long Shot", color: "#ef4444" };
}

export function getPriorityLabel(priority: number): { label: string; color: string } {
  if (priority === 1) return { label: "Tax-Forfeited", color: "#f97316" };
  if (priority === 2) return { label: "Long Delinquent", color: "#eab308" };
  return { label: "Flagged", color: "#6b7280" };
}
