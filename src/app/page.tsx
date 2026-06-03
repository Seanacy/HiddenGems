"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { supabase } from "@/lib/supabase";
import { getScoreLabel, getPriorityLabel } from "@/lib/scoring";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const HENNEPIN_CENTER: [number, number] = [-93.35, 44.96];

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
  const [sortBy, setSortBy] = useState<"score" | "area" | "tax">("score");

  // Load slivers from Supabase
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("hg_slivers")
        .select("*")
        .order("score", { ascending: false });
      setSlivers((data || []) as Sliver[]);
      setLoading(false);
    }
    load();
  }, []);

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

  // Update markers
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const filtered = filter === "all" ? slivers : slivers.filter((s) => s.priority === filter);
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "area") return a.parcel_area - b.parcel_area;
      return a.tax_total - b.tax_total;
    });

    sorted.forEach((sliver) => {
      if (!sliver.lat || !sliver.lng) return;

      const color = sliver.priority === 1 ? "#f97316" : sliver.priority === 2 ? "#eab308" : "#6b7280";

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
  }, [slivers, filter, sortBy]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scan");
      const data = await res.json();
      console.log("Scan result:", data);

      // Reload slivers
      const { data: fresh } = await supabase
        .from("hg_slivers")
        .select("*")
        .order("score", { ascending: false });
      setSlivers((fresh || []) as Sliver[]);
    } catch (err) {
      console.error("Scan failed:", err);
    }
    setScanning(false);
  };

  const filteredCount = filter === "all" ? slivers.length : slivers.filter((s) => s.priority === filter).length;

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
              {scanning ? "Scanning..." : "Scan County"}
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-[#1a1d27] rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-[#f97316]">{slivers.filter((s) => s.priority === 1).length}</div>
              <div className="text-[9px] text-[#888]">Forfeited</div>
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

          {/* Filters */}
          <div className="flex gap-1 mb-2">
            {([["all", "All"], [1, "P1"], [2, "P2"], [3, "P3"]] as const).map(([val, label]) => (
              <button
                key={String(val)}
                onClick={() => setFilter(val)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  filter === val ? "bg-[#f97316] text-white" : "bg-[#1a1d27] text-[#888] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="flex gap-1">
            {([["score", "Score"], ["area", "Size"], ["tax", "Tax"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSortBy(val)}
                className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                  sortBy === val ? "bg-[#252833] text-white" : "text-[#555] hover:text-[#888]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* List or Detail */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <div className="p-4">
              <button onClick={() => setSelected(null)} className="text-xs text-[#888] hover:text-white mb-4">← Back to list</button>

              <div className="flex items-center gap-2 mb-3">
                <span className="text-3xl font-bold" style={{ color: getScoreLabel(selected.score).color }}>{selected.score}</span>
                <div>
                  <div className="text-xs font-medium" style={{ color: getScoreLabel(selected.score).color }}>{getScoreLabel(selected.score).label}</div>
                  <div className="text-[10px]" style={{ color: getPriorityLabel(selected.priority).color }}>{getPriorityLabel(selected.priority).label}</div>
                </div>
              </div>

              <h2 className="text-base font-bold text-white mb-3">{selected.address || "No address"}</h2>

              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs"><span className="text-[#888]">PID</span><span className="text-white font-mono text-[10px]">{selected.pid}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">City</span><span className="text-white">{selected.city}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Area</span><span className="text-white font-semibold">{Math.round(selected.parcel_area)} sq ft</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Owner</span><span className="text-white">{selected.owner_name || "Unknown"}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Taxpayer</span><span className="text-white">{selected.taxpayer_name || "Unknown"}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Tax Owed</span><span className="text-[#f97316] font-semibold">${selected.tax_total?.toFixed(2)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Tax Paid</span><span className="text-white">${selected.tax_paid?.toFixed(2)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#888]">Market Value</span><span className="text-white">${selected.market_value?.toLocaleString()}</span></div>
                {selected.forfeit_land && <div className="flex justify-between text-xs"><span className="text-[#888]">Forfeited</span><span className="text-[#f97316] font-bold">YES</span></div>}
                {selected.earliest_delinquent_year && <div className="flex justify-between text-xs"><span className="text-[#888]">Delinquent Since</span><span className="text-[#eab308]">20{selected.earliest_delinquent_year}</span></div>}
                {selected.sale_price > 0 && <div className="flex justify-between text-xs"><span className="text-[#888]">Last Sale</span><span className="text-white">${selected.sale_price?.toLocaleString()}</span></div>}
              </div>

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

              <div className="flex flex-col gap-2">
                <a href={`https://gis.hennepin.us/property/?pid=${selected.pid}`} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 bg-[#f97316] text-white text-xs font-semibold rounded-lg hover:bg-[#ea580c]">
                  View on Hennepin GIS
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
              <p className="text-[#555] text-xs">Click "Scan County" to search Hennepin County for sliver parcels</p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-4 py-2 text-[10px] text-[#555]">{filteredCount} parcels</div>
              {(filter === "all" ? [...slivers] : slivers.filter((s) => s.priority === filter))
                .sort((a: Sliver, b: Sliver) => {
                  if (sortBy === "score") return b.score - a.score;
                  if (sortBy === "area") return a.parcel_area - b.parcel_area;
                  return a.tax_total - b.tax_total;
                })
                .map((sliver) => {
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
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-[#888]">📐 <span className="text-white font-medium">{Math.round(sliver.parcel_area)} sq ft</span></span>
                        <span className="text-[10px] text-[#888]">💰 <span className="text-[#f97316] font-medium">${sliver.tax_total?.toFixed(2)}</span></span>
                        {sliver.owner_name && <span className="text-[10px] text-[#555] truncate">{sliver.owner_name}</span>}
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Map + Detail */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* No floating detail panel — detail is now in sidebar */}
      </div>
    </div>
  );
}
