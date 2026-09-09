/* Workforce Snapshot — app.js
   A full-screen atlas with three lenses:
     industry      markers sized by nonfarm jobs; pop-out = industry rose + specialty
     unemployment  states and MSAs shaded by unemployment rate; pop-out = trend + standing
     earnings      shaded by real earnings growth (hourly earnings vs regional CPI);
                   pop-out = earnings by industry + earnings vs prices
   Each MSA is a marker (diamond = holds a state capital, hollow ring = no
   industry series). Click a marker or a state to open its profile.
   Data: docs/data/*.json (scripts/fetch_bls.py). Geometry: us-atlas albers
   states + MSA footprints merged from Census county delineations. */

(async function () {
  const boot = document.getElementById("boot");
  const load = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  const optional = (u) => load(u).catch(() => null);
  let meta, national, states, metros, rose, topo, geo, releases, earn;
  try {
    [meta, national, states, metros, rose, topo, geo, releases, earn] = await Promise.all([
      load("data/meta.json"), load("data/national.json"), load("data/states.json"), load("data/metros.json"),
      load("data/rose.json"), load("lib/states-albers-10m.json"), load("lib/metros-albers.json"),
      optional("data/release_dates.json"), optional("data/earnings.json"),
    ]);
  } catch (e) {
    boot.textContent = `Could not load the data files (${e.message}). If this is a fresh deploy, run the "Update BLS data" workflow once.`;
    boot.classList.add("is-error");
    return;
  }
  boot.remove();

  /* ------------------------------------------------------------ constants */
  const SECTORS = [
    ["20000000", "Construction", "Constr.", ["Construction"]],
    ["30000000", "Manufacturing", "Manuf.", ["Manufacturing"]],
    ["40000000", "Trade, Transportation & Utilities", "Trade & transport", ["Trade, Transportation", "& Utilities"]],
    ["50000000", "Information", "Information", ["Information"]],
    ["55000000", "Financial Activities", "Finance", ["Financial Activities"]],
    ["60000000", "Professional & Business Services", "Prof. & business", ["Professional &", "Business Services"]],
    ["65000000", "Education & Health Services", "Educ. & health", ["Education &", "Health Services"]],
    ["70000000", "Leisure & Hospitality", "Leisure & hosp.", ["Leisure &", "Hospitality"]],
    ["80000000", "Other Services", "Other services", ["Other Services"]],
    ["90000000", "Government", "Government", ["Government"]],
  ];
  const N = SECTORS.length;
  const angleOf = (i) => (i / N) * 2 * Math.PI - Math.PI / 2;
  const SHARE_MAX = 0.3;
  const US_SHARE = new Map((national.industries || []).map((d) => [d.code, d.share]));
  const STATE_NAME = (fips) => states[fips]?.name || fips;
  const REGION_NAME = { US: "United States", "0100": "Northeast", "0200": "Midwest", "0300": "South", "0400": "West" };

  const GREEN = "#148f62", PINK = "#d4417f", NEUTRAL = "#b5b3ab";
  const toGreen = d3.interpolateRgb(NEUTRAL, GREEN), toPink = d3.interpolateRgb(NEUTRAL, PINK);
  const lqColor = (lq) => {
    if (lq == null || !isFinite(lq)) return NEUTRAL;
    const t = Math.max(-1, Math.min(1, Math.log2(lq)));
    return t < 0 ? toGreen(-t) : toPink(t);
  };
  // real earnings growth in percentage points: positive (ahead of prices) green, negative pink
  const realColor = (pt) => {
    if (pt == null || !isFinite(pt)) return "#e6e4dc";
    const t = Math.max(-1, Math.min(1, pt / 3));
    return t >= 0 ? toGreen(t) : toPink(-t);
  };
  const BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  const rampColor = d3.scaleLinear().range(BLUE_RAMP).interpolate(d3.interpolateRgb);

  const fmtNum = d3.format(",");
  const fmtK = (v) => (v >= 1000 ? d3.format(",.1f")(v / 1000) + "M" : d3.format(",.0f")(v) + "k");
  const fmtBig = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : fmtNum(v));
  const fmtPct = (v) => (v * 100).toFixed(1) + "%";
  const fmtSignedPct = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`);
  const fmtUsd = (v) => "$" + v.toFixed(2);
  const fmtMonth = (d) => {
    if (!d) return "";
    const [y, m] = d.split("-");
    return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  };
  const fmtMonthLong = (d) => (d ? new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }) : "");
  const last = (rows) => (rows && rows.length ? rows[rows.length - 1] : null);
  const back = (rows, n) => (rows && rows.length > n ? rows[rows.length - 1 - n] : null);
  const atMonth = (rows, month) => { for (let i = (rows || []).length - 1; i >= 0; i--) if (rows[i].date <= month) return rows[i]; return null; };
  const yearBefore = (month) => `${+month.slice(0, 4) - 1}${month.slice(4)}`;
  const parse = d3.timeParse("%Y-%m");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const signed = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pt`;
  const deltaHtml = (now, prev, label) => now && prev
    ? `<b class="${now.value > prev.value ? "up" : now.value < prev.value ? "down" : ""}">${signed(now.value - prev.value)}</b> ${label}`
    : "";

  /* ------------------------------------------------------------ app state */
  const app = { lens: "industry", level: null, id: null, roseView: "chart" };
  const metroList = Object.entries(metros).map(([id, m]) => ({ id, ...m }));
  const profileOf = (level, id) =>
    level === "metro" ? rose.metros[id] || [] : level === "state" ? rose.states[id] || [] : national.industries || [];
  const seriesOf = (level, id) => (level === "metro" ? metros[id]?.series : level === "state" ? states[id]?.series : national);
  const rateOfState = (fips) => last(states[fips]?.series.unemp_rate)?.value ?? null;
  const rateOfMetro = (id) => last(metros[id]?.series.unemp_rate)?.value ?? null;
  const jobsOf = (level, id) => {
    const p = profileOf(level, id);
    const tot = last(seriesOf(level, id)?.payrolls);
    return tot ? tot.value : d3.sum(p, (d) => d.jobs);
  };
  const geoType = (m) => (m.kind === "micro" ? "Micropolitan Statistical Area" : "Metropolitan Statistical Area");
  const geoShort = (m) => (m.kind === "micro" ? "µSA" : "MSA");
  const capitalText = (m) => (m.capital_of || []).map((c) => `${c.city}, capital of ${c.state === "11" ? "the United States" : STATE_NAME(c.state)}`).join(" · ");
  const countyText = (id) => {
    const c = geo[id]?.c || [];
    if (!c.length) return "";
    const shown = c.length > 6 ? c.slice(0, 6).join(", ") + ` and ${c.length - 6} more` : c.join(", ");
    return `${c.length} ${c.length === 1 ? "county" : "counties"}: ${shown}`;
  };

  // earnings helpers (earnings.json may not exist until the next data refresh)
  const earnOf = (level, id) => (!earn ? null : level === "metro" ? earn.metros?.[id] : level === "state" ? earn.states?.[id] : earn.national) || null;
  const cpiOf = (region) => earn?.cpi?.[region] || earn?.cpi?.US || [];
  function earningsSummary(level, id) {
    const e = earnOf(level, id);
    const now = last(e?.total);
    if (!e || !now) return null;
    const prev = atMonth(e.total, yearBefore(now.date));
    const cpi = cpiOf(e.region), cNow = atMonth(cpi, now.date), cPrev = cNow ? atMonth(cpi, yearBefore(cNow.date)) : null;
    const wageYoy = prev && prev.value ? (now.value - prev.value) / prev.value : null;
    const cpiYoy = cNow && cPrev && cPrev.value ? (cNow.value - cPrev.value) / cPrev.value : null;
    return { e, now, wageYoy, cpiYoy, cpiMonth: cNow?.date, real: wageYoy != null && cpiYoy != null ? (wageYoy - cpiYoy) * 100 : null };
  }
  const realOfState = (fips) => earningsSummary("state", fips)?.real ?? null;
  const realOfMetro = (id) => earningsSummary("metro", id)?.real ?? null;

  /* -------------------------------------------------------------- tooltip */
  const tip = document.getElementById("tip");
  const showTip = (html, ev) => {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - w - 12) + "px";
    tip.style.top = (ev.clientY + 16 + h > innerHeight ? ev.clientY - h - 12 : ev.clientY + 16) + "px";
  };
  const hideTip = () => (tip.hidden = true);

  /* ------------------------------------------------------------ masthead */
  const latestMonth = [meta.latest_state_month, meta.latest_metro_month, meta.latest_ces_month].filter(Boolean).sort().pop();
  document.getElementById("release-month").textContent = latestMonth ? fmtMonthLong(latestMonth) : "–";
  const usNow = last(national.unemp_rate), usM1 = back(national.unemp_rate, 1), usY1 = back(national.unemp_rate, 12);
  const usPj = last(national.payrolls_sa) || last(national.payrolls), usPjM1 = back(national.payrolls_sa, 1);
  document.getElementById("us-kpis").innerHTML =
    `<div class="kpi"><dt>Nonfarm employment</dt><dd>${usPj ? fmtBig(usPj.value * 1000) : "–"}</dd><div class="kpi-sub">${usPj ? `jobs · ${esc(fmtMonth(usPj.date))}` : ""}</div>
      ${usPj && usPjM1 ? `<span class="kpi-delta"><b>${usPj.value - usPjM1.value >= 0 ? "+" : "−"}${fmtNum(Math.abs(Math.round(usPj.value - usPjM1.value)))}k</b> vs ${esc(fmtMonth(usPjM1.date))}</span>` : ""}</div>
     <div class="kpi"><dt>Unemployment rate</dt><dd>${usNow ? `${usNow.value.toFixed(1)}<small>%</small>` : "–"}</dd><div class="kpi-sub">${usNow ? esc(fmtMonth(usNow.date)) : ""}</div>
      ${usM1 ? `<span class="kpi-delta">${deltaHtml(usNow, usM1, "vs " + fmtMonth(usM1.date))}</span>` : ""}
      ${usY1 ? `<span class="kpi-delta">${deltaHtml(usNow, usY1, "vs " + fmtMonth(usY1.date))}</span>` : ""}</div>`;
  const updated = document.getElementById("updated");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = releases ? ["state", "metro"].flatMap((k) => (releases[k] || []).map((d) => [d, k])).filter(([d]) => d >= today).sort() : [];
  const next = upcoming[0];
  if (meta.source === "sample") {
    updated.textContent = "Sample data — run the Update BLS data workflow to load real figures.";
    updated.classList.add("is-sample");
  } else {
    updated.innerHTML = `Data pulled <b>${esc(meta.updated)}</b>${next ? ` · next BLS release <b>${esc(next[0])}</b> (${next[1]} figures)` : ""}`;
  }
  document.getElementById("nation-stat").onclick = () => select("nation", null);

  /* ------------------------------------------------------------------ map */
  const W = 975, H = 610;
  const svg = d3.select("#map");
  const zoomLayer = svg.append("g").attr("class", "zoom-layer");
  const path = d3.geoPath();
  const stateFeatures = topojson.feature(topo, topo.objects.states).features.filter((f) => states[f.id]);
  const stateById = new Map(stateFeatures.map((f) => [f.id, f]));

  const statesG = zoomLayer.append("g");
  const statePaths = statesG.selectAll("path").data(stateFeatures).join("path")
    .attr("class", "state").attr("d", path)
    .on("mousemove", (ev, d) => showTip(stateTip(d.id), ev))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { ev.stopPropagation(); select("state", d.id); });
  zoomLayer.append("path").attr("class", "nation-outline")
    .attr("d", path(topojson.mesh(topo, topo.objects.states, (a, b) => a === b)));

  const LABEL_NUDGE = { "26": [22, 30], "12": [14, 8], "22": [-10, 0], "24": [6, -6], "51": [10, 6], "23": [-4, 6] };
  const stateLabels = zoomLayer.append("g").attr("class", "state-labels").selectAll("text").data(stateFeatures).join("text")
    .attr("class", "state-label")
    .each(function (d) {
      const [cx, cy] = path.centroid(d), [nx, ny] = LABEL_NUDGE[d.id] || [0, 0];
      const [[x0], [x1]] = path.bounds(d);
      d.labelX = cx + nx; d.labelY = cy + ny; d.labelW = x1 - x0;
    })
    .text((d) => states[d.id].name.toUpperCase());

  const footG = zoomLayer.append("g");
  const footPaths = footG.selectAll("path").data(metroList.filter((m) => geo[m.id])).join("path")
    .attr("class", "footprint").attr("d", (m) => path(geo[m.id].g));

  // markers sized by nonfarm jobs (industry lens)
  const rGlyph = d3.scaleSqrt().domain([0, 8000]).range([0, 16]).clamp(true);
  const glyphR = (m) => Math.max(3.5, rGlyph(jobsOf("metro", m.id)));
  const glyphsG = zoomLayer.append("g").attr("class", "glyph-layer");
  const glyphData = metroList.filter((m) => geo[m.id]).sort((a, b) => glyphR(b) - glyphR(a));
  const glyphs = glyphsG.selectAll("g.glyph").data(glyphData, (m) => m.id).join("g")
    .attr("class", (m) => "glyph" + (profileOf("metro", m.id).length ? "" : " no-industry"))
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", (m) => `${m.name} ${geoType(m)}${capitalText(m) ? ", " + capitalText(m) : ""}`)
    .on("mousemove", (ev, m) => showTip(metroTip(m), ev))
    .on("mouseleave", hideTip)
    .on("click", (ev, m) => { ev.stopPropagation(); select("metro", m.id); })
    .on("keydown", (ev, m) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select("metro", m.id); } });
  glyphs.each(function (m) {
    const g = d3.select(this), R = glyphR(m), prof = profileOf("metro", m.id);
    const inner = g.append("g").attr("class", "burst");
    const capital = m.capital_of && m.capital_of.length;
    inner.append("circle").attr("class", "halo").attr("r", R + 4);
    if (!prof.length) inner.append("circle").attr("class", "ring").attr("r", Math.max(3.2, R));
    else if (capital) { const s = R * 1.25; inner.append("path").attr("class", "core").attr("d", `M0,${-s}L${s},0L0,${s}L${-s},0Z`); }
    else inner.append("circle").attr("class", "core").attr("r", R);
    inner.append("circle").attr("class", "hit").attr("r", Math.max(R + 5, 10));
    g.append("text").attr("class", "glyph-label").attr("y", R * 1.25 + 11).text(m.short);
  });

  // shaded dots for the unemployment and earnings lenses
  const rDot = d3.scaleSqrt().domain([0, 10_000_000]).range([0, 15]).clamp(true);
  const udotsG = zoomLayer.append("g").attr("class", "udot-layer").style("display", "none");
  const udots = udotsG.selectAll("circle").data(glyphData, (m) => m.id).join("circle")
    .attr("class", "udot")
    .attr("r", (m) => Math.max(2.5, rDot(last(m.series.labor_force)?.value ?? 0)))
    .on("mousemove", (ev, m) => showTip(metroTip(m), ev))
    .on("mouseleave", hideTip)
    .on("click", (ev, m) => { ev.stopPropagation(); select("metro", m.id); });

  // hover card: name, then three big figures
  function bigFigures(level, id) {
    const r = level === "metro" ? rateOfMetro(id) : rateOfState(id);
    const prof = profileOf(level, id), es = earningsSummary(level, id);
    const top = prof.filter((d) => d.lq != null).sort((a, b) => b.lq - a.lq)[0];
    return `<div class="tip-figs">
      <div><span class="fig">${r != null ? r.toFixed(1) + "<small>%</small>" : "–"}</span><span class="lab">unemployment rate</span></div>
      <div><span class="fig ${es && es.wageYoy != null ? (es.wageYoy >= 0 ? "up" : "down") : ""}">${es ? fmtSignedPct(es.wageYoy) : "–"}</span><span class="lab">hourly earnings, y/y${es ? ` · ${fmtUsd(es.now.value)}` : ""}</span></div>
      <div><span class="fig fig-text" style="color:${top ? lqColor(top.lq) : "#fff"}">${top ? esc(top.industry) : "–"}</span><span class="lab">regional specialty${top ? ` · ${top.lq.toFixed(2)}× the U.S.` : " · no industry series"}</span></div>
    </div>`;
  }
  function stateTip(fips) {
    return `<b>${esc(states[fips].name)}</b><div class="muted">State · statewide figures</div>${bigFigures("state", fips)}`;
  }
  function metroTip(m) {
    const cap = capitalText(m);
    return `<b>${esc(m.name)}</b><div class="muted">${geoType(m)}${cap ? ` · ${esc(cap)}` : ""}</div>${bigFigures("metro", m.id)}
      <div class="muted" style="margin-top:8px">Click to open the profile</div>`;
  }

  /* ---------------------------------------------------------------- zoom */
  const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[-W * 0.8, -H * 0.8], [W * 1.8, H * 1.8]])
    .wheelDelta((ev) => -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.deltaMode ? 1 : 0.0012))
    .on("zoom", (ev) => applyZoom(ev.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("click", () => { if (app.level) select(null, null); });
  let k = 1, labelFrame = 0;
  function applyZoom(t) {
    k = t.k;
    zoomLayer.attr("transform", t);
    const s = Math.pow(k, -0.62);
    glyphs.attr("transform", (m) => `translate(${geo[m.id].a}) scale(${s})`);
    udots.attr("transform", (m) => `translate(${geo[m.id].a}) scale(${s})`);
    const ls = Math.pow(k, -0.5);
    stateLabels.attr("transform", (d) => `translate(${d.labelX},${d.labelY}) scale(${ls})`)
      .style("display", (d) => (d.labelW * Math.sqrt(k) >= states[d.id].name.length * 5.2 ? null : "none"));
    if (!labelFrame) labelFrame = requestAnimationFrame(() => { labelFrame = 0; layoutLabels(t, s); });
  }
  function layoutLabels(t, s) {
    const placed = [];
    glyphs.select(".glyph-label").style("display", (m) => {
      const R = glyphR(m);
      if (R * Math.pow(k, 0.6) < 3) return "none";
      const [ax, ay] = geo[m.id].a;
      const x = ax * k + t.x, y = (ay + (R * 1.25 + 11) * s) * k + t.y;
      const w = m.short.length * 5.4 * s * k + 4, h = 11 * s * k;
      const box = [x - w / 2, y - h, x + w / 2, y + 2];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) return "none";
      placed.push(box);
      return null;
    });
  }
  applyZoom(d3.zoomIdentity);
  const zoomTo = (bounds, maxK = 7) => {
    const [[x0, y0], [x1, y1]] = bounds;
    const kk = Math.min(maxK, 0.75 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    const t = d3.zoomIdentity.translate(W / 2 - kk * (x0 + x1) / 2, H / 2 - kk * (y0 + y1) / 2).scale(kk);
    svg.transition().duration(750).call(zoom.transform, t);
  };
  function keepVisible(pt) {
    if (!pt) return;
    const t = d3.zoomTransform(svg.node());
    const box = svg.node().getBoundingClientRect();
    const scale = Math.min(box.width / W, box.height / H);
    const ox = (box.width - W * scale) / 2, oy = (box.height - H * scale) / 2;
    const sx = box.left + ox + (pt[0] * t.k + t.x) * scale, sy = box.top + oy + (pt[1] * t.k + t.y) * scale;
    const drawerW = innerWidth > 900 ? 560 : 0, drawerH = innerWidth > 900 ? 0 : innerHeight * 0.76;
    let dx = 0, dy = 0;
    if (sx > innerWidth - drawerW) dx = (innerWidth - drawerW) / 2 - sx;
    if (sy > innerHeight - drawerH - 20) dy = (innerHeight - drawerH) / 2 - sy;
    if (dx || dy) svg.transition().duration(600).call(zoom.translateBy, dx / scale / t.k, dy / scale / t.k);
  }
  const eased = () => svg.transition().duration(500).ease(d3.easeCubicOut);
  document.getElementById("zoom-in").onclick = () => eased().call(zoom.scaleBy, 1.5);
  document.getElementById("zoom-out").onclick = () => eased().call(zoom.scaleBy, 1 / 1.5);
  document.getElementById("zoom-reset").onclick = () => svg.transition().duration(700).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity);

  /* ---------------------------------------------------------------- lens */
  const legend = document.getElementById("legend");
  const rateExtent = d3.extent(stateFeatures.map((f) => rateOfState(f.id)).filter((v) => v != null));
  if (rateExtent[0] != null) rampColor.domain(d3.range(7).map((i) => rateExtent[0] + (i / 6) * (rateExtent[1] - rateExtent[0])));

  function renderLens() {
    const lens = app.lens, ind = lens === "industry";
    statePaths.attr("fill", (d) => ind ? null
      : lens === "unemployment" ? (rateOfState(d.id) != null ? rampColor(rateOfState(d.id)) : "#e6e4dc")
      : realColor(realOfState(d.id)));
    footG.style("display", ind ? null : "none");
    glyphsG.style("display", ind ? null : "none");
    udotsG.style("display", ind ? "none" : null);
    udots.attr("fill", (m) => lens === "unemployment"
      ? (rateOfMetro(m.id) != null ? rampColor(rateOfMetro(m.id)) : "#e6e4dc")
      : realColor(realOfMetro(m.id)));
    document.querySelectorAll(".lens-btn").forEach((b) => {
      const on = b.dataset.lens === lens;
      b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on);
    });
    legend.innerHTML = ind ? industryLegend() : lens === "unemployment" ? unemploymentLegend() : earningsLegend();
    if (app.level) renderDrawer(); // the pop-out follows the lens
  }
  function industryLegend() {
    const sizes = [100, 1000, 5000].map((j) => [j, rGlyph(j)]);
    let s = `<svg width="290" height="46" viewBox="0 0 290 46">`, x = 14;
    for (const [j, r] of sizes) {
      s += `<circle cx="${x + r}" cy="23" r="${r}" fill="#d6ce76" stroke="#b3aa66" stroke-width="1.2"/><text x="${x + r}" y="43" text-anchor="middle">${j >= 1000 ? j / 1000 + "M" : j + "k"}</text>`;
      x += r * 2 + 26;
    }
    s += `<path d="M${x + 8},13 L${x + 18},23 L${x + 8},33 L${x - 2},23 Z" fill="#0b0b0b"/><text x="${x + 8}" y="43" text-anchor="middle">capital</text>`;
    x += 44;
    s += `<circle cx="${x + 6}" cy="23" r="5" fill="#fcfcfb" stroke="#0b0b0b"/><text x="${x + 6}" y="43" text-anchor="middle">no CES</text></svg>`;
    return `<p class="legend-title">Industry · map markers, one per MSA</p>
      <div class="legend-key">${s}</div>
      <p class="legend-note"><b>Size</b> = total nonfarm jobs · <b>diamond</b> = the area holds a state capital ·
      <b>hollow ring</b> = BLS publishes unemployment but no industry series · <b>grey outline</b> = the MSA's county footprint.
      Click a marker to open its industry rose.</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${GREEN},${NEUTRAL},${PINK})"></div>
      <div class="legend-ramp-labels"><span>rose: ½× the U.S. %</span><span>same</span><span>2× or more</span></div>`;
  }
  function unemploymentLegend() {
    const [lo, hi] = rateExtent;
    return `<p class="legend-title">Unemployment rate · ${esc(fmtMonth(meta.latest_state_month))}</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${BLUE_RAMP.join(",")})"></div>
      <div class="legend-ramp-labels"><span>${lo != null ? lo.toFixed(1) + "%" : ""}</span><span>states, seasonally adjusted</span><span>${hi != null ? hi.toFixed(1) + "%" : ""}</span></div>
      <p class="legend-note" style="margin-top:8px"><b>Dots</b> are MSAs, sized by labor force and shaded by their own (not seasonally adjusted) rate. Click one for its ten-year trend and where it ranks.</p>`;
  }
  function earningsLegend() {
    if (!earn) return `<p class="legend-title">Earnings vs prices</p><p class="legend-note">Hourly-earnings and CPI series arrive with the next data refresh (run the "Update BLS data" workflow).</p>`;
    const m = last(earn.national?.total)?.date;
    return `<p class="legend-title">Real earnings growth · ${esc(fmtMonth(m))}</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${PINK},${NEUTRAL},${GREEN})"></div>
      <div class="legend-ramp-labels"><span>−3 pt: trailing prices</span><span>keeping pace</span><span>+3 pt: ahead</span></div>
      <p class="legend-note" style="margin-top:8px">Year-on-year change in <b>average hourly earnings</b> (private employers, CES) minus the change in the <b>CPI</b> for the area's census region. States shaded, MSAs as dots sized by labor force. Click one for earnings by industry.</p>`;
  }
  document.querySelectorAll(".lens-btn").forEach((b) => (b.onclick = () => { app.lens = b.dataset.lens; renderLens(); }));

  /* -------------------------------------------------------------- search */
  const searchEl = document.getElementById("search"), resultsEl = document.getElementById("search-results");
  const index = [
    ...metroList.map((m) => ({ level: "metro", id: m.id, label: m.name, sub: [geoType(m), capitalText(m)].filter(Boolean).join(" · "), kind: geoShort(m),
      text: `${m.short} ${m.name} ${(m.capital_of || []).map((c) => c.city + " capital").join(" ")}`.toLowerCase() })),
    ...Object.entries(states).map(([id, s]) => ({ level: "state", id, label: s.name, sub: "Statewide", kind: "State", text: s.name.toLowerCase() })),
  ];
  searchEl.oninput = () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) { resultsEl.hidden = true; return; }
    const hits = index.filter((d) => d.text.includes(q))
      .sort((a, b) => (a.text.startsWith(q) ? 0 : 1) - (b.text.startsWith(q) ? 0 : 1) || a.label.localeCompare(b.label)).slice(0, 8);
    resultsEl.innerHTML = hits.map((h) => `<li><button type="button" data-level="${h.level}" data-id="${h.id}"><span>${esc(h.label)}<span class="sub">${esc(h.sub)}</span></span><span class="kind">${esc(h.kind)}</span></button></li>`).join("")
      || `<li><button type="button" disabled>No match</button></li>`;
    resultsEl.hidden = false;
  };
  resultsEl.onclick = (ev) => {
    const b = ev.target.closest("button[data-id]");
    if (!b) return;
    resultsEl.hidden = true; searchEl.value = "";
    select(b.dataset.level, b.dataset.id, true);
  };
  searchEl.onkeydown = (ev) => {
    if (ev.key === "Enter") { const b = resultsEl.querySelector("button[data-id]"); if (b) b.click(); }
    if (ev.key === "Escape") { resultsEl.hidden = true; searchEl.blur(); }
  };
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".search-wrap")) resultsEl.hidden = true; });

  /* ------------------------------------------------------------ selection */
  const drawer = document.getElementById("drawer"), body = document.getElementById("drawer-body");
  document.getElementById("drawer-close").onclick = () => select(null, null);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && app.level) select(null, null); });

  function select(level, id, fly = false) {
    app.level = level; app.id = id;
    hideTip();
    statePaths.classed("is-selected", (d) => level === "state" && d.id === id);
    footPaths.classed("is-selected", (m) => level === "metro" && m.id === id)
      .classed("is-dim", (m) => level === "state" && !(m.states || []).includes(id));
    glyphs.classed("is-selected", (m) => level === "metro" && m.id === id)
      .classed("is-dim", (m) => level === "state" && !(m.states || []).includes(id));
    udots.classed("is-selected", (m) => level === "metro" && m.id === id);
    if (level) {
      renderDrawer();
      drawer.classList.add("is-open"); drawer.setAttribute("aria-hidden", "false");
      document.body.classList.add("drawer-open");
      body.scrollTop = 0;
      if (fly) {
        if (level === "metro" && geo[id]) zoomTo(path.bounds(geo[id].g), 6);
        else if (level === "state") zoomTo(path.bounds(stateById.get(id)), 4);
      } else if (level !== "nation") {
        keepVisible(level === "metro" ? geo[id]?.a : path.centroid(stateById.get(id)));
      }
      history.replaceState(null, "", `#${level}=${id ?? ""}`);
    } else {
      drawer.classList.remove("is-open"); drawer.setAttribute("aria-hidden", "true");
      document.body.classList.remove("drawer-open");
      document.title = "USA Workforce Snapshot · Urban Spatial Lab";
      history.replaceState(null, "", location.pathname);
    }
  }

  /* --------------------------------------------------------------- drawer */
  function renderDrawer() {
    const { level, id, lens } = app;
    const sel = level === "metro" ? metros[id] : level === "state" ? states[id] : null;
    const series = seriesOf(level, id);
    const now = last(series.unemp_rate), m1 = back(series.unemp_rate, 1), y1 = back(series.unemp_rate, 12);
    const name = level === "nation" ? "United States" : sel.name;
    const geoTag = level === "nation" ? "Nation" : level === "state" ? "State" : geoType(sel);
    const monthTag = now ? now.date : rose.month;
    document.title = `${name} · USA Workforce Snapshot · ${fmtMonth(monthTag)}`;

    let geoLine = "";
    if (level === "metro") {
      const cty = countyText(id);
      geoLine = `<b>${esc(geoShort(sel))} figures</b> cover the whole ${sel.kind === "micro" ? "micropolitan" : "metropolitan"} area${cty ? ` (${esc(cty)})` : ""}, not the city of ${esc(sel.short)} alone.`;
    } else if (level === "state") {
      geoLine = `<b>Statewide figures</b>, seasonally adjusted.`;
    } else {
      geoLine = `<b>National figures</b> from the Current Population Survey (seasonally adjusted) and Current Employment Statistics.`;
    }
    const sub = level === "metro" ? capitalText(sel) :
      level === "state" ? `Capital: ${(metroList.find((m) => (m.capital_of || []).some((c) => c.state === id))?.capital_of.find((c) => c.state === id)?.city) || "–"}` : "";
    const persons = level === "nation" ? 1000 : 1;
    const lf = last(series.labor_force), em = last(series.employed);
    const tiles = [
      ["Labor force", lf ? fmtNum(Math.round(lf.value * persons)) : "–", lf ? fmtMonth(lf.date) : "", ""],
      ["Employment", em ? fmtNum(Math.round(em.value * persons)) : "–", em ? fmtMonth(em.date) : "", ""],
      ["Unemployment rate", now ? `${now.value.toFixed(1)}<small>%</small>` : "–", now ? fmtMonth(now.date) : "",
        (m1 ? `<span class="kpi-delta">${deltaHtml(now, m1, "vs " + fmtMonth(m1.date))}</span>` : "") +
        (y1 ? `<span class="kpi-delta">${deltaHtml(now, y1, "vs " + fmtMonth(y1.date))}</span>` : "")],
    ];
    const lensTitle = { industry: "Industry", unemployment: "Unemployment", earnings: "Earnings" }[lens];

    body.innerHTML = `
      <p class="d-tags"><span class="d-tag">${esc(fmtMonthLong(monthTag))} release</span><span class="d-tag d-tag-geo">${esc(geoTag)}</span><span class="d-tag d-tag-geo">${lensTitle} lens</span></p>
      <h2 class="d-name">${esc(name)}</h2>
      <p class="d-geo">${geoLine}</p>
      ${sub ? `<p class="d-sub">${esc(sub)}</p>` : ""}
      ${level === "state" ? stateMetroChips(id) : ""}
      ${lens === "earnings" ? "" : `<dl class="kpis kpis-3">${tiles.map(([k, v, s, extra]) => `<div class="kpi"><dt>${k}</dt><dd>${v}</dd><div class="kpi-sub">${esc(s)}</div>${extra}</div>`).join("")}</dl>`}
      <div id="lens-host"></div>
      <p class="d-foot">${level === "metro" ? `${esc(geoShort(sel))} unemployment is not seasonally adjusted; state and national rates are. ` : ""}${
        lens === "earnings" ? "Average hourly earnings are for all employees of private employers (Current Employment Statistics, not seasonally adjusted). Prices are the CPI-U for the area's census region, all items, not seasonally adjusted; real growth is the difference between the two year-on-year changes."
        : lens === "unemployment" ? "Unemployment figures are from the Local Area Unemployment Statistics program (Current Population Survey for the nation). Rankings compare the latest published month."
        : `Industry percentages are from the Current Employment Statistics (not seasonally adjusted); "vs U.S." divides an industry's local percentage of jobs by its national percentage.${level === "metro" && sel.kind === "micro" ? " BLS does not publish industry series for micropolitan areas." : ""}`}</p>`;

    const host = document.getElementById("lens-host");
    if (lens === "industry") renderIndustrySection(host, level, id);
    else if (lens === "unemployment") renderUnemploymentSection(host, level, id, name);
    else renderEarningsSection(host, level, id, name);
  }
  body.addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-select-metro]");
    if (c) select("metro", c.dataset.selectMetro, true);
  });

  /* ------------------------------------------------------ industry lens */
  function renderIndustrySection(host, level, id) {
    const prof = profileOf(level, id), jobs = jobsOf(level, id), jobsRow = last(seriesOf(level, id).payrolls);
    host.innerHTML = `<section class="d-section">
        <div class="d-section-head"><div><div class="d-section-title">Industry structure</div><div class="d-section-sub">${prof.length ? `% of nonfarm jobs${jobsRow ? ` · ${fmtNum(Math.round(jobs))}k jobs` : ""} · ${esc(fmtMonth(jobsRow ? jobsRow.date : rose.month))}` : ""}</div></div>
          ${prof.length ? `<div class="view-toggle" id="rose-toggle"><button data-v="chart" class="${app.roseView === "chart" ? "is-active" : ""}">Rose</button><button data-v="table" class="${app.roseView === "table" ? "is-active" : ""}">Table</button></div>` : ""}</div>
        <div id="rose-host"></div><div id="dominant-host"></div></section>`;
    if (!prof.length) {
      document.getElementById("rose-host").innerHTML = `<p class="rose-note">BLS publishes no industry employment series for this area, so only the unemployment picture is shown.</p>`;
      return;
    }
    document.getElementById("rose-toggle").onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; app.roseView = b.dataset.v; renderDrawer(); };
    if (app.roseView === "table") renderTable(prof, jobs); else renderRose(prof);
    renderDominant(prof, level);
  }
  function stateMetroChips(fips) {
    const list = metroList.filter((m) => (m.states || []).includes(fips)).sort((a, b) => jobsOf("metro", b.id) - jobsOf("metro", a.id));
    if (!list.length) return "";
    return `<div class="chips-inline"><span class="chips-label">Metropolitan areas in ${esc(STATE_NAME(fips))} on this map</span>
      <div class="chips">${list.map((m) => `<button class="chip" data-select-metro="${m.id}"><b>${esc(m.short)}</b> ${esc(geoShort(m))}${(m.capital_of || []).some((c) => c.state === fips) ? `<span class="cap">capital</span>` : ""}</button>`).join("")}</div></div>`;
  }
  function renderRose(prof) {
    const host = d3.select("#rose-host").html("");
    const SW = 560, SH = 470, R = 138, cx = SW / 2, cy = SH / 2 + 6;
    const svgR = host.append("div").attr("class", "rose-wrap").append("svg").attr("viewBox", `0 0 ${SW} ${SH}`);
    const g = svgR.append("g").attr("transform", `translate(${cx},${cy})`);
    const rs = d3.scaleSqrt().domain([0, SHARE_MAX]).range([0, R]);
    const byCode = new Map(prof.map((d) => [d.code, d]));
    const step = (2 * Math.PI) / N;
    const lead = prof.filter((d) => d.lq != null && d.lq > 1.05).sort((a, b) => b.lq - a.lq)[0];
    for (const s of [0.05, 0.1, 0.2, 0.3]) g.append("circle").attr("class", "rose-ring").attr("r", rs(s));
    SECTORS.forEach((_, i) => {
      const a = angleOf(i) - step / 2;
      g.append("line").attr("class", "rose-spoke").attr("x2", (R + 4) * Math.cos(a)).attr("y2", (R + 4) * Math.sin(a));
    });
    const ra = angleOf(0) + step / 2;
    for (const sh of [0.1, 0.2, 0.3])
      g.append("text").attr("class", "rose-ring-label").attr("text-anchor", "start").attr("x", rs(sh) * Math.cos(ra) + 2).attr("y", rs(sh) * Math.sin(ra) - 2).text(sh * 100 + "%");
    const arc = d3.arc().innerRadius(0).padAngle(0.012).padRadius(R).cornerRadius(2)
      .startAngle((i) => angleOf(i) + Math.PI / 2 - step / 2 + 0.01).endAngle((i) => angleOf(i) + Math.PI / 2 + step / 2 - 0.01);
    const petals = g.selectAll(".petal").data(SECTORS.map(([code], i) => ({ i, d: byCode.get(code) })).filter((x) => x.d)).join("path")
      .attr("class", "petal").attr("fill", ({ d }) => lqColor(d.lq)).attr("fill-opacity", 0.95)
      .attr("d", ({ i, d }) => arc.outerRadius(rs(Math.min(d.share, SHARE_MAX)))(i))
      .on("mousemove", (ev, { d }) => showTip(petalTip(d), ev))
      .on("mouseleave", () => { hideTip(); petals.classed("is-dim", false); })
      .on("mouseenter", (_, x) => petals.classed("is-dim", (y) => y !== x));
    if (US_SHARE.size) {
      const refArc = d3.arc().innerRadius((i) => rs(US_SHARE.get(SECTORS[i][0]) || 0) - 0.8).outerRadius((i) => rs(US_SHARE.get(SECTORS[i][0]) || 0) + 0.8)
        .startAngle((i) => angleOf(i) + Math.PI / 2 - step / 2 + 0.02).endAngle((i) => angleOf(i) + Math.PI / 2 + step / 2 - 0.02);
      g.selectAll(".rose-ref").data(SECTORS.map((_, i) => i)).join("path").attr("class", "rose-ref").attr("d", (i) => refArc(i));
    }
    SECTORS.forEach(([code, , , lines], i) => {
      const d = byCode.get(code); if (!d) return;
      const a = angleOf(i), lr = R + 14, x = lr * Math.cos(a), y = lr * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.25 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      const total = lines.length + 1, lh = 13;
      const y0 = y - ((total - 1) * lh) / 2 + 4 + (Math.abs(Math.cos(a)) < 0.25 ? (Math.sin(a) < 0 ? -8 : 8) : 0);
      const t = g.append("text").attr("class", "rose-label" + (lead && lead.code === code ? " is-lead" : "")).attr("text-anchor", anchor);
      lines.forEach((ln, j) => t.append("tspan").attr("x", x).attr("y", y0 + j * lh).text(ln));
      t.append("tspan").attr("class", "rose-value").attr("x", x).attr("y", y0 + lines.length * lh).text(`${fmtPct(d.share)}${d.lq != null ? ` · ${d.lq.toFixed(2)}×` : ""}`);
    });
    host.append("div").attr("class", "rose-legend").html(
      `<span><i></i>the U.S. mix</span><span><span style="color:${GREEN}">■</span> below the U.S. %</span><span><span style="color:${PINK}">■</span> above the U.S. %</span><span>× = local % ÷ U.S. %</span>`);
  }
  function petalTip(d) {
    return `<b>${esc(d.industry)}</b>
      <div class="row"><span class="muted">Jobs</span><span>${fmtNum(Math.round(d.jobs))}k</span></div>
      <div class="row"><span class="muted">% of nonfarm jobs</span><span>${fmtPct(d.share)}</span></div>
      ${d.lq != null ? `<div class="row"><span class="muted">vs U.S. %</span><span>${d.lq.toFixed(2)}× (U.S. ${fmtPct(US_SHARE.get(d.code) || 0)})</span></div>` : ""}`;
  }
  function renderTable(prof, total) {
    const rows = SECTORS.map(([code]) => prof.find((d) => d.code === code)).filter(Boolean);
    document.getElementById("rose-host").innerHTML = `<table class="ind-table"><thead><tr><th>Industry</th><th>Jobs (k)</th><th>% of jobs</th><th>vs U.S. %</th></tr></thead>
      <tbody>${rows.map((d) => `<tr><td><span class="sw" style="background:${lqColor(d.lq)}"></span>${esc(d.industry)}</td><td>${fmtNum(Math.round(d.jobs))}</td><td>${fmtPct(d.share)}</td><td>${d.lq != null ? d.lq.toFixed(2) + "×" : "–"}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total nonfarm</td><td>${fmtNum(Math.round(total))}</td><td></td><td></td></tr></tfoot></table>`;
  }
  function renderDominant(prof, level) {
    const host = document.getElementById("dominant-host");
    const largest = [...prof].sort((a, b) => b.share - a.share)[0];
    const withLq = prof.filter((d) => d.lq != null);
    const lead = [...withLq].sort((a, b) => b.lq - a.lq)[0];
    if (level === "nation" || !lead) {
      host.innerHTML = `<div class="dominant"><p class="dom-label">Largest sector</p><p class="dom-name">${esc(largest.industry)}</p>
        <p class="dom-stat"><b>${fmtPct(largest.share)}</b> of nonfarm jobs · <b>${fmtNum(Math.round(largest.jobs))}k</b> jobs. The national mix is the reference every area is compared with.</p></div>`;
      return;
    }
    const us = US_SHARE.get(lead.code) || 0, maxPct = Math.max(lead.share, us) || 1;
    const runnersUp = withLq.filter((d) => d !== lead && d !== largest && d.lq >= 1.15).sort((a, b) => b.lq - a.lq).slice(0, 2);
    host.innerHTML = `<div class="dominant">
      <p class="dom-label">Regional specialty · most concentrated vs the U.S.</p>
      <p class="dom-name">${esc(lead.industry)}</p>
      <p class="dom-stat"><b>${fmtPct(lead.share)}</b> of nonfarm jobs (<b>${fmtNum(Math.round(lead.jobs))}k</b>), <b>${lead.lq.toFixed(2)}×</b> the U.S. percentage of ${fmtPct(us)}.</p>
      <div class="dom-bars">
        <span>Here</span><div class="bar" style="width:${(lead.share / maxPct) * 100}%"></div><span class="val">${fmtPct(lead.share)}</span>
        <span>U.S.</span><div class="bar us" style="width:${(us / maxPct) * 100}%"></div><span class="val">${fmtPct(us)}</span>
      </div>
      <p class="dom-second">${largest.code === lead.code ? `It is also the <b>largest employer</b> in the area.`
        : `Largest employer: <b>${esc(largest.industry)}</b>, ${fmtPct(largest.share)} of jobs (${largest.lq != null ? largest.lq.toFixed(2) + "× the U.S." : "–"}).`}
        ${runnersUp.length ? ` Also concentrated: ${runnersUp.map((d) => `<b>${esc(d.industry)}</b> ${d.lq.toFixed(2)}×`).join(", ")}.` : ""}</p></div>`;
  }

  /* -------------------------------------------------- unemployment lens */
  function renderUnemploymentSection(host, level, id, name) {
    const series = seriesOf(level, id);
    const now = last(series.unemp_rate), y1 = back(series.unemp_rate, 12);
    const un = last(series.unemployed), unY = back(series.unemployed, 12), lf = last(series.labor_force), lfY = back(series.labor_force, 12);
    const persons = level === "nation" ? 1000 : 1;
    // where the area stands among its peers
    let standing = "";
    if (level !== "nation" && now) {
      const peers = level === "metro"
        ? metroList.map((m) => [m.id, rateOfMetro(m.id)]).filter(([, r]) => r != null)
        : Object.keys(states).map((f) => [f, rateOfState(f)]).filter(([, r]) => r != null);
      peers.sort((a, b) => a[1] - b[1]);
      const rank = peers.findIndex(([pid]) => pid === id) + 1, n = peers.length;
      const lo = peers[0][1], hi = peers[n - 1][1], pos = hi > lo ? ((now.value - lo) / (hi - lo)) * 100 : 50;
      const usr = last(national.unemp_rate);
      standing = `<div class="standing"><p class="dom-label">Where it stands · ${esc(fmtMonth(now.date))}</p>
        <div class="rank-strip"><i style="left:${pos.toFixed(1)}%"></i></div>
        <div class="rank-labels"><span>lowest ${lo.toFixed(1)}%</span><span>highest ${hi.toFixed(1)}%</span></div>
        <p><b>${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th"} lowest</b> unemployment rate of the ${n} ${level === "metro" ? "metropolitan areas on this map" : "states"}${usr ? `, ${now.value === usr.value ? "equal to" : now.value < usr.value ? `${(usr.value - now.value).toFixed(1)} pt below` : `${(now.value - usr.value).toFixed(1)} pt above`} the U.S. rate of ${usr.value.toFixed(1)}%` : ""}.</p>
        ${un && unY ? `<p>Unemployed: <b>${fmtNum(Math.round(un.value * persons))}</b>, ${un.value >= unY.value ? "up" : "down"} <b>${fmtNum(Math.abs(Math.round((un.value - unY.value) * persons)))}</b> from a year earlier${lf && lfY ? `; labor force ${lf.value >= lfY.value ? "grew" : "shrank"} <b>${fmtSignedPct((lf.value - lfY.value) / lfY.value)}</b>` : ""}.</p>` : ""}
      </div>`;
    } else if (level === "nation" && un && unY) {
      standing = `<div class="standing"><p class="dom-label">Change over the year</p>
        <p>Unemployed: <b>${fmtNum(Math.round(un.value * persons))}</b>, ${un.value >= unY.value ? "up" : "down"} <b>${fmtNum(Math.abs(Math.round((un.value - unY.value) * persons)))}</b> from ${esc(fmtMonth(unY.date))}${lf && lfY ? `; labor force ${fmtSignedPct((lf.value - lfY.value) / lfY.value)}` : ""}.</p></div>`;
    }
    host.innerHTML = `<section class="d-section">
        <div class="d-section-head"><div class="d-section-title">Ten-year unemployment trend</div><div class="d-section-sub">${level === "nation" ? "monthly rate" : "vs the United States"}</div></div>
        <div class="trend-wrap" id="trend-host"></div>${standing}</section>
      ${level === "state" ? stateMetroRates(id) : ""}`;
    renderTrend(series.unemp_rate || [], level === "nation" ? null : national.unemp_rate, name);
  }
  function stateMetroRates(fips) {
    const list = metroList.filter((m) => (m.states || []).includes(fips) && rateOfMetro(m.id) != null).sort((a, b) => rateOfMetro(a.id) - rateOfMetro(b.id));
    if (!list.length) return "";
    return `<section class="d-section"><div class="d-section-head"><div class="d-section-title">Metropolitan areas in ${esc(STATE_NAME(fips))}</div><div class="d-section-sub">unemployment rate, lowest first</div></div>
      <div class="metro-rates">${list.map((m) => `<button data-select-metro="${m.id}">${esc(m.short)} <span class="kind">${esc(geoShort(m))}</span></button><span class="v">${rateOfMetro(m.id).toFixed(1)}%</span>`).join("")}</div></section>`;
  }
  function renderTrend(selRows, natRows, name) {
    const host = d3.select("#trend-host").html("");
    const sel = selRows.map((d) => ({ t: parse(d.date), v: d.value }));
    const nat = (natRows || []).map((d) => ({ t: parse(d.date), v: d.value }));
    if (!sel.length) { host.append("p").attr("class", "rose-note").text("No unemployment series published for this area."); return; }
    lineChart(host, [{ key: name, rows: sel, cls: "trend-sel" }, ...(nat.length ? [{ key: "U.S.", rows: nat, cls: "trend-nat" }] : [])], (v) => v.toFixed(1) + "%", (v) => v + "%");
  }
  // one-axis line chart with a crosshair readout; series = [{key, rows:[{t,v}], cls}]
  function lineChart(host, series, fmtVal, fmtTick, yDomain) {
    const W = 448, H = 180, M = { t: 12, r: 60, b: 22, l: 34 };
    const svgT = host.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const all = series.flatMap((s) => s.rows);
    const x = d3.scaleTime().domain(d3.extent(all, (d) => d.t)).range([M.l, W - M.r]);
    const y = d3.scaleLinear().domain(yDomain || [0, d3.max(all, (d) => d.v)]).nice().range([H - M.b, M.t]);
    const line = d3.line().x((d) => x(d.t)).y((d) => y(d.v)).curve(d3.curveMonotoneX);
    svgT.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - M.l - M.r)).tickFormat(fmtTick));
    svgT.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8));
    [...series].reverse().forEach((s) => svgT.append("path").attr("class", s.cls).attr("d", line(s.rows)));
    const ends = series.map((s) => ({ s, e: s.rows[s.rows.length - 1] })).map((o) => ({ ...o, yy: y(o.e.v) }));
    if (ends.length === 2 && Math.abs(ends[0].yy - ends[1].yy) < 12) { const mid = (ends[0].yy + ends[1].yy) / 2, dir = ends[0].yy <= ends[1].yy ? -1 : 1; ends[0].yy = mid + dir * 6; ends[1].yy = mid - dir * 6; }
    ends.forEach(({ s, e, yy }, i) => {
      if (i === 0) svgT.append("circle").attr("cx", x(e.t)).attr("cy", y(e.v)).attr("r", 4).attr("fill", "#0b0b0b").attr("stroke", "#fcfcfb").attr("stroke-width", 2);
      svgT.append("text").attr("class", "trend-end" + (i ? " nat" : "")).attr("x", x(e.t) + 7).attr("y", yy + 3.5).text(s.key.length > 10 ? (i ? s.key : "Selected") : s.key);
    });
    const cross = svgT.append("line").attr("class", "crosshair").attr("y1", M.t).attr("y2", H - M.b).style("display", "none");
    const bisect = d3.bisector((d) => d.t).center;
    svgT.append("rect").attr("class", "trend-hit").attr("x", M.l).attr("y", 0).attr("width", W - M.l - M.r).attr("height", H)
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev), t = x.invert(mx);
        const pts = series.map((s) => ({ s, p: s.rows[bisect(s.rows, t)] }));
        cross.style("display", null).attr("x1", x(pts[0].p.t)).attr("x2", x(pts[0].p.t));
        showTip(`<b>${pts[0].p.t.toLocaleString("en-US", { month: "short", year: "numeric" })}</b>` +
          pts.map(({ s, p }, i) => `<div class="row"><span><i style="background:${i ? NEUTRAL : "#0b0b0b"}"></i>${esc(s.key)}</span><span>${fmtVal(p.v)}</span></div>`).join(""), ev);
      })
      .on("mouseleave", () => { cross.style("display", "none"); hideTip(); });
  }

  /* ------------------------------------------------------ earnings lens */
  function renderEarningsSection(host, level, id, name) {
    const es = earningsSummary(level, id);
    if (!es) {
      host.innerHTML = `<section class="d-section"><div class="d-section-head"><div class="d-section-title">Earnings vs prices</div></div>
        <p class="rose-note">${earn ? "BLS publishes no hourly-earnings series for this area." : "Hourly-earnings and CPI series arrive with the next data refresh (run the \"Update BLS data\" workflow)."}</p></section>`;
      return;
    }
    const { e, now, wageYoy, cpiYoy, cpiMonth, real } = es;
    const regionName = REGION_NAME[e.region] || e.region;
    const inds = e.industries.filter((d) => d.code !== "05000000").sort((a, b) => b.ahe - a.ahe);
    const total = e.industries.find((d) => d.code === "05000000");
    // the industry section appears only where BLS publishes industry earnings for this area
    // (states and the nation; metros get total private only)
    host.innerHTML = `
      <dl class="kpis kpis-3" style="margin-top:14px">
        <div class="kpi"><dt>Hourly earnings</dt><dd>${fmtUsd(now.value)}</dd><div class="kpi-sub">private employers · ${esc(fmtMonth(now.date))}</div>
          ${wageYoy != null ? `<span class="kpi-delta"><b class="${wageYoy >= 0 ? "up" : "down"}">${fmtSignedPct(wageYoy)}</b> vs a year ago</span>` : ""}</div>
        <div class="kpi"><dt>Prices (CPI, ${esc(regionName)})</dt><dd>${cpiYoy != null ? fmtSignedPct(cpiYoy) : "–"}</dd><div class="kpi-sub">year on year · ${esc(fmtMonth(cpiMonth))}</div></div>
        <div class="kpi"><dt>Real earnings growth</dt><dd>${real != null ? signed(real) : "–"}</dd><div class="kpi-sub">earnings minus prices</div>
          ${real != null ? `<span class="kpi-delta"><b class="${real >= 0 ? "up" : "down"}">${real >= 0 ? "ahead of" : "trailing"} inflation</b></span>` : ""}</div>
      </dl>
      ${inds.length ? `<section class="d-section">
        <div class="d-section-head"><div><div class="d-section-title">Earnings by industry</div><div class="d-section-sub">average hourly earnings · ${esc(fmtMonth(now.date))}</div></div></div>
        <div id="burst-host"></div>
        ${inds.length < 5 ? `<p class="rose-note">BLS publishes hourly earnings for only some industries in this area.</p>` : ""}
      </section>` : ""}
      <section class="d-section">
        <div class="d-section-head"><div class="d-section-title">Earnings vs prices</div><div class="d-section-sub">indexed to 100 at ${esc(fmtMonth(e.total[0].date))}</div></div>
        <div class="trend-wrap" id="index-host"></div>
      </section>`;
    if (inds.length) renderEarningsBurst(inds, total, cpiYoy, level === "nation" ? null : earn.national?.industries || []);
    const cpi = cpiOf(e.region);
    const start = e.total[0].date;
    const base = (rows) => rows.find((r) => r.date >= start);
    const idx = (rows) => { const b = base(rows); return b ? rows.filter((r) => r.date >= start).map((r) => ({ t: parse(r.date), v: (r.value / b.value) * 100 })) : []; };
    const wRows = idx(e.total), cRows = idx(cpi);
    const all = wRows.concat(cRows);
    lineChart(d3.select("#index-host"), [{ key: "Earnings", rows: wRows, cls: "trend-sel" }, { key: `CPI ${regionName}`, rows: cRows, cls: "trend-nat" }],
      (v) => v.toFixed(1), (v) => v, [Math.floor(d3.min(all, (d) => d.v) / 10) * 10, Math.ceil(d3.max(all, (d) => d.v) / 10) * 10]);
  }

  // burst: one spoke per private supersector, length = hourly earnings, tip colour =
  // year-on-year change minus regional inflation, ring = area's private average,
  // tick = U.S. average for that industry
  function renderEarningsBurst(inds, total, cpiYoy, usInds) {
    const host = d3.select("#burst-host").html("");
    const order = SECTORS.filter(([code]) => code !== "90000000");
    const byCode = new Map(inds.map((d) => [d.code, d]));
    const usBy = new Map((usInds || []).map((d) => [d.code, d.ahe]));
    const SW = 560, SH = 470, R = 140, cx = SW / 2, cy = SH / 2 + 6, n = order.length;
    const ang = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
    const maxAhe = Math.max(d3.max(inds, (d) => d.ahe) || 0, total ? total.ahe : 0, d3.max([...usBy.values()]) || 0) * 1.05;
    const rs = d3.scaleLinear().domain([0, maxAhe]).range([0, R]);
    const svgB = host.append("div").attr("class", "rose-wrap").append("svg").attr("viewBox", `0 0 ${SW} ${SH}`);
    const g = svgB.append("g").attr("transform", `translate(${cx},${cy})`);
    const step = 10 * Math.ceil(maxAhe / 40);
    for (let v = step; v < maxAhe; v += step) {
      g.append("circle").attr("class", "rose-ring").attr("r", rs(v));
      g.append("text").attr("class", "rose-ring-label").attr("x", 3).attr("y", -rs(v) - 3).text("$" + v);
    }
    if (total) {
      g.append("circle").attr("class", "burst-avg").attr("r", rs(total.ahe));
      g.append("text").attr("class", "rose-ring-label burst-avg-label").attr("x", -3).attr("y", rs(total.ahe) + 11).attr("text-anchor", "end").text(`avg ${fmtUsd(total.ahe)}`);
    }
    order.forEach(([code, , , lines], i) => {
      const d = byCode.get(code), a = ang(i);
      const ux = Math.cos(a), uy = Math.sin(a);
      g.append("line").attr("class", "burst-spoke-faint").attr("x2", (R + 4) * ux).attr("y2", (R + 4) * uy);
      const us = usBy.get(code);
      if (us && d) {
        const t = rs(us);
        g.append("line").attr("class", "burst-us").attr("x1", t * ux - 6 * uy).attr("y1", t * uy + 6 * ux).attr("x2", t * ux + 6 * uy).attr("y2", t * uy - 6 * ux);
      }
      if (!d) return;
      const L = rs(d.ahe), real = d.yoy != null && cpiYoy != null ? (d.yoy - cpiYoy) * 100 : null;
      g.append("line").attr("class", "burst-spoke").attr("x2", L * ux).attr("y2", L * uy);
      g.append("circle").attr("class", "burst-tip").attr("cx", L * ux).attr("cy", L * uy).attr("r", 6.5).attr("fill", realColor(real))
        .on("mousemove", (ev) => showTip(`<b>${esc(d.industry)}</b>
          <div class="row"><span class="muted">Hourly earnings</span><span>${fmtUsd(d.ahe)}</span></div>
          <div class="row"><span class="muted">vs a year ago</span><span>${fmtSignedPct(d.yoy)}</span></div>
          ${cpiYoy != null ? `<div class="row"><span class="muted">Regional prices</span><span>${fmtSignedPct(cpiYoy)}</span></div>
          <div class="row"><span class="muted">Real change</span><span>${real != null ? signed(real) : "–"}</span></div>` : ""}
          ${us ? `<div class="row"><span class="muted">U.S. average</span><span>${fmtUsd(us)}</span></div>` : ""}`, ev))
        .on("mouseleave", hideTip);
      const lr = R + 14, x = lr * ux, y = lr * uy;
      const anchor = Math.abs(ux) < 0.25 ? "middle" : ux > 0 ? "start" : "end";
      const lh = 13, total_l = lines.length + 1;
      const y0 = y - ((total_l - 1) * lh) / 2 + 4 + (Math.abs(ux) < 0.25 ? (uy < 0 ? -8 : 8) : 0);
      const t = g.append("text").attr("class", "rose-label").attr("text-anchor", anchor);
      lines.forEach((ln, j) => t.append("tspan").attr("x", x).attr("y", y0 + j * lh).text(ln));
      t.append("tspan").attr("class", "rose-value").attr("x", x).attr("y", y0 + lines.length * lh).text(`${fmtUsd(d.ahe)} · ${fmtSignedPct(d.yoy)} y/y`);
    });
    g.append("circle").attr("r", 3).attr("fill", "#0b0b0b");
    host.append("div").attr("class", "rose-legend").html(
      `<span><b>spoke</b> = hourly earnings</span><span><span style="color:${GREEN}">●</span> rising faster than prices</span><span><span style="color:${PINK}">●</span> trailing prices</span><span><i></i>area private average</span><span>┼ U.S. average for that industry</span>`);
  }

  /* ------------------------------------------------------------------- go */
  renderLens();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    glyphs.select(".burst").attr("transform", "scale(0)")
      .transition().delay((m) => 150 + geo[m.id].a[0] * 0.9).duration(700).ease(d3.easeBackOut.overshoot(1.4)).attr("transform", "scale(1)");
  }
  const m = location.hash.match(/^#(metro|state|nation)=([0-9]*)$/);
  if (m && (m[1] === "nation" || (m[1] === "metro" ? metros[m[2]] : states[m[2]]))) select(m[1], m[2] || null, true);
})();
