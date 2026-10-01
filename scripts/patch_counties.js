// Bring the us-atlas county topology up to the county equivalents BLS uses:
// Connecticut's eight legacy counties become the nine planning regions (FIPS
// 09110 to 09190, the county equivalents since 2022) and Alaska's former
// Valdez-Cordova census area (02261) becomes Chugach (02063) and Copper River
// (02066), so the LAUS county table and the 2023 CBSA delineations match the map.
//   node scripts/patch_counties.js
// Reads build/counties-albers-10m.json (downloaded from us-atlas if missing) and
// the new boundaries from the Census TIGERweb service (or GeoJSON files named by
// CT_REGIONS_GEOJSON and AK_AREAS_GEOJSON); writes the patched topology to build/
// and docs/lib/. Idempotent: a topology that already has 09110 is left alone.
const fs = require("fs");
const path = require("path");
const d3 = require("../docs/lib/d3.v7.min.js");
const topojson = require("../docs/lib/topojson-client.min.js");
const { topology } = require("topojson-server");
const { presimplify, simplify } = require("topojson-simplify");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const TOPO = path.join(BUILD, "counties-albers-10m.json");
const ATLAS = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json";
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query"
  + "?outFields=GEOID,NAME,BASENAME&f=geojson&outSR=4326&where=";
// [ids to remove, ids to add, TIGERweb where clause, env var with a local GeoJSON]
const SWAPS = [
  [/^09\d{3}$/, /^091[1-9]0$/, "STATE%3D%2709%27", "CT_REGIONS_GEOJSON"],
  [/^02261$/, /^020(63|66)$/, "GEOID%20IN%20(%2702063%27,%2702066%27)", "AK_AREAS_GEOJSON"],
];
const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]); // as us-atlas bakes it

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  if (!fs.existsSync(TOPO)) {
    console.log("downloading us-atlas counties");
    fs.writeFileSync(TOPO, await (await fetch(ATLAS)).text());
  }
  const topo = JSON.parse(fs.readFileSync(TOPO));
  if (topo.objects.counties.geometries.some((g) => g.id === "09110")) { console.log("already patched"); return; }

  let counties = topojson.feature(topo, topo.objects.counties).features;
  for (const [drop, keep, where, envVar] of SWAPS) {
    const src = process.env[envVar] ? JSON.parse(fs.readFileSync(process.env[envVar])) : await (await fetch(TIGER + where)).json();
    const added = src.features.filter((f) => keep.test(f.properties.GEOID));
    if (!added.length) throw new Error(`no features for ${where}`);
    // project to the atlas grid, then simplify to the atlas's level of detail
    const projected = added.map((f) => ({
      type: "Feature", id: f.properties.GEOID,
      properties: { name: f.properties.BASENAME || f.properties.NAME },
      geometry: projectGeometry(f.geometry),
    }));
    let t = topology({ x: { type: "FeatureCollection", features: projected } }, 1e5);
    t = simplify(presimplify(t), 0.12);
    const before = counties.length;
    counties = counties.filter((f) => !drop.test(String(f.id))).concat(topojson.feature(t, t.objects.x).features);
    console.log(`${envVar.split("_")[0]}: removed ${before - counties.length + projected.length}, added ${projected.length}`);
  }
  const objects = {
    counties: { type: "FeatureCollection", features: counties },
    states: topojson.feature(topo, topo.objects.states),
    nation: topojson.feature(topo, topo.objects.nation),
  };
  const out = topology(objects, 1e5);
  out.bbox = topo.bbox;
  const json = JSON.stringify(out);
  fs.writeFileSync(TOPO, json);
  fs.writeFileSync(path.join(ROOT, "docs", "lib", "counties-albers-10m.json"), json);
  const n = out.objects.counties.geometries.length;
  console.log(`patched: ${n} counties, ${out.arcs.length} arcs, ${(json.length / 1024).toFixed(0)} KB`);
}

function projectGeometry(g) {
  const ring = (r) => r.map((p) => projection(p)).filter(Boolean).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(ring) };
  return { type: "MultiPolygon", coordinates: g.coordinates.map((poly) => poly.map(ring)) };
}

main().catch((e) => { console.error(e); process.exit(1); });
