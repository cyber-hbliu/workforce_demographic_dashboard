/* The Workforce Monitor — app.js
   A full-screen atlas. Each metro is a "burst": ten spokes in a fixed order
   (one per CES supersector), spoke length = percentage of local nonfarm jobs,
   tip colour = location quotient vs the U.S. (blue below, red above),
   burst size = total nonfarm jobs. Click a burst or a state to open its profile.
   Data: docs/data/*.json (scripts/fetch_bls.py). Geometry: us-atlas albers
   states + metro footprints merged from Census county delineations
   (scripts/build_geo.js). */

(async function () {
  const boot = document.getElementById("boot");
  const load = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  let meta, national, states, metros, rose, topo, geo;
  try {
    [meta, national, states, metros, rose, topo, geo] = await Promise.all([
      "data/meta.json", "data/national.json", "data/states.json", "data/metros.json",
      "data/rose.json", "lib/states-albers-10m.json", "lib/metros-albers.json",
    ].map(load));
  } catch (e) {
    boot.textContent = `Could not load the data files (${e.message}). If this is a fresh deploy, run the "Update BLS data" workflow once.`;
    boot.classList.add("is-error");
    return;
  }
  boot.remove();

  /* ------------------------------------------------------------ constants */
  const SECTORS = [
    ["20000000", "Construction", "Constr."],
    ["30000000", "Manufacturing", "Manuf."],
    ["40000000", "Trade, Transportation & Utilities", "Trade & transport"],
    ["50000000", "Information", "Information"],
    ["55000000", "Financial Activities", "Finance"],
    ["60000000", "Professional & Business Services", "Prof. & business"],
    ["65000000", "Education & Health Services", "Educ. & health"],
    ["70000000", "Leisure & Hospitality", "Leisure & hosp."],
    ["80000000", "Other Services", "Other services"],
    ["90000000", "Government", "Government"],
  ];
  const N = SECTORS.length;
  const angleOf = (i) => (i / N) * 2 * Math.PI - Math.PI / 2;
  const SHARE_MAX = 0.3; // fixed domain so every rose is comparable
  const US_SHARE = new Map((national.industries || []).map((d) => [d.code, d.share]));
  const STATE_NAME = (fips) => states[fips]?.name || fips;

  const BLUE = "#1c5cab", RED = "#c73a3a", NEUTRAL = "#b5b3ab";
  const toBlue = d3.interpolateRgb(NEUTRAL, BLUE), toRed = d3.interpolateRgb(NEUTRAL, RED);
  const lqColor = (lq) => {
    if (lq == null || !isFinite(lq)) return NEUTRAL;
    const t = Math.max(-1, Math.min(1, Math.log2(lq))); // 0.5x .. 2x
    return t < 0 ? toBlue(-t) : toRed(t);
  };
  const BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  const rampColor = d3.scaleLinear().range(BLUE_RAMP).interpolate(d3.interpolateRgb);

  const fmtNum = d3.format(",");
  const fmtK = (v) => (v >= 1000 ? d3.format(",.1f")(v / 1000) + "M" : d3.format(",.0f")(v) + "k"); // CES thousands
  const fmtPct = (v) => (v * 100).toFixed(1) + "%";
  const fmtMonth = (d) => {
    if (!d) return "";
    const [y, m] = d.split("-");
    return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  };
  const last = (rows) => (rows && rows.length ? rows[rows.length - 1] : null);
  const yearAgo = (rows) => (rows && rows.length > 12 ? rows[rows.length - 13] : null);
  const parse = d3.timeParse("%Y-%m");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ------------------------------------------------------------ app state */
  const app = { lens: "industry", level: null, id: null, roseView: "chart" };
  const metroList = Object.entries(metros).map(([id, m]) => ({ id, ...m }));
  const profileOf = (level, id) =>
    level === "metro" ? rose.metros[id] || [] : level === "state" ? rose.states[id] || [] : national.industries || [];
  const rateOfState = (fips) => last(states[fips]?.series.unemp_rate)?.value ?? null;
  const rateOfMetro = (id) => last(metros[id]?.series.unemp_rate)?.value ?? null;
  const jobsOf = (level, id) => {
    const p = profileOf(level, id);
    const tot = last(level === "metro" ? metros[id]?.series.payrolls : level === "state" ? states[id]?.series.payrolls : national.payrolls);
    return tot ? tot.value : d3.sum(p, (d) => d.jobs);
  };
  const capitalText = (m) => (m.capital_of || []).map((c) => `${c.city}, capital of ${c.state === "11" ? "the United States" : STATE_NAME(c.state)}`).join(" · ");

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
  const usNow = last(national.unemp_rate), usPrev = yearAgo(national.unemp_rate);
  document.getElementById("nation-value").innerHTML = usNow ? `${usNow.value.toFixed(1)}<small>%</small>` : "–";
  document.getElementById("nation-delta").textContent = usNow && usPrev
    ? `${fmtMonth(usNow.date)} · ${usNow.value >= usPrev.value ? "+" : "−"}${Math.abs(usNow.value - usPrev.value).toFixed(1)} pt vs a year ago` : "";
  const latestMonth = [meta.latest_state_month, meta.latest_metro_month, meta.latest_ces_month].filter(Boolean).sort().pop();
  document.getElementById("release-month").textContent = latestMonth ? new Date(+latestMonth.slice(0, 4), +latestMonth.slice(5, 7) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }) : "–";
  const updated = document.getElementById("updated");
  if (meta.source === "sample") {
    updated.textContent = "Sample data — run the Update BLS data workflow to load real figures.";
    updated.classList.add("is-sample");
  } else {
    updated.textContent = `Updated ${meta.updated} · states through ${fmtMonth(meta.latest_state_month)} · metros through ${fmtMonth(meta.latest_metro_month)}`;
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
    .on("mousemove", (ev, d) => {
      const r = rateOfState(d.id);
      showTip(`<b>${esc(states[d.id].name)}</b><div class="row"><span class="muted">Unemployment</span><span>${r != null ? r.toFixed(1) + "%" : "–"}</span></div>`, ev);
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { ev.stopPropagation(); select("state", d.id); });
  zoomLayer.append("path").attr("class", "nation-outline")
    .attr("d", path(topojson.mesh(topo, topo.objects.states, (a, b) => a === b)));

  // metro footprints (real MSA boundaries merged from counties)
  const footG = zoomLayer.append("g");
  const footPaths = footG.selectAll("path").data(metroList.filter((m) => geo[m.id])).join("path")
    .attr("class", "footprint").attr("d", (m) => path(geo[m.id].g));

  // bursts
  const rGlyph = d3.scaleSqrt().domain([0, 10000]).range([0, 32]).clamp(true);
  const glyphR = (m) => Math.max(6, rGlyph(jobsOf("metro", m.id)));
  const spokeLen = (R, share) => R * Math.min(1.15, Math.sqrt(share / 0.22));
  const glyphsG = zoomLayer.append("g").attr("class", "glyph-layer");
  const glyphData = metroList.filter((m) => geo[m.id]).sort((a, b) => glyphR(b) - glyphR(a)); // big first so small draw on top
  const glyphs = glyphsG.selectAll("g.glyph").data(glyphData, (m) => m.id).join("g")
    .attr("class", (m) => "glyph" + (profileOf("metro", m.id).length ? "" : " no-industry"))
    .attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", (m) => `${m.name}${capitalText(m) ? ", " + capitalText(m) : ""}`)
    .on("mousemove", (ev, m) => showTip(metroTip(m), ev))
    .on("mouseleave", hideTip)
    .on("click", (ev, m) => { ev.stopPropagation(); select("metro", m.id); })
    .on("keydown", (ev, m) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select("metro", m.id); } });

  glyphs.each(function (m) {
    const g = d3.select(this), R = glyphR(m), prof = profileOf("metro", m.id);
    const inner = g.append("g").attr("class", "burst");
    if (prof.length) {
      const byCode = new Map(prof.map((d) => [d.code, d]));
      inner.append("circle").attr("class", "halo").attr("r", R * 1.15 + 3);
      SECTORS.forEach(([code], i) => {
        const d = byCode.get(code);
        if (!d) return;
        const a = angleOf(i), L = spokeLen(R, d.share);
        inner.append("line").attr("class", "spoke").attr("x2", L * Math.cos(a)).attr("y2", L * Math.sin(a));
        inner.append("circle").attr("class", "tip-dot").attr("r", Math.max(1.6, Math.min(2.6, R / 9)))
          .attr("cx", L * Math.cos(a)).attr("cy", L * Math.sin(a)).attr("fill", lqColor(d.lq));
      });
      if (m.capital_of && m.capital_of.length) {
        const s = Math.max(2.6, R / 6); // a diamond core = seat of government
        inner.append("path").attr("class", "core").attr("d", `M0,${-s}L${s},0L0,${s}L${-s},0Z`);
      } else {
        inner.append("circle").attr("class", "core").attr("r", Math.max(1.3, R / 11));
      }
    } else {
      inner.append("circle").attr("class", "halo").attr("r", 7);
      inner.append("circle").attr("class", "ring").attr("r", 3.2);
      if (m.capital_of && m.capital_of.length)
        inner.append("path").attr("class", "core").attr("d", "M0,-1.6L1.6,0L0,1.6L-1.6,0Z");
    }
    inner.append("circle").attr("class", "hit").attr("r", Math.max(R * 1.15 + 4, 10));
    g.append("text").attr("class", "glyph-label").attr("y", R * 1.15 + 11).text(m.short);
  });

  // unemployment lens: plain dots sized by labor force
  const rDot = d3.scaleSqrt().domain([0, 10_000_000]).range([0, 15]).clamp(true);
  const udotsG = zoomLayer.append("g").attr("class", "udot-layer").style("display", "none");
  const udots = udotsG.selectAll("circle").data(glyphData, (m) => m.id).join("circle")
    .attr("class", "udot")
    .attr("r", (m) => Math.max(2.5, rDot(last(m.series.labor_force)?.value ?? 0)))
    .on("mousemove", (ev, m) => showTip(metroTip(m), ev))
    .on("mouseleave", hideTip)
    .on("click", (ev, m) => { ev.stopPropagation(); select("metro", m.id); });

  function metroTip(m) {
    const r = rateOfMetro(m.id), prof = profileOf("metro", m.id);
    const top = prof.filter((d) => d.lq != null).sort((a, b) => b.lq - a.lq)[0];
    const cap = capitalText(m);
    return `<b>${esc(m.short)}</b><div class="muted">${esc(m.name)}${m.kind === "micro" ? " (micropolitan)" : ""}</div>` +
      (cap ? `<div class="muted">${esc(cap)}</div>` : "") +
      `<div class="row" style="margin-top:6px"><span class="muted">Unemployment</span><span>${r != null ? r.toFixed(1) + "%" : "–"}</span></div>` +
      (prof.length ? `<div class="row"><span class="muted">Nonfarm jobs</span><span>${fmtK(jobsOf("metro", m.id))}</span></div>` : "") +
      (top ? `<div class="row"><span class="muted">Most specialised</span><span><i style="background:${lqColor(top.lq)}"></i>${esc(top.industry)} ${top.lq.toFixed(2)}×</span></div>` : "") +
      `<div class="muted" style="margin-top:6px">Click to open the profile</div>`;
  }

  /* ---------------------------------------------------------------- zoom */
  const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[-W * 0.8, -H * 0.8], [W * 1.8, H * 1.8]]).on("zoom", (ev) => applyZoom(ev.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("click", () => { if (app.level) select(null, null); });
  let k = 1;
  function applyZoom(t) {
    k = t.k;
    zoomLayer.attr("transform", t);
    const s = Math.pow(k, -0.62); // bursts grow slower than the map so they never swamp it
    glyphs.attr("transform", (m) => `translate(${geo[m.id].a}) scale(${s})`);
    udots.attr("transform", (m) => `translate(${geo[m.id].a}) scale(${s})`);
    layoutLabels(t, s);
  }
  // greedy label placement: biggest metros first, later labels yield when they collide
  function layoutLabels(t, s) {
    const placed = [];
    glyphs.select(".glyph-label").style("display", (m) => {
      const R = glyphR(m);
      if (R * Math.pow(k, 0.6) < 8.5) return "none";
      const [ax, ay] = geo[m.id].a;
      const x = ax * k + t.x, y = (ay + (R * 1.15 + 11) * s) * k + t.y;
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
  // nudge the map so a point is not covered by the drawer (right) or masthead (left)
  function keepVisible(pt) {
    if (!pt) return;
    const t = d3.zoomTransform(svg.node());
    const node = svg.node(), box = node.getBoundingClientRect();
    const scale = Math.min(box.width / W, box.height / H); // viewBox -> screen
    const ox = (box.width - W * scale) / 2, oy = (box.height - H * scale) / 2;
    const sx = box.left + ox + (pt[0] * t.k + t.x) * scale, sy = box.top + oy + (pt[1] * t.k + t.y) * scale;
    const drawerW = innerWidth > 900 ? 500 : 0, drawerH = innerWidth > 900 ? 0 : innerHeight * 0.72;
    let dx = 0, dy = 0;
    if (sx > innerWidth - drawerW) dx = (innerWidth - drawerW) / 2 - sx;
    if (sy > innerHeight - drawerH - 20) dy = (innerHeight - drawerH) / 2 - sy;
    if (dx || dy) svg.transition().duration(600).call(zoom.translateBy, dx / scale / t.k, dy / scale / t.k);
  }
  document.getElementById("zoom-in").onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 1.6);
  document.getElementById("zoom-out").onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6);
  document.getElementById("zoom-reset").onclick = () => svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);

  /* ---------------------------------------------------------------- lens */
  const legend = document.getElementById("legend");
  const rateExtent = d3.extent(stateFeatures.map((f) => rateOfState(f.id)).filter((v) => v != null));
  if (rateExtent[0] != null) rampColor.domain(d3.range(7).map((i) => rateExtent[0] + (i / 6) * (rateExtent[1] - rateExtent[0])));

  function renderLens() {
    const ind = app.lens === "industry";
    statePaths.attr("fill", (d) => (ind ? null : rateOfState(d.id) != null ? rampColor(rateOfState(d.id)) : "#e6e4dc"));
    footG.style("display", ind ? null : "none");
    glyphsG.style("display", ind ? null : "none");
    udotsG.style("display", ind ? "none" : null);
    udots.attr("fill", (m) => (rateOfMetro(m.id) != null ? rampColor(rateOfMetro(m.id)) : "#e6e4dc"));
    document.querySelectorAll(".lens-btn").forEach((b) => {
      const on = b.dataset.lens === app.lens;
      b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on);
    });
    legend.innerHTML = ind ? industryLegend() : unemploymentLegend();
  }
  function industryLegend() {
    const R = 30, cx = 145, cy = 62;
    let s = `<svg width="290" height="124" viewBox="0 0 290 124">`;
    SECTORS.forEach(([, , short], i) => {
      const a = angleOf(i), L = R * (0.55 + 0.45 * ((i * 7) % 5) / 4);
      const x = cx + L * Math.cos(a), y = cy + L * Math.sin(a), lx = cx + (R + 9) * Math.cos(a), ly = cy + (R + 9) * Math.sin(a);
      const c = i % 3 === 0 ? RED : i % 3 === 1 ? NEUTRAL : BLUE;
      const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#0b0b0b" stroke-opacity="0.5" stroke-width="0.8"/>`;
      s += `<circle cx="${x}" cy="${y}" r="2.4" fill="${c}" stroke="#fcfcfb" stroke-width="0.8"/>`;
      s += `<text x="${lx}" y="${ly + 3}" text-anchor="${anchor}">${esc(short)}</text>`;
    });
    s += `<circle cx="${cx}" cy="${cy}" r="1.6" fill="#0b0b0b"/></svg>`;
    return `<p class="legend-title">How to read a burst</p>
      <div class="legend-key">${s}</div>
      <p class="legend-note"><b>Spoke length</b> = percentage of the area's nonfarm jobs in that industry ·
      <b>tip colour</b> = that percentage against the U.S. mix · <b>burst size</b> = total nonfarm jobs ·
      <span class="legend-cap"></span>state capital · <span class="legend-ring"></span>unemployment only</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${BLUE},${NEUTRAL},${RED})"></div>
      <div class="legend-ramp-labels"><span>½× the U.S. %</span><span>same</span><span>2× or more</span></div>`;
  }
  function unemploymentLegend() {
    const [lo, hi] = rateExtent;
    return `<p class="legend-title">Unemployment rate · ${esc(fmtMonth(meta.latest_state_month))}</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${BLUE_RAMP.join(",")})"></div>
      <div class="legend-ramp-labels"><span>${lo != null ? lo.toFixed(1) + "%" : ""}</span><span>states, seasonally adjusted</span><span>${hi != null ? hi.toFixed(1) + "%" : ""}</span></div>
      <p class="legend-note" style="margin-top:8px"><b>Dots</b> are metro areas, sized by labour force and shaded by their own (not seasonally adjusted) rate.</p>`;
  }
  document.querySelectorAll(".lens-btn").forEach((b) => (b.onclick = () => { app.lens = b.dataset.lens; renderLens(); }));

  /* -------------------------------------------------------------- search */
  const searchEl = document.getElementById("search"), resultsEl = document.getElementById("search-results");
  const index = [
    ...metroList.map((m) => ({ level: "metro", id: m.id, label: m.short, sub: m.name, kind: m.kind === "micro" ? "micro" : "metro",
      text: `${m.short} ${m.name} ${(m.capital_of || []).map((c) => c.city + " capital").join(" ")}`.toLowerCase() })),
    ...Object.entries(states).map(([id, s]) => ({ level: "state", id, label: s.name, sub: "", kind: "state", text: s.name.toLowerCase() })),
  ];
  searchEl.oninput = () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) { resultsEl.hidden = true; return; }
    const hits = index.filter((d) => d.text.includes(q))
      .sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1) || a.label.localeCompare(b.label))
      .slice(0, 8);
    resultsEl.innerHTML = hits.map((h) => `<li><button type="button" data-level="${h.level}" data-id="${h.id}"><span>${esc(h.label)}${h.sub && h.sub !== h.label ? ` <span class="kind" style="text-transform:none;letter-spacing:0">${esc(h.sub)}</span>` : ""}</span><span class="kind">${h.kind}</span></button></li>`).join("")
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
      history.replaceState(null, "", location.pathname);
    }
  }

  /* --------------------------------------------------------------- drawer */
  function renderDrawer() {
    const { level, id } = app;
    const sel = level === "metro" ? metros[id] : level === "state" ? states[id] : null;
    const series = level === "nation" ? { unemp_rate: national.unemp_rate, payrolls: national.payrolls } : sel.series;
    const now = last(series.unemp_rate), prev = yearAgo(series.unemp_rate);
    const prof = profileOf(level, id);
    const name = level === "nation" ? "United States" : level === "state" ? sel.name : sel.short;
    const eyebrow = level === "nation" ? "Nation · CPS + CES" : level === "state" ? "State · LAUS + CES" :
      `${sel.kind === "micro" ? "Micropolitan" : "Metropolitan"} statistical area · LAUS${prof.length ? " + CES" : ""}`;
    const msa = level === "metro" ? sel.name : "";
    const sub = level === "metro" ? capitalText(sel) :
      level === "state" ? `Capital: ${(metroList.find((m) => (m.capital_of || []).some((c) => c.state === id))?.capital_of.find((c) => c.state === id)?.city) || "–"}` : "";
    const monthTag = now ? now.date : rose.month;
    document.title = `${name} · Workforce Monitor · ${fmtMonth(monthTag)}`;
    const kpis = [];
    const lf = last(series.labor_force), em = last(series.employed), un = last(series.unemployed), pj = last(series.payrolls);
    if (lf) kpis.push(["Labor force", fmtNum(lf.value), ""]);
    if (em) kpis.push(["Employed", fmtNum(em.value), ""]);
    if (un) kpis.push(["Unemployed", fmtNum(un.value), ""]);
    if (pj) kpis.push(["Nonfarm jobs", fmtNum(Math.round(pj.value)), "k · " + fmtMonth(pj.date)]);
    const deltaCls = now && prev ? (now.value > prev.value ? "up" : now.value < prev.value ? "down" : "") : "";

    body.innerHTML = `
      <p class="d-eyebrow">${esc(eyebrow)}</p>
      ${monthTag ? `<span class="d-tag">${esc(new Date(+monthTag.slice(0, 4), +monthTag.slice(5, 7) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }))} release</span>` : ""}
      <h2 class="d-name">${esc(name)}</h2>
      ${msa && msa !== name ? `<p class="d-msa">${esc(msa)}</p>` : ""}
      ${sub ? `<p class="d-sub">${esc(sub)}</p>` : ""}
      <div class="d-hero">
        <div class="d-hero-value">${now ? now.value.toFixed(1) + "<small>%</small>" : "–"}</div>
        <div class="d-hero-label">unemployment rate${now ? `, ${esc(fmtMonth(now.date))}` : ""}<br>
          ${now && prev ? `<span class="d-hero-delta ${deltaCls}">${now.value >= prev.value ? "+" : "−"}${Math.abs(now.value - prev.value).toFixed(1)} pt</span> vs ${esc(fmtMonth(prev.date))}` : "no series published"}</div>
      </div>
      ${kpis.length ? `<dl class="kpis">${kpis.map(([k, v, u]) => `<div class="kpi"><dt>${k}</dt><dd>${v}<small>${u}</small></dd></div>`).join("")}</dl>` : ""}
      <section class="d-section">
        <div class="d-section-head"><div><div class="d-section-title">Industry structure</div><div class="d-section-sub">${prof.length ? `% of nonfarm jobs · ${esc(fmtMonth(rose.month))}` : ""}</div></div>
          ${prof.length ? `<div class="view-toggle" id="rose-toggle"><button data-v="chart" class="${app.roseView === "chart" ? "is-active" : ""}">Rose</button><button data-v="table" class="${app.roseView === "table" ? "is-active" : ""}">Table</button></div>` : ""}</div>
        <div id="rose-host"></div>
      </section>
      <section class="d-section">
        <div class="d-section-head"><div class="d-section-title">Ten-year trend</div><div class="d-section-sub">${level === "nation" ? "unemployment rate" : "vs the United States"}</div></div>
        <div class="trend-wrap" id="trend-host"></div>
      </section>
      ${level === "state" ? stateMetroChips(id) : ""}
      <p class="d-foot">${level === "metro" ? "Metro unemployment is not seasonally adjusted; state and national rates are. " : ""}Industry percentages are from the Current Employment Statistics (not seasonally adjusted); "vs U.S." divides an industry's local percentage of jobs by its national percentage.${level === "metro" && sel.kind === "micro" ? " BLS does not publish industry series for micropolitan areas." : ""}</p>`;

    if (prof.length) {
      const toggle = document.getElementById("rose-toggle");
      toggle.onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; app.roseView = b.dataset.v; renderDrawer(); };
      if (app.roseView === "table") renderTable(prof, jobsOf(level, id)); else renderRose(prof);
    } else {
      document.getElementById("rose-host").innerHTML = `<p class="rose-note">BLS publishes no industry employment series for this area, so only the unemployment picture is shown.</p>`;
    }
    renderTrend(series.unemp_rate || [], level === "nation" ? null : national.unemp_rate, name);
  }

  function stateMetroChips(fips) {
    const list = metroList.filter((m) => (m.states || []).includes(fips)).sort((a, b) => jobsOf("metro", b.id) - jobsOf("metro", a.id));
    if (!list.length) return "";
    return `<section class="d-section"><div class="d-section-head"><div class="d-section-title">Metros in ${esc(STATE_NAME(fips))}</div><div class="d-section-sub">on this map</div></div>
      <div class="chips">${list.map((m) => `<button class="chip" data-id="${m.id}"><b>${esc(m.short)}</b>${(m.capital_of || []).some((c) => c.state === fips) ? `<span class="cap">capital</span>` : ""}</button>`).join("")}</div></section>`;
  }
  body.addEventListener("click", (ev) => {
    const c = ev.target.closest(".chip[data-id]");
    if (c) select("metro", c.dataset.id, true);
  });

  /* ------------------------------------------------------------------ rose */
  function renderRose(prof) {
    const host = d3.select("#rose-host").html("");
    const SW = 440, SH = 372, R = 112, cx = SW / 2, cy = SH / 2 + 2;
    const svgR = host.append("div").attr("class", "rose-wrap").append("svg").attr("viewBox", `0 0 ${SW} ${SH}`);
    const g = svgR.append("g").attr("transform", `translate(${cx},${cy})`);
    const rs = d3.scaleSqrt().domain([0, SHARE_MAX]).range([0, R]);
    const byCode = new Map(prof.map((d) => [d.code, d]));
    const step = (2 * Math.PI) / N;

    for (const s of [0.05, 0.1, 0.2, 0.3]) g.append("circle").attr("class", "rose-ring").attr("r", rs(s));
    SECTORS.forEach((_, i) => {
      const a = angleOf(i) - step / 2;
      g.append("line").attr("class", "rose-spoke").attr("x2", (R + 4) * Math.cos(a)).attr("y2", (R + 4) * Math.sin(a));
    });
    const ra = angleOf(0) + step / 2; // ring labels ride the spoke between the first two petals
    for (const sh of [0.1, 0.2, 0.3])
      g.append("text").attr("class", "rose-center").attr("text-anchor", "start")
        .attr("x", rs(sh) * Math.cos(ra) + 2).attr("y", rs(sh) * Math.sin(ra) - 2).text(sh * 100 + "%");

    const arc = d3.arc().innerRadius(0).padAngle(0.012).padRadius(R).cornerRadius(2)
      .startAngle((i) => angleOf(i) + Math.PI / 2 - step / 2 + 0.01).endAngle((i) => angleOf(i) + Math.PI / 2 + step / 2 - 0.01);

    const petals = g.selectAll(".petal").data(SECTORS.map(([code], i) => ({ i, d: byCode.get(code) })).filter((x) => x.d)).join("path")
      .attr("class", "petal")
      .attr("fill", ({ d }) => lqColor(d.lq))
      .attr("fill-opacity", 0.9)
      .attr("d", ({ i, d }) => arc.outerRadius(rs(Math.min(d.share, SHARE_MAX)))(i))
      .on("mousemove", (ev, { d }) => showTip(petalTip(d), ev))
      .on("mouseleave", () => { hideTip(); petals.classed("is-dim", false); })
      .on("mouseenter", (_, x) => petals.classed("is-dim", (y) => y !== x));

    // U.S. profile outline: what each petal would be if the area matched the national mix
    if (US_SHARE.size) {
      const refArc = d3.arc().innerRadius((i) => rs(US_SHARE.get(SECTORS[i][0]) || 0) - 0.5).outerRadius((i) => rs(US_SHARE.get(SECTORS[i][0]) || 0) + 0.5)
        .startAngle((i) => angleOf(i) + Math.PI / 2 - step / 2 + 0.02).endAngle((i) => angleOf(i) + Math.PI / 2 + step / 2 - 0.02);
      g.selectAll(".rose-ref").data(SECTORS.map((_, i) => i)).join("path").attr("class", "rose-ref").attr("d", (i) => refArc(i));
    }

    // labels: name outside the rose, share only for the extremes
    const extremes = new Set(prof.filter((d) => d.lq != null && (d.lq >= 1.35 || d.lq <= 0.6)).map((d) => d.code));
    SECTORS.forEach(([code, , short], i) => {
      const d = byCode.get(code); if (!d) return;
      const a = angleOf(i), lr = R + 14;
      const x = lr * Math.cos(a), y = lr * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.25 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      const t = g.append("text").attr("class", "rose-label" + (extremes.has(code) ? " is-hot" : "")).attr("x", x).attr("y", y + 3).attr("text-anchor", anchor).text(short);
      if (extremes.has(code)) t.append("tspan").attr("class", "rose-value").attr("x", x).attr("dy", 12).text(`${fmtPct(d.share)} · ${d.lq.toFixed(2)}× U.S.`);
    });

    host.append("div").attr("class", "rose-legend").html(
      `<span><i></i>the U.S. mix</span><span>petal colour: <span style="color:${BLUE}">■</span> below · <span style="color:${RED}">■</span> above the U.S. percentage</span>`);
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

  /* ----------------------------------------------------------------- trend */
  function renderTrend(selRows, natRows, name) {
    const host = d3.select("#trend-host").html("");
    const sel = selRows.map((d) => ({ t: parse(d.date), v: d.value }));
    const nat = (natRows || []).map((d) => ({ t: parse(d.date), v: d.value }));
    if (!sel.length) { host.append("p").attr("class", "rose-note").text("No unemployment series published for this area."); return; }
    const W = 388, H = 170, M = { t: 12, r: 46, b: 22, l: 30 };
    const svgT = host.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const all = sel.concat(nat);
    const x = d3.scaleTime().domain(d3.extent(all, (d) => d.t)).range([M.l, W - M.r]);
    const y = d3.scaleLinear().domain([0, d3.max(all, (d) => d.v)]).nice().range([H - M.b, M.t]);
    const line = d3.line().x((d) => x(d.t)).y((d) => y(d.v)).curve(d3.curveMonotoneX);
    svgT.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(W - M.l - M.r)).tickFormat((v) => v + "%"));
    svgT.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`)
      .call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8));
    if (nat.length) svgT.append("path").attr("class", "trend-nat").attr("d", line(nat));
    svgT.append("path").attr("class", "trend-sel").attr("d", line(sel));
    const eS = sel[sel.length - 1];
    svgT.append("circle").attr("cx", x(eS.t)).attr("cy", y(eS.v)).attr("r", 4).attr("fill", "#0b0b0b").attr("stroke", "#fcfcfb").attr("stroke-width", 2);
    // end labels; nudge apart if they collide
    let ySel = y(eS.v), yNat = nat.length ? y(nat[nat.length - 1].v) : null;
    if (yNat != null && Math.abs(ySel - yNat) < 12) { const mid = (ySel + yNat) / 2, dir = ySel <= yNat ? -1 : 1; ySel = mid + dir * 6; yNat = mid - dir * 6; }
    svgT.append("text").attr("class", "trend-end").attr("x", x(eS.t) + 7).attr("y", ySel + 3.5).text(name.length > 9 ? "Selected" : name);
    if (yNat != null) svgT.append("text").attr("class", "trend-end nat").attr("x", x(eS.t) + 7).attr("y", yNat + 3.5).text("U.S.");

    // crosshair + tooltip listing every series at the nearest month
    const cross = svgT.append("line").attr("class", "crosshair").attr("y1", M.t).attr("y2", H - M.b).style("display", "none");
    const bisect = d3.bisector((d) => d.t).center;
    svgT.append("rect").attr("class", "trend-hit").attr("x", M.l).attr("y", 0).attr("width", W - M.l - M.r).attr("height", H)
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev), t = x.invert(mx);
        const i = bisect(sel, t), s = sel[i], n = nat.length ? nat[bisect(nat, t)] : null;
        cross.style("display", null).attr("x1", x(s.t)).attr("x2", x(s.t));
        showTip(`<b>${s.t.toLocaleString("en-US", { month: "short", year: "numeric" })}</b>
          <div class="row"><span><i style="background:#0b0b0b"></i>${esc(name)}</span><span>${s.v.toFixed(1)}%</span></div>
          ${n ? `<div class="row"><span><i style="background:${NEUTRAL}"></i>U.S.</span><span>${n.v.toFixed(1)}%</span></div>` : ""}`, ev);
      })
      .on("mouseleave", () => { cross.style("display", "none"); hideTip(); });
  }

  /* ------------------------------------------------------------------- go */
  renderLens();
  // entrance: bursts unfold
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    glyphs.select(".burst").attr("transform", "scale(0)")
      .transition().delay((m) => 150 + geo[m.id].a[0] * 0.9).duration(700).ease(d3.easeBackOut.overshoot(1.4)).attr("transform", "scale(1)");
  }
  const m = location.hash.match(/^#(metro|state|nation)=([0-9]*)$/);
  if (m && (m[1] === "nation" || (m[1] === "metro" ? metros[m[2]] : states[m[2]]))) select(m[1], m[2] || null, true);
})();
