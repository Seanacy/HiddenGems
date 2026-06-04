// County wealth data — verified from Census 2024
export const COUNTY_WEALTH: Record<string, { avgIncome: number; medianIncome: number; tier: "gold" | "silver" | "bronze" }> = {
  Carver: { avgIncome: 159987, medianIncome: 125946, tier: "gold" },
  Scott: { avgIncome: 149625, medianIncome: 119314, tier: "gold" },
  Washington: { avgIncome: 148415, medianIncome: 115345, tier: "gold" },
  Hennepin: { avgIncome: 138433, medianIncome: 97653, tier: "silver" },
  Dakota: { avgIncome: 131262, medianIncome: 106318, tier: "silver" },
  Olmsted: { avgIncome: 132916, medianIncome: 95406, tier: "silver" },
  Wright: { avgIncome: 126718, medianIncome: 107209, tier: "silver" },
  Sherburne: { avgIncome: 123508, medianIncome: 105466, tier: "silver" },
  Anoka: { avgIncome: 120024, medianIncome: 101869, tier: "bronze" },
  Ramsey: { avgIncome: 112592, medianIncome: 81568, tier: "bronze" },
};

export function getCountyBonus(county: string): number {
  const data = COUNTY_WEALTH[county];
  if (!data) return 0;
  if (data.avgIncome > 150000) return 15; // Gold counties
  if (data.avgIncome > 130000) return 10; // Silver counties
  if (data.avgIncome > 100000) return 5;  // Bronze counties
  return 0;
}

export function getCountyTier(county: string): "gold" | "silver" | "bronze" | "none" {
  return COUNTY_WEALTH[county]?.tier || "none";
}

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
  county: string;
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

  // County wealth bonus
  score += getCountyBonus(sliver.county);

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

// ============================================================
// RENTAL SCORING — sign rental / passive income potential
// ============================================================

// Major road keywords — parcels on these are more visible for signs
const MAJOR_ROAD_KEYWORDS = [
  // Road types that indicate busy streets
  "hwy", "highway", "blvd", "boulevard", "pkwy", "parkway", "fwy", "freeway",
  "county rd", "county road", "cr ",
  // Known metro-area busy roads — Hennepin
  "hennepin ave", "lake st", "broadway", "university ave", "lyndale ave",
  "nicollet ave", "france ave", "penn ave", "portland ave", "cedar ave",
  "chicago ave", "excelsior blvd", "minnetonka blvd", "wayzata blvd",
  "66th st", "76th st", "36th st", "42nd st", "50th st", "54th st",
  "lowry ave", "plymouth ave", "olson memorial", "glenwood ave",
  "washington ave", "franklin ave", "american blvd",
  // Known metro-area busy roads — Dakota
  "cliff rd", "diffley rd", "pilot knob", "dodd blvd", "dodd rd",
  "yankee doodle", "150th st", "140th st", "cedar ave", "galaxie ave",
  "vermillion st", "robert st", "concord st",
];

export function isNearMajorRoad(address: string): boolean {
  if (!address || address === "No address") return false;
  const lower = address.toLowerCase().trim();
  return MAJOR_ROAD_KEYWORDS.some((road) => lower.includes(road));
}

// Extract road name from address for display
export function extractRoadName(address: string): string {
  if (!address || address === "No address") return "";
  // Remove house number prefix
  return address.replace(/^\d+\s+/, "").trim();
}

export interface RentalSliverData {
  parcel_area: number;
  market_value: number;
  address: string;
  forfeit_land: boolean;
  government_owned: boolean;
  county: string;
  near_major_road?: boolean; // override if already calculated
}

export function calculateRentalScore(sliver: RentalSliverData): number {
  let score = 0;

  // Road proximity — the #1 factor for sign rental
  const nearRoad = sliver.near_major_road ?? isNearMajorRoad(sliver.address);
  if (nearRoad) score += 35;

  // Has a real address (findable, identifiable, probably road-facing)
  if (sliver.address && sliver.address !== "No address") score += 10;

  // Parcel size — bigger = more sign space, more visible
  if (sliver.parcel_area >= 400) score += 15;
  else if (sliver.parcel_area >= 200) score += 10;
  else if (sliver.parcel_area >= 100) score += 5;

  // Government owned or forfeited = available to buy now
  if (sliver.forfeit_land || sliver.government_owned) score += 15;

  // Low market value = cheap to buy = better ROI
  if (sliver.market_value <= 100) score += 10;
  else if (sliver.market_value <= 300) score += 5;

  // County wealth bonus — wealthier areas = more businesses, campaigns, realtors
  score += getCountyBonus(sliver.county);

  return Math.min(100, Math.max(0, score));
}

// Estimate annual property tax based on real data from MN slivers
// Based on our DB query: $100 market value → ~$2-4/yr, $300 → $4-6/yr, $1000 → $15-20/yr
export function estimateAnnualTax(marketValue: number): number {
  if (marketValue <= 0) return 2; // minimum
  // Effective rate ~1.5-2% for small parcels, with $2 floor
  const rate = marketValue < 500 ? 0.02 : 0.015;
  return Math.max(2, Math.round(marketValue * rate * 100) / 100);
}

// Estimate monthly sign rental income based on location quality
export function estimateRentalIncome(
  nearMajorRoad: boolean,
  parcelArea: number,
  county: string
): { low: number; high: number; seasonal: string } {
  const tier = getCountyTier(county);
  let baseLow: number;
  let baseHigh: number;

  if (nearMajorRoad) {
    // High-visibility roadside parcel
    if (tier === "gold") { baseLow = 75; baseHigh = 200; }
    else if (tier === "silver") { baseLow = 50; baseHigh = 150; }
    else { baseLow = 40; baseHigh = 100; }
  } else {
    // Has address but not on a known major road — still some value
    if (tier === "gold") { baseLow = 25; baseHigh = 75; }
    else if (tier === "silver") { baseLow = 15; baseHigh = 50; }
    else { baseLow = 10; baseHigh = 35; }
  }

  // Size bonus — bigger parcels can fit bigger signs
  if (parcelArea >= 400) {
    baseLow = Math.round(baseLow * 1.3);
    baseHigh = Math.round(baseHigh * 1.3);
  }

  // Election season estimate (3-4 months every 2 years, but also primaries)
  const seasonal = nearMajorRoad ? "Campaign season: $100-300/spot" : "Campaign season: $50-150/spot";

  return { low: baseLow, high: baseHigh, seasonal };
}

export function getRentalScoreLabel(score: number): { label: string; color: string } {
  if (score >= 60) return { label: "Prime Rental", color: "#22c55e" };
  if (score >= 35) return { label: "Rentable", color: "#f59e0b" };
  return { label: "Flip Only", color: "#ef4444" };
}
