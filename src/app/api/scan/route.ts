import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateScore, getPriority } from "@/lib/scoring";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// County GIS endpoints — each county publishes parcel data through ArcGIS
const COUNTY_GIS: Record<string, string> = {
  Hennepin: "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query",
  Ramsey: "https://maps.co.ramsey.mn.us/arcgis/rest/services/MapRamsey/MapServer/44/query",
  Dakota: "https://gis.co.dakota.mn.us/arcgis/rest/services/publicViewer/MapServer/0/query",
  Anoka: "https://maps.co.anoka.mn.us/arcgis/rest/services/publicViewer/MapServer/0/query",
  Washington: "https://gis.co.washington.mn.us/arcgis/rest/services/publicViewer/MapServer/0/query",
  Scott: "https://maps.co.scott.mn.us/arcgis/rest/services/publicViewer/MapServer/0/query",
  Carver: "https://gis.co.carver.mn.us/arcgis/rest/services/publicViewer/MapServer/0/query",
};

interface GISFeature {
  attributes: Record<string, unknown>;
}

async function fetchSlivers(gisUrl: string = COUNTY_GIS.Hennepin): Promise<GISFeature[]> {
  // Query for small parcels with no buildings
  // PARCEL_AREA is in sq ft, BLDG_MV1 = 0 means no building
  const params = new URLSearchParams({
    where: "PARCEL_AREA < 1000 AND BLDG_MV1 = 0 AND PARCEL_AREA > 0",
    outFields: "PID,OWNER_NM,TAXPAYER_NM,HOUSE_NO,STREET_NM,MUNIC_NM,PARCEL_AREA,LAT,LON,FORFEIT_LAND_IND,EARLIEST_DELQ_YR,MKT_VAL_TOT,BLDG_MV1,TAX_TOT,NET_TAX_PD,SALE_PRICE,SALE_DATE,HMSTD_CD1,PR_TYP_NM1",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "2000",
  });

  const allFeatures: GISFeature[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    params.set("resultOffset", offset.toString());
    const res = await fetch(`${gisUrl}?${params}`, { signal: AbortSignal.timeout(30000) });
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      allFeatures.push(...data.features);
      offset += data.features.length;
      hasMore = data.features.length === 2000; // more pages if we hit the limit
    } else {
      hasMore = false;
    }
  }

  return allFeatures;
}

async function fetchNeighbors(lat: number, lon: number, gisUrl: string = COUNTY_GIS.Hennepin): Promise<GISFeature[]> {
  // Find parcels near this point (within ~30 meters)
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    spatialRel: "esriSpatialRelIntersects",
    distance: "30",
    units: "esriSRUnit_Meter",
    inSR: "4326",
    outFields: "PID,OWNER_NM,MKT_VAL_TOT,HMSTD_CD1,EARLIEST_DELQ_YR,BLDG_MV1,PARCEL_AREA",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "10",
  });

  try {
    const res = await fetch(`${gisUrl}?${params}`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return data.features || [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const county = searchParams.get("county") || "Hennepin";
    const gisUrl = COUNTY_GIS[county] || COUNTY_GIS.Hennepin;

    // Step 1: Fetch all small parcels
    const features = await fetchSlivers(gisUrl);

    if (features.length === 0) {
      return NextResponse.json({ message: "No slivers found", count: 0 });
    }

    // Step 2: Process each sliver
    const slivers = [];
    for (const feature of features) {
      const a = feature.attributes;
      const lat = a.LAT as number;
      const lon = a.LON as number;
      const pid = a.PID as string;

      if (!lat || !lon || !pid) continue;

      const address = [a.HOUSE_NO, a.STREET_NM].filter(Boolean).join(" ").trim();
      const forfeit = (a.FORFEIT_LAND_IND as string) === "Y";
      const ownerName = (a.OWNER_NM as string) || "";

      // Fetch neighbors (limit to first 50 slivers to avoid rate limiting on initial scan)
      let neighborLeft = { name: "", value: 0, homestead: false };
      let neighborRight = { name: "", value: 0, homestead: false };

      if (slivers.length < 50) {
        const neighbors = await fetchNeighbors(lat, lon, gisUrl);
        const adjacentParcels = neighbors.filter(
          (n) => (n.attributes.PID as string) !== pid && (n.attributes.BLDG_MV1 as number) > 0
        );

        if (adjacentParcels.length >= 1) {
          const n1 = adjacentParcels[0].attributes;
          neighborLeft = {
            name: (n1.OWNER_NM as string) || "",
            value: (n1.MKT_VAL_TOT as number) || 0,
            homestead: (n1.HMSTD_CD1 as string) === "Y",
          };
        }
        if (adjacentParcels.length >= 2) {
          const n2 = adjacentParcels[1].attributes;
          neighborRight = {
            name: (n2.OWNER_NM as string) || "",
            value: (n2.MKT_VAL_TOT as number) || 0,
            homestead: (n2.HMSTD_CD1 as string) === "Y",
          };
        }
      }

      const priority = getPriority({
        forfeit_land: forfeit,
        owner_name: ownerName,
        earliest_delinquent_year: (a.EARLIEST_DELQ_YR as string) || null,
      });

      const score = calculateScore({
        parcel_area: (a.PARCEL_AREA as number) || 0,
        tax_total: (a.TAX_TOT as number) || 0,
        forfeit_land: forfeit,
        neighbor_left_value: neighborLeft.value,
        neighbor_left_homestead: neighborLeft.homestead,
        neighbor_right_value: neighborRight.value,
        neighbor_right_homestead: neighborRight.homestead,
        earliest_delinquent_year: (a.EARLIEST_DELQ_YR as string) || null,
      });

      slivers.push({
        pid,
        owner_name: ownerName,
        taxpayer_name: (a.TAXPAYER_NM as string) || "",
        address: address || "No address",
        city: (a.MUNIC_NM as string) || "",
        parcel_area: (a.PARCEL_AREA as number) || 0,
        lat,
        lng: lon,
        forfeit_land: forfeit,
        earliest_delinquent_year: (a.EARLIEST_DELQ_YR as string) || null,
        market_value: (a.MKT_VAL_TOT as number) || 0,
        building_value: (a.BLDG_MV1 as number) || 0,
        tax_total: (a.TAX_TOT as number) || 0,
        tax_paid: (a.NET_TAX_PD as number) || 0,
        sale_price: (a.SALE_PRICE as number) || 0,
        sale_date: (a.SALE_DATE as string) || null,
        homestead_code: (a.HMSTD_CD1 as string) || null,
        property_type: (a.PR_TYP_NM1 as string) || null,
        priority,
        score,
        neighbor_left_name: neighborLeft.name,
        neighbor_left_value: neighborLeft.value,
        neighbor_left_homestead: neighborLeft.homestead,
        neighbor_right_name: neighborRight.name,
        neighbor_right_value: neighborRight.value,
        neighbor_right_homestead: neighborRight.homestead,
        county,
        raw_data: a,
        last_synced: new Date().toISOString(),
      });
    }

    // Step 3: Upsert into Supabase
    const { error } = await supabase
      .from("hg_slivers")
      .upsert(slivers, { onConflict: "pid" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Scan complete",
      total_parcels_scanned: features.length,
      slivers_saved: slivers.length,
      priority_1: slivers.filter((s) => s.priority === 1).length,
      priority_2: slivers.filter((s) => s.priority === 2).length,
      priority_3: slivers.filter((s) => s.priority === 3).length,
      high_score: slivers.filter((s) => s.score >= 70).length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
