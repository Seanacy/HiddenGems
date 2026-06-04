"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { supabase } from "@/lib/supabase";
import { getScoreLabel, getPriorityLabel, getCountyTier, COUNTY_WEALTH, getRentalScoreLabel, estimateAnnualTax } from "@/lib/scoring";
import { estimateAcquisitionCost, estimateResaleValue, estimateProfit, formatCost } from "@/lib/acquisition";
import { COUNTY_WEALTH as CW } from "@/lib/scoring";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const HENNEPIN_CENTER: [number, number] = [-93.35, 44.96];

type Mode = "flip" | "rent";

interface Sliver {
  id: string;
  pid: string;
  owner_name: string;
  taxpayer_name: string;
  address: string;
  city: string;
  parcel_area: number;
  lat: number;
  lng: number;
  forfeit_land: boolean;
  earliest_delinquent_year: string | null;
  market_value: number;
  building_value: number;
  tax_total: number;
  tax_paid: number;
  sale_price: number;
  sale_date: string | null;
  priority: number;
  score: number;
  neighbor_left_name: string;
  neighbor_left_value: number;
  neighbor_left_homestead: boolean;
  neighbor_right_name: string;
  neighbor_right_value: number;
  neighbor_right_homestead: boolean;
  county: string;
  // Rental fields
  rental_score: number;
  near_major_road: boolean;
  estimated_annual_tax: number;
  rental_income_low: number;
  rental_income_high: number;
  road_name: string;
}

