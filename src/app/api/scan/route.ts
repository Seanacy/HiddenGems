import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateScore, getPriority, isGovernmentOwned } from "@/lib/scoring";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Verified county GIS endpoints with tax data
const COUNTIES: Record<string, {
  url: string;
  center: [number, number];
  fields: {
    pid: string;
    owner: string;
    address: string;
    city: string;
    area: string;
    building_value: string;
    market_value: string;
    tax: string;
    forfeit?: string;
    delinquent_year?: string;
    homestead?: string;
    lat?: string;
    lng?: string;
  };
  where: string;
}> = {
  Hennepin: {
    url: "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query",
    center: [-93.35, 44.96],
    fields: {
      pid: "PID", owner: "OWNER_NM", address: "STREET_NM", city: "MUNIC_NM",
      area: "PARCEL_AREA", building_value: "BLDG_MV1", market_value: "MKT_VAL_TOT",
      tax: "TAX_TOT", forfeit: "FORFEIT_LAND_IND", delinquent_year: "EARLIEST_DELQ_YR",
      homestead: "HMSTD_CD1", lat: "LAT", lng: "LON",
    },
    where: "PARCEL_AREA < 1000 AND BLDG_MV1 = 0 AND PARCEL_AREA > 0",
  },
  Dakota: {
    url: "https://gis2.co.dakota.mn.us/arcgis/rest/services/DCGIS_OL_PropertyInformation/MapServer/71/query",
    center: [-93.15, 44.73],
    fields: {
      pid: "TAXPIN", owner: "FULLNAME", address: "SITEADDRESS", city: "MUNICIPALITY",
      area: "TOTAL_SF", building_value: "BLDGVAL", market_value: "TOTALVAL",
      tax: "TOTAL_TAX", homestead: "HOMESTEAD",
    },
    where: "TOTAL_SF < 1000 AND BLDGVAL = 0 AND TOTAL_SF > 0",
  },
};

interface GISFeature {
  attributes: Record<string, unknown>;
}

async function fetchSlivers(countyConfig: typeof COUNTIES.Hennepin): Promise<GISFeature[]> {
  const allFieldNames = Object.values(countyConfig.fields).filter(Boolean).join(",");

  const params = new URLSearchParams({
    where: countyConfig.where,
    outFields: allFieldNames,
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "2000",
  });

  const allFeatures: GISFeature[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    params.set("resultOffset", offset.toString());
    try {
      const res = await fetch(`${countyConfig.url}?${params}`, { signal: AbortSignal.timeout(30000) });
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        allFeatures.push(...data.features);
        offset += data.features.length;
        hasMore = data.features.length === 2000;
      } else {
        hasMore = false;
      }
    } catch {
      hasMore = false;
    }
  }

  return allFeatures;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const county = searchParams.get("county") || "Hennepin";
    const config = COUNTIES[county];

    if (!config) {
      return NextResponse.json({ error: `County "${county}" not supported. Available: ${Object.keys(COUNTIES).join(", ")}` }, { status: 400 });
    }

    const f = config.fields;
    const features = await fetchSlivers(config);

    if (features.length === 0) {
      return NextResponse.json({ message: "No slivers found", count: 0 });
    }

    const slivers = [];
    for (const feature of features) {
      const a = feature.attributes;

      const pid = (a[f.pid] as string) || "";
      const ownerName = (a[f.owner] as string) || "";
      const address = (a[f.address] as string) || "No address";
      const city = (a[f.city] as string) || "";
      const parcelArea = (a[f.area] as number) || 0;
      const buildingValue = (a[f.building_value] as number) || 0;
      const marketValue = (a[f.market_value] as number) || 0;
      const taxTotal = (a[f.tax] as number) || 0;
      const forfeitFlag = f.forfeit ? (a[f.forfeit] as string) === "Y" : false;
      const delinquentYear = f.delinquent_year ? (a[f.delinquent_year] as string) || null : null;
      const homesteadCode = f.homestead ? (a[f.homestead] as string) || null : null;
      const lat = f.lat ? (a[f.lat] as number) : null;
      const lng = f.lng ? (a[f.lng] as number) : null;

      if (!pid) continue;

      // Universal government ownership check
      const governmentOwned = isGovernmentOwned(ownerName);

      const priority = getPriority({
        forfeit_land: forfeitFlag,
        government_owned: governmentOwned,
        owner_name: ownerName,
        earliest_delinquent_year: delinquentYear,
      });

      const score = calculateScore({
        parcel_area: parcelArea,
        tax_total: taxTotal,
        forfeit_land: forfeitFlag,
        government_owned: governmentOwned,
        neighbor_left_value: 0,
        neighbor_left_homestead: false,
        neighbor_right_value: 0,
        neighbor_right_homestead: false,
        earliest_delinquent_year: delinquentYear,
        county,
      });

      slivers.push({
        pid,
        owner_name: ownerName,
        taxpayer_name: ownerName,
        address,
        city,
        parcel_area: parcelArea,
        lat: lat || config.center[1],
        lng: lng || config.center[0],
        forfeit_land: forfeitFlag,
        earliest_delinquent_year: delinquentYear,
        market_value: marketValue,
        building_value: buildingValue,
        tax_total: taxTotal,
        tax_paid: 0,
        sale_price: 0,
        sale_date: null,
        homestead_code: homesteadCode,
        property_type: null,
        priority,
        score,
        neighbor_left_name: "",
        neighbor_left_value: 0,
        neighbor_left_homestead: false,
        neighbor_right_name: "",
        neighbor_right_value: 0,
        neighbor_right_homestead: false,
        county,
        raw_data: a,
        last_synced: new Date().toISOString(),
      });
    }

    // Upsert into Supabase
    const { error } = await supabase
      .from("hg_slivers")
      .upsert(slivers, { onConflict: "pid" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Scan complete",
      county,
      total_parcels_scanned: features.length,
      slivers_saved: slivers.length,
      buy_now: slivers.filter((s) => s.priority === 1).length,
      delinquent: slivers.filter((s) => s.priority === 2).length,
      flagged: slivers.filter((s) => s.priority === 3).length,
      high_score: slivers.filter((s) => s.score >= 70).length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
