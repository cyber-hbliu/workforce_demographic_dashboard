// Merge Census counties into metro-area footprints on the pre-projected
// us-atlas Albers grid the state map already uses, and derive a map anchor
// for each metro. Output: docs/lib/metros-albers.json
//   { "<cbsa>": { "a": [x, y], "g": GeoJSON geometry } }
// Run after scripts/build_areas.py:  node scripts/build_geo.js
const fs = require("fs");
const path = require("path");
const d3 = require("../docs/lib/d3.v7.min.js");
const topojson = require("../docs/lib/topojson-client.min.js");

const ROOT = path.join(__dirname, "..");
const topo = JSON.parse(fs.readFileSync(path.join(ROOT, "build/counties-albers-10m.json")));
const membership = JSON.parse(fs.readFileSync(path.join(ROOT, "build/cbsa_counties.json")));
const areas = JSON.parse(fs.readFileSync(path.join(ROOT, "config/areas.json")));

// identical to the projection us-atlas *-albers-10m files are baked with
const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
const planar = d3.geoPath(); // null projection = planar measures
const byId = new Map(topo.objects.counties.geometries.map((g) => [g.id, g]));
const round = (v) => Math.round(v * 10) / 10;
const roundGeom = (g) => ({
  type: g.type,
  coordinates: JSON.parse(JSON.stringify(g.coordinates), (k, v) => (typeof v === "number" ? round(v) : v)),
});

const out = {};
let bytes = 0;
for (const m of areas.metros) {
  const mem = membership[m.cbsa];
  if (!mem || !mem.counties.length) { console.warn(`no counties for ${m.cbsa} ${m.name}`); continue; }
  const geoms = mem.counties.map((id) => byId.get(id)).filter(Boolean);
  const merged = topojson.merge(topo, geoms);
  let anchor;
  if (m.lon != null && m.lat != null) {
    anchor = projection([m.lon, m.lat]);
  } else {
    const central = (mem.central.length ? mem.central : mem.counties).map((id) => byId.get(id)).filter(Boolean);
    anchor = planar.centroid(topojson.merge(topo, central));
  }
  if (!anchor || anchor.some((v) => !isFinite(v))) { console.warn(`bad anchor for ${m.cbsa}`); continue; }
  out[m.cbsa] = { a: anchor.map(round), g: roundGeom(merged) };
}
const json = JSON.stringify(out);
bytes = Buffer.byteLength(json);
fs.writeFileSync(path.join(ROOT, "docs/lib/metros-albers.json"), json);
console.log(`${Object.keys(out).length} metro footprints, ${(bytes / 1024).toFixed(0)} KB`);