export default function HomePage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const [slivers, setSlivers] = useState<Sliver[]>([]);
  const [selected, setSelected] = useState<Sliver | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"all" | 1 | 2 | 3>("all");
  const [county, setCounty] = useState("Hennepin");
  const [mode, setMode] = useState<Mode>("flip");

  // Load slivers from Supabase
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("hg_slivers")
        .select("*")
        .eq("county", county)
        .order("score", { ascending: false });
      setSlivers((data || []) as Sliver[]);
      setLoading(false);
    }
    load();
  }, [county]);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: HENNEPIN_CENTER,
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update markers — color changes based on mode
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const filtered = filter === "all" ? slivers : slivers.filter((s) => s.priority === filter);
    const sorted = [...filtered].sort((a, b) => {
      if (mode === "rent") return (b.rental_score || 0) - (a.rental_score || 0);
      return b.score - a.score;
    });

    sorted.forEach((sliver) => {
      if (!sliver.lat || !sliver.lng) return;

      let color: string;
      if (mode === "rent") {
        const rs = sliver.rental_score || 0;
        color = rs >= 60 ? "#22c55e" : rs >= 35 ? "#f59e0b" : "#6b7280";
      } else {
        color = sliver.priority === 1 ? "#f97316" : sliver.priority === 2 ? "#eab308" : "#6b7280";
      }

      const el = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.5)`;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([sliver.lng, sliver.lat])
        .addTo(mapRef.current!);

      el.addEventListener("click", () => {
        setSelected(sliver);
        mapRef.current?.flyTo({ center: [sliver.lng, sliver.lat], zoom: 17, duration: 1000 });
      });

      markersRef.current.push(marker);
    });
  }, [slivers, filter, mode]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch(`/api/scan?county=${county}`);
      const data = await res.json();
      console.log("Scan result:", data);

      const { data: fresh } = await supabase
        .from("hg_slivers")
        .select("*")
        .eq("county", county)
        .order("score", { ascending: false });
      setSlivers((fresh || []) as Sliver[]);
    } catch (err) {
      console.error("Scan failed:", err);
    }
    setScanning(false);
  };

  const filteredSlivers = filter === "all" ? slivers : slivers.filter((s) => s.priority === filter);
  const sortedSlivers = [...filteredSlivers].sort((a, b) => {
    if (mode === "rent") return (b.rental_score || 0) - (a.rental_score || 0);
    return b.score - a.score;
  });

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-[380px] flex-shrink-0 bg-[#0f1117] border-r border-[#252833] flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#252833]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold">
              <span className="text-[#f97316]">Hidden</span> Gems
            </h1>
            <button
              onClick={runScan}
              disabled={scanning}
              className="px-3 py-1.5 bg-[#f97316] text-white text-xs font-semibold rounded-lg hover:bg-[#ea580c] disabled:opacity-50"
            >
              {scanning ? "Scanning..." : "Scan"}
            </button>
          </div>

          {/* MODE TOGGLE — Flip vs Rent */}
          <div className="grid grid-cols-2 gap-1 mb-3 p-1 bg-[#1a1d27] rounded-lg">
            <button
              onClick={() => { setMode("flip"); setSelected(null); }}
              className={`py-2 rounded-md text-xs font-semibold transition-all ${
                mode === "flip"
                  ? "bg-[#f97316] text-white shadow-lg"
                  : "text-[#888] hover:text-white"
              }`}
            >
              Flip
            </button>
            <button
              onClick={() => { setMode("rent"); setSelected(null); }}
              className={`py-2 rounded-md text-xs font-semibold transition-all ${
                mode === "rent"
                  ? "bg-[#22c55e] text-white shadow-lg"
                  : "text-[#888] hover:text-white"
              }`}
            >
              Rent
            </button>
          </div>

          {/* County selector */}
          <select
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            className="w-full mb-2 px-3 py-2 bg-[#1a1d27] border border-[#252833] rounded-lg text-xs text-white focus:outline-none focus:border-[#f97316]"
          >
            <option value="Hennepin">Hennepin — Minneapolis, Edina, Plymouth ($138K)</option>
            <option value="Dakota">Dakota — Eagan, Lakeville, Burnsville ($131K)</option>
          </select>
          {COUNTY_WEALTH[county] && (
            <div className={`flex items-center gap-2 mb-3 px-3 py-1.5 rounded-lg text-[10px] ${
              getCountyTier(county) === "gold" ? "bg-yellow-500/10 text-yellow-400" :
              getCountyTier(county) === "silver" ? "bg-gray-400/10 text-gray-300" :
              "bg-orange-500/10 text-orange-300"
            }`}>
              <span className="font-bold">{getCountyTier(county) === "gold" ? "💎" : getCountyTier(county) === "silver" ? "⭐" : "🔹"}</span>
              <span>Avg income ${(COUNTY_WEALTH[county].avgIncome / 1000).toFixed(0)}K • Median ${(COUNTY_WEALTH[county].medianIncome / 1000).toFixed(0)}K • Score bonus +{getCountyTier(county) === "gold" ? "15" : getCountyTier(county) === "silver" ? "10" : "5"}</span>
            </div>
          )}

          {/* Stats — different per mode */}
          {mode === "flip" ? (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-[#f97316]">{slivers.filter((s) => s.priority === 1).length}</div>
                <div className="text-[9px] text-[#888]">Buy Now</div>
              </div>
              <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-[#eab308]">{slivers.filter((s) => s.priority === 2).length}</div>
                <div className="text-[9px] text-[#888]">Delinquent</div>
              </div>
              <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-white">{slivers.filter((s) => s.score >= 70).length}</div>
                <div className="text-[9px] text-[#888]">High Score</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-[#22c55e]">{slivers.filter((s) => (s.rental_score || 0) >= 60).length}</div>
                <div className="text-[9px] text-[#888]">Prime Rental</div>
              </div>
              <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-[#f59e0b]">{slivers.filter((s) => s.near_major_road).length}</div>
                <div className="text-[9px] text-[#888]">Near Road</div>
              </div>
              <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-white">{slivers.filter((s) => s.priority === 1 && (s.rental_score || 0) >= 35).length}</div>
                <div className="text-[9px] text-[#888]">Buy + Rent</div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col gap-1.5 mb-2">
            <button onClick={() => setFilter("all")} className={`w-full py-2 rounded-lg text-xs font-medium transition-colors ${filter === "all" ? (mode === "rent" ? "bg-[#22c55e] text-white" : "bg-[#f97316] text-white") : "bg-[#1a1d27] text-[#888] hover:text-white"}`}>
              All Parcels
            </button>
            <div className="grid grid-cols-3 gap-1.5">
              <button onClick={() => setFilter(1)} className={`py-3 rounded-lg text-center transition-colors ${filter === 1 ? "bg-[#f97316] text-white" : "bg-[#1a1d27] text-[#888] hover:text-white"}`}>
                <div className="text-xs font-bold">P1</div>
                <div className="text-[8px] mt-0.5 opacity-70">Buy Now</div>
                <div className="text-[7px] opacity-50">Gov owned</div>
              </button>
              <button onClick={() => setFilter(2)} className={`py-3 rounded-lg text-center transition-colors ${filter === 2 ? "bg-[#eab308] text-white" : "bg-[#1a1d27] text-[#888] hover:text-white"}`}>
                <div className="text-xs font-bold">P2</div>
                <div className="text-[8px] mt-0.5 opacity-70">Delinquent</div>
                <div className="text-[7px] opacity-50">5+ yrs unpaid</div>
              </button>
              <button onClick={() => setFilter(3)} className={`py-3 rounded-lg text-center transition-colors ${filter === 3 ? "bg-[#6b7280] text-white" : "bg-[#1a1d27] text-[#888] hover:text-white"}`}>
                <div className="text-xs font-bold">P3</div>
                <div className="text-[8px] mt-0.5 opacity-70">Flagged</div>
                <div className="text-[7px] opacity-50">Watch list</div>
              </button>
            </div>
          </div>

        </div>

        {/* List or Detail */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <div className="p-4">
              <button onClick={() => setSelected(null)} className="text-xs text-[#888] hover:text-white mb-4">← Back to list</button>

              {/* Score header — changes per mode */}
              {mode === "flip" ? (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-3xl font-bold" style={{ color: getScoreLabel(selected.score).color }}>{selected.score}</span>
                  <div>
                    <div className="text-xs font-medium" style={{ color: getScoreLabel(selected.score).color }}>{getScoreLabel(selected.score).label}</div>
                    <div className="text-[10px]" style={{ color: getPriorityLabel(selected.priority).color }}>{getPriorityLabel(selected.priority).label}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-3xl font-bold" style={{ color: getRentalScoreLabel(selected.rental_score || 0).color }}>{selected.rental_score || 0}</span>
                  <div>
                    <div className="text-xs font-medium" style={{ color: getRentalScoreLabel(selected.rental_score || 0).color }}>{getRentalScoreLabel(selected.rental_score || 0).label}</div>
                    <div className="text-[10px]" style={{ color: getPriorityLabel(selected.priority).color }}>{getPriorityLabel(selected.priority).label}</div>
                    {selected.near_major_road && <div className="text-[10px] text-[#22c55e] font-semibold">Near Major Road</div>}
                  </div>
                </div>
              )}

              <h2 className="text-base font-bold text-white mb-3">{selected.address || "No address"}</h2>

              {/* Road badge for rent mode */}
              {mode === "rent" && selected.near_major_road && (
                <div className="mb-3 px-3 py-2 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-lg">
                  <div className="text-[10px] text-[#22c55e] font-bold uppercase tracking-wider">High Visibility</div>
                  <div className="text-[11px] text-[#22c55e]/80 mt-0.5">{selected.road_name || selected.address} — road-facing parcel</div>
                </div>
              )}

              {/* Parcel details */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs"><span className="text-[#888]">PID</span><span className="text-white font-mono text-[10px]">{selected.pid}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">City</span><span className="text-white">{selected.city}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Area</span><span className="text-white font-semibold">{Math.round(selected.parcel_area)} sq ft</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Owner</span><span className="text-white">{selected.owner_name || "Unknown"}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Market Value</span><span className="text-white">${selected.market_value?.toLocaleString()}</span></div>
                {selected.forfeit_land && <div className="flex justify-between text-xs"><span className="text-[#888]">Forfeited</span><span className="text-[#f97316] font-bold">YES</span></div>}
                {selected.earliest_delinquent_year && <div className="flex justify-between text-xs"><span className="text-[#888]">Delinquent Since</span><span className="text-[#eab308]">20{selected.earliest_delinquent_year}</span></div>}
              </div>

              {/* Estimated Acquisition Cost — shown in both modes */}
              <div className="border-t border-[#252833] pt-3 mb-4">
                <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">Estimated Acquisition Cost</h4>
                {(() => {
                  const c = estimateAcquisitionCost(selected.market_value);
                  return (
                    <div className="bg-[#1a1d27] rounded-lg p-3">
                      <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Market Value</span><span className="text-white">${c.basePrice.toLocaleString()}</span></div>
                      <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">State Surcharge (3%)</span><span className="text-white">${c.surcharge.toFixed(2)}</span></div>
                      <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Deed Tax</span><span className="text-white">${c.deedTax.toFixed(2)}</span></div>
                      <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Fees (deed + recording + conservation)</span><span className="text-white">${c.fees}</span></div>
                      <div className="flex justify-between text-xs font-bold mt-2 pt-2 border-t border-[#252833]">
                        <span className="text-[#22c55e]">Total Est. Cost</span>
                        <span className="text-[#22c55e]">{formatCost(c.total)}</span>
                      </div>
                      {c.total > 0 && c.total < 500 && <div className="text-[9px] text-[#22c55e] mt-2 text-center bg-[#22c55e]/10 py-1 rounded">💎 Great deal — under $500</div>}
                    </div>
                  );
                })()}
              </div>

              {/* MODE-SPECIFIC SECTIONS */}
              {mode === "flip" ? (
                <>
                  {/* Neighbors */}
                  <div className="border-t border-[#252833] pt-3 mb-4">
                    <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">Neighbors (Potential Buyers)</h4>
                    {selected.neighbor_left_name ? (
                      <div className="bg-[#1a1d27] rounded-lg p-3 mb-2">
                        <div className="text-xs text-white font-medium">{selected.neighbor_left_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-[#f97316]">${selected.neighbor_left_value?.toLocaleString()}</span>
                          {selected.neighbor_left_homestead && <span className="text-[10px] text-green-400">Homesteaded</span>}
                        </div>
                      </div>
                    ) : null}
                    {selected.neighbor_right_name ? (
                      <div className="bg-[#1a1d27] rounded-lg p-3">
                        <div className="text-xs text-white font-medium">{selected.neighbor_right_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-[#f97316]">${selected.neighbor_right_value?.toLocaleString()}</span>
                          {selected.neighbor_right_homestead && <span className="text-[10px] text-green-400">Homesteaded</span>}
                        </div>
                      </div>
                    ) : null}
                    {!selected.neighbor_left_name && !selected.neighbor_right_name && (
                      <p className="text-[10px] text-[#555]">Neighbor data not loaded yet. Re-scan to populate.</p>
                    )}
                  </div>

                  {/* Resale & Profit */}
                  {(() => {
                    const c = estimateAcquisitionCost(selected.market_value);
                    const resale = estimateResaleValue(selected.parcel_area, selected.neighbor_left_value, selected.neighbor_right_value, CW[selected.county]?.avgIncome || 100000);
                    const profit = estimateProfit(c.total, resale.mid);
                    return (
                      <div className="border-t border-[#252833] pt-3 mb-4">
                        <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">Estimated Resale Value</h4>
                        <div className="bg-[#1a1d27] rounded-lg p-3">
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Per sq ft range</span><span className="text-white">${(resale.low / selected.parcel_area).toFixed(2)} - ${(resale.high / selected.parcel_area).toFixed(2)}/sqft</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Low estimate</span><span className="text-white">${resale.low.toLocaleString()}</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Mid estimate</span><span className="text-[#f97316] font-medium">${resale.mid.toLocaleString()}</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">High estimate</span><span className="text-white">${resale.high.toLocaleString()}</span></div>
                          <div className="flex justify-between text-xs font-bold mt-2 pt-2 border-t border-[#252833]">
                            <span className={profit.profit > 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>Est. Profit</span>
                            <span className={profit.profit > 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>{profit.profit > 0 ? "+" : ""}{formatCost(profit.profit)} ({profit.roi}% ROI)</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  {/* RENT MODE — Rental Income Estimate */}
                  <div className="border-t border-[#252833] pt-3 mb-4">
                    <h4 className="text-xs font-bold text-[#22c55e] uppercase tracking-wider mb-2">Rental Income Estimate</h4>
                    {(() => {
                      const annualTax = selected.estimated_annual_tax || estimateAnnualTax(selected.market_value);
                      const acq = estimateAcquisitionCost(selected.market_value);
                      const rLow = selected.rental_income_low || 0;
                      const rHigh = selected.rental_income_high || 0;
                      const annualLow = rLow * 4; // 4 months of rentals
                      const annualHigh = rHigh * 6; // 6 months of rentals
                      const netLow = annualLow - annualTax;
                      const netHigh = annualHigh - annualTax;
                      const paybackMonths = rLow > 0 ? Math.ceil(acq.total / rLow) : 0;
                      return (
                        <div className="bg-[#1a1d27] rounded-lg p-3">
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Monthly sign rental</span><span className="text-white font-medium">${rLow} - ${rHigh}/mo</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Annual income (4-6 mo)</span><span className="text-white">${annualLow} - ${annualHigh}</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Annual property tax</span><span className="text-[#ef4444]">-${annualTax.toFixed(2)}</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Annual maintenance</span><span className="text-[#ef4444]">-$30 (est.)</span></div>
                          <div className="flex justify-between text-xs font-bold mt-2 pt-2 border-t border-[#252833]">
                            <span className="text-[#22c55e]">Net Annual Profit</span>
                            <span className="text-[#22c55e]">${Math.round(netLow - 30)} - ${Math.round(netHigh - 30)}/yr</span>
                          </div>
                          {paybackMonths > 0 && (
                            <div className="text-[9px] text-[#22c55e] mt-2 text-center bg-[#22c55e]/10 py-1.5 rounded">
                              Payback in ~{paybackMonths} month{paybackMonths !== 1 ? "s" : ""} of rental • Then pure profit forever
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Who Would Rent */}
                  <div className="border-t border-[#252833] pt-3 mb-4">
                    <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">Potential Renters</h4>
                    <div className="space-y-1.5">
                      <div className="bg-[#1a1d27] rounded-lg px-3 py-2 flex justify-between items-center">
                        <span className="text-[10px] text-white">Political campaigns</span>
                        <span className="text-[10px] text-[#22c55e]">$100-300/season</span>
                      </div>
                      <div className="bg-[#1a1d27] rounded-lg px-3 py-2 flex justify-between items-center">
                        <span className="text-[10px] text-white">Realtors (open house signs)</span>
                        <span className="text-[10px] text-[#22c55e]">$50-100/mo</span>
                      </div>
                      <div className="bg-[#1a1d27] rounded-lg px-3 py-2 flex justify-between items-center">
                        <span className="text-[10px] text-white">Contractors / trades</span>
                        <span className="text-[10px] text-[#22c55e]">$25-75/mo</span>
                      </div>
                      <div className="bg-[#1a1d27] rounded-lg px-3 py-2 flex justify-between items-center">
                        <span className="text-[10px] text-white">Small businesses</span>
                        <span className="text-[10px] text-[#22c55e]">$50-150/mo</span>
                      </div>
                      <div className="bg-[#1a1d27] rounded-lg px-3 py-2 flex justify-between items-center">
                        <span className="text-[10px] text-white">Your own products (TentCity, BridgeWork)</span>
                        <span className="text-[10px] text-[#f97316]">Free promo</span>
                      </div>
                    </div>
                  </div>

                  {/* Holding Cost Breakdown */}
                  <div className="border-t border-[#252833] pt-3 mb-4">
                    <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">Annual Holding Cost</h4>
                    {(() => {
                      const annualTax = selected.estimated_annual_tax || estimateAnnualTax(selected.market_value);
                      return (
                        <div className="bg-[#1a1d27] rounded-lg p-3">
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Property tax</span><span className="text-white">${annualTax.toFixed(2)}/yr</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Mowing (4-6x summer)</span><span className="text-white">$0-60/yr</span></div>
                          <div className="flex justify-between text-[10px] mb-1"><span className="text-[#888]">Initial mulch + plants</span><span className="text-white">$20-50 (one-time)</span></div>
                          <div className="flex justify-between text-xs font-bold mt-2 pt-2 border-t border-[#252833]">
                            <span className="text-white">Total Annual Cost</span>
                            <span className="text-white">${annualTax.toFixed(0)} - ${(annualTax + 60).toFixed(0)}/yr</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}

              {/* County Contact — both modes */}
              <div className="border-t border-[#252833] pt-3 mb-4">
                <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider mb-2">County Contact</h4>
                <div className="bg-[#1a1d27] rounded-lg p-3">
                  {selected.county === "Hennepin" ? (
                    <>
                      <div className="text-xs text-white font-medium mb-1">Hennepin County Forfeited Land</div>
                      <div className="text-[10px] text-[#888] mb-1">612-348-3011</div>
                      <a href="https://www.hennepin.us/residents/property/forfeited-land" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#f97316] hover:underline">hennepin.us/forfeited-land →</a>
                    </>
                  ) : selected.county === "Dakota" ? (
                    <>
                      <div className="text-xs text-white font-medium mb-1">Dakota County Property Taxation</div>
                      <div className="text-[10px] text-[#888] mb-1">651-438-4576</div>
                      <div className="text-[10px] text-[#888] mb-1">taxation@co.dakota.mn.us</div>
                      <a href="https://www.co.dakota.mn.us/HomeProperty/Forfeited" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#f97316] hover:underline">dakota.mn.us/forfeited →</a>
                    </>
                  ) : (
                    <div className="text-[10px] text-[#555]">Contact the {selected.county} County Auditor/Treasurer</div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <a href={selected.county === "Dakota" ? `https://www.co.dakota.mn.us/HomeProperty/Forfeited` : `https://gis.hennepin.us/property/?pid=${selected.pid}`} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 bg-[#f97316] text-white text-xs font-semibold rounded-lg hover:bg-[#ea580c]">
                  View on {selected.county} County
                </a>
                <a href={`https://maps.google.com/?q=${selected.lat},${selected.lng}`} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 bg-[#1a1d27] text-[#888] text-xs font-medium rounded-lg hover:text-white border border-[#252833]">
                  Open in Google Maps
                </a>
              </div>
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-[#555] text-sm">Loading...</div>
          ) : slivers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-2xl mb-2">💎</p>
              <p className="text-[#888] text-sm mb-3">No gems found yet</p>
              <p className="text-[#555] text-xs">Click &quot;Scan&quot; to search for sliver parcels</p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-4 py-2 text-[10px] text-[#555]">{sortedSlivers.length} parcels • sorted by {mode === "rent" ? "rental score" : "flip score"}</div>
              {sortedSlivers.map((sliver) => {
                const cost = estimateAcquisitionCost(sliver.market_value);

                if (mode === "rent") {
                  // RENT MODE LIST ITEM
                  const rentalInfo = getRentalScoreLabel(sliver.rental_score || 0);
                  const annualTax = sliver.estimated_annual_tax || estimateAnnualTax(sliver.market_value);
                  return (
                    <button
                      key={sliver.id}
                      onClick={() => {
                        setSelected(sliver);
                        mapRef.current?.flyTo({ center: [sliver.lng, sliver.lat], zoom: 17, duration: 1000 });
                      }}
                      className={`w-full text-left px-4 py-3 border-b border-[#252833] hover:bg-[#1a1d27] transition-colors ${
                        selected?.id === sliver.id ? "bg-[#1a1d27]" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white truncate">{sliver.address || sliver.pid}</span>
                        <span className="text-xs font-bold" style={{ color: rentalInfo.color }}>{sliver.rental_score || 0}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: rentalInfo.color + "22", color: rentalInfo.color }}>
                          {rentalInfo.label}
                        </span>
                        {sliver.near_major_road && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#22c55e]/15 text-[#22c55e]">
                            Road
                          </span>
                        )}
                        <span className="text-[10px] text-[#555]">{sliver.city}</span>
                      </div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[10px] text-[#888]">📐 <span className="text-white font-medium">{Math.round(sliver.parcel_area)} sq ft</span></span>
                        <span className="text-[10px] text-[#888]">Buy: <span className="text-white font-medium">{formatCost(cost.total)}</span></span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-[#888]">Tax: <span className="text-white">${annualTax.toFixed(0)}/yr</span></span>
                        <span className="text-[10px] text-[#888]">Rent: <span className="text-[#22c55e] font-medium">${sliver.rental_income_low || 0}-${sliver.rental_income_high || 0}/mo</span></span>
                      </div>
                    </button>
                  );
                }

                // FLIP MODE LIST ITEM
                const scoreInfo = getScoreLabel(sliver.score);
                const priorityInfo = getPriorityLabel(sliver.priority);
                return (
                  <button
                    key={sliver.id}
                    onClick={() => {
                      setSelected(sliver);
                      mapRef.current?.flyTo({ center: [sliver.lng, sliver.lat], zoom: 17, duration: 1000 });
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-[#252833] hover:bg-[#1a1d27] transition-colors ${
                      selected?.id === sliver.id ? "bg-[#1a1d27]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white truncate">{sliver.address || sliver.pid}</span>
                      <span className="text-xs font-bold" style={{ color: scoreInfo.color }}>{sliver.score}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: priorityInfo.color + "22", color: priorityInfo.color }}>
                        {priorityInfo.label}
                      </span>
                      <span className="text-[10px] text-[#555]">{sliver.city}</span>
                    </div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-[10px] text-[#888]">📐 <span className="text-white font-medium">{Math.round(sliver.parcel_area)} sq ft</span></span>
                      {sliver.priority === 1 && <span className="text-[10px] text-yellow-400">💎</span>}
                      {sliver.owner_name && <span className="text-[10px] text-[#555] truncate">{sliver.owner_name}</span>}
                    </div>
                    {(() => {
                      const resale = estimateResaleValue(sliver.parcel_area, sliver.neighbor_left_value, sliver.neighbor_right_value, CW[sliver.county]?.avgIncome || 100000);
                      const profit = estimateProfit(cost.total, resale.mid);
                      return (
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-[#888]">Cost: <span className="text-white font-medium">{formatCost(cost.total)}</span></span>
                          <span className="text-[10px] text-[#888]">Sell: <span className="text-[#f97316] font-medium">${resale.low}-${resale.high}</span></span>
                          <span className={`text-[10px] font-bold ${profit.profit > 0 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                            {profit.profit > 0 ? "+" : ""}{formatCost(profit.profit)}
                          </span>
                        </div>
                      );
                    })()}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
