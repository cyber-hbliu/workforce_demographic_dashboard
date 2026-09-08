/* Workforce Monitor — app.js
   A full-screen atlas. Each metropolitan statistical area (MSA) is a "burst":
   ten spokes in a fixed order (one per CES supersector), spoke length =
   percentage of local nonfarm jobs, tip colour = that percentage vs the U.S.
   (green below, pink above), burst size = total nonfarm jobs. Click a burst
   or a state to open its profile.
   Data: docs/data/*.json (scripts/fetch_bls.py). Geometry: us-atlas albers
   states + MSA footprints merged from Census county delineations
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
  // code, full name, short map label, label lines for the rose
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
  const SHARE_MAX = 0.3; // fixed domain so every rose is comparable
  const US_SHARE = new Map((national.industries || []).map((d) => [d.code, d.share]));
  const STATE_NAME = (fips) => states[fips]?.name || fips;

  const GREEN = "#148f62", PINK = "#d4417f", NEUTRAL = "#b5b3ab";
  const toGreen = d3.interpolateRgb(NEUTRAL, GREEN), toPink = d3.interpolateRgb(NEUTRAL, PINK);
  const lqColor = (lq) => {
    if (lq == null || !isFinite(lq)) return NEUTRAL;
    const t = Math.max(-1, Math.min(1, Math.log2(lq))); // 0.5x .. 2x
    return t < 0 ? toGreen(-t) : toPink(t);
  };
  const BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  const rampColor = d3.scaleLinear().range(BLUE_RAMP).interpolate(d3.interpolateRgb);

  const fmtNum = d3.format(",");
  const fmtK = (v) => (v >= 1000 ? d3.format(",.1f")(v / 1000) + "M" : d3.format(",.0f")(v) + "k"); // CES thousands -> jobs
  const fmtBig = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : fmtNum(v)); // persons
  const fmtPct = (v) => (v * 100).toFixed(1) + "%";
  const fmtMonth = (d) => {
    if (!d) return "";
    const [y, m] = d.split("-");
    return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  };
  const fmtMonthLong = (d) => (d ? new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }) : "");
  const last = (rows) => (rows && rows.length ? rows[rows.length - 1] : null);
  const back = (rows, n) => (rows && rows.length > n ? rows[rows.length - 1 - n] : null);
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
  const rateOfState = (fips) => last(states[fips]?.series.unemp_rate)?.value ?? null;
  const rateOfMetro = (id) => last(metros[id]?.series.unemp_rate)?.value ?? null;
  const jobsOf = (level, id) => {
    const p = profileOf(level, id);
    const tot = last(level === "metro" ? metros[id]?.series.payrolls : level === "state" ? states[id]?.series.payrolls : national.payrolls);
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
  const usNow = last(national.unemp_rate), usPrev = back(national.unemp_rate, 12);
  document.getElementById("nation-value").innerHTML = usNow ? `${usNow.value.toFixed(1)}<small>%</small>` : "–";
  document.getElementById("nation-delta").textContent = usNow
    ? `unemployment rate, ${fmtMonth(usNow.date)}${usPrev ? ` · ${signed(usNow.value - usPrev.value)} vs a year ago` : ""}` : "";
  const usKpis = [];
  const usLf = last(national.labor_force), usEm = last(national.employed), usUn = last(national.unemployed);
  const usPj = last(national.payrolls_sa) || last(national.payrolls);
  if (usLf) usKpis.push(["Labor force", fmtBig(usLf.value * 1000), fmtMonth(usLf.date)]);
  if (usEm) usKpis.push(["Employment", fmtBig(usEm.value * 1000), fmtMonth(usEm.date)]);
  if (usUn) usKpis.push(["Unemployment", fmtBig(usUn.value * 1000), fmtMonth(usUn.date)]);
  if (usPj) usKpis.push(["Nonfarm employment", fmtBig(usPj.value * 1000), `jobs · ${fmtMonth(usPj.date)}`]);
  document.getElementById("us-kpis").innerHTML = usKpis.map(([k, v, s]) => `<div class="kpi"><dt>${k}</dt><dd>${v}</dd><div class="kpi-sub">${esc(s)}</div></div>`).join("");
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
      showTip(`<b>${esc(states[d.id].name)}</b><div class="muted">State · statewide figures</div><div class="row"><span class="muted">Unemployment rate</span><span>${r != null ? r.toFixed(1) + "%" : "–"}</span></div>`, ev);
    })
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => { ev.stopPropagation(); select("state", d.id); });
  zoomLayer.append("path").attr("class", "nation-outline")
    .attr("d", path(topojson.mesh(topo, topo.objects.states, (a, b) => a === b)));

  // MSA footprints (real boundaries merged from member counties)
  const footG = zoomLayer.append("g");
  const footPaths = footG.selectAll("path").data(metroList.filter((m) => geo[m.id])).join("path")
    .attr("class", "footprint").attr("d", (m) => path(geo[m.id].g));

  // bursts
  const rGlyph = d3.scaleSqrt().domain([0, 8000]).range([0, 30]).clamp(true);
  const glyphR = (m) => Math.max(7.5, rGlyph(jobsOf("metro", m.id)));
  const spokeLen = (R, share) => R * Math.min(1.15, Math.sqrt(share / 0.22));
  const glyphsG = zoomLayer.append("g").attr("class", "glyph-layer");
  const glyphData = metroList.filter((m) => geo[m.id]).sort((a, b) => glyphR(b) - glyphR(a)); // big first so small draw on top
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
    return `<b>${esc(m.name)}</b><div class="muted">${geoType(m)}${geo[m.id]?.c ? ` · ${countyText(m.id)}` : ""}</div>` +
      (cap ? `<div class="muted">${esc(cap)}</div>` : "") +
      `<div class="row" style="margin-top:6px"><span class="muted">Unemployment rate</span><span>${r != null ? r.toFixed(1) + "%" : "–"}</span></div>` +
      (prof.length ? `<div class="row"><span class="muted">Nonfarm jobs</span><span>${fmtK(jobsOf("metro", m.id))}</span></div>` : "") +
      (top ? `<div class="row"><span class="muted">Regional specialty</span><span><i style="background:${lqColor(top.lq)}"></i>${esc(top.industry)} ${top.lq.toFixed(2)}×</span></div>` : "") +
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
    const drawerW = innerWidth > 900 ? 560 : 0, drawerH = innerWidth > 900 ? 0 : innerHeight * 0.76;
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
      const c = i % 3 === 0 ? PINK : i % 3 === 1 ? NEUTRAL : GREEN;
      const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#0b0b0b" stroke-opacity="0.5" stroke-width="0.8"/>`;
      s += `<circle cx="${x}" cy="${y}" r="2.4" fill="${c}" stroke="#fcfcfb" stroke-width="0.8"/>`;
      s += `<text x="${lx}" y="${ly + 3}" text-anchor="${anchor}">${esc(short)}</text>`;
    });
    s += `<circle cx="${cx}" cy="${cy}" r="1.6" fill="#0b0b0b"/></svg>`;
    return `<p class="legend-title">How to read a burst · one per MSA</p>
      <div class="legend-key">${s}</div>
      <p class="legend-note"><b>Spoke length</b> = percentage of the MSA's nonfarm jobs in that industry ·
      <b>tip colour</b> = that percentage against the U.S. mix · <b>burst size</b> = total nonfarm jobs ·
      <span class="legend-cap"></span>state capital · <span class="legend-ring"></span>unemployment only</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${GREEN},${NEUTRAL},${PINK})"></div>
      <div class="legend-ramp-labels"><span>½× the U.S. %</span><span>same</span><span>2× or more</span></div>`;
  }
  function unemploymentLegend() {
    const [lo, hi] = rateExtent;
    return `<p class="legend-title">Unemployment rate · ${esc(fmtMonth(meta.latest_state_month))}</p>
      <div class="legend-ramp" style="background:linear-gradient(to right,${BLUE_RAMP.join(",")})"></div>
      <div class="legend-ramp-labels"><span>${lo != null ? lo.toFixed(1) + "%" : ""}</span><span>states, seasonally adjusted</span><span>${hi != null ? hi.toFixed(1) + "%" : ""}</span></div>
      <p class="legend-note" style="margin-top:8px"><b>Dots</b> are MSAs, sized by labor force and shaded by their own (not seasonally adjusted) rate.</p>`;
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
      .sort((a, b) => (a.text.startsWith(q) ? 0 : 1) - (b.text.startsWith(q) ? 0 : 1) || a.label.localeCompare(b.label))
      .slice(0, 8);
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
      document.title = "Workforce Monitor";
      history.replaceState(null, "", location.pathname);
    }
  }

  /* --------------------------------------------------------------- drawer */
  function renderDrawer() {
    const { level, id } = app;
    const sel = level === "metro" ? metros[id] : level === "state" ? states[id] : null;
    const series = level === "nation" ? national : sel.series;
    const now = last(series.unemp_rate), m1 = back(series.unemp_rate, 1), y1 = back(series.unemp_rate, 12);
    const prof = profileOf(level, id);
    const name = level === "nation" ? "United States" : sel.name;
    const geoTag = level === "nation" ? "Nation" : level === "state" ? "State" : geoType(sel);
    const monthTag = now ? now.date : rose.month;
    document.title = `${name} · Workforce Monitor · ${fmtMonth(monthTag)}`;

    // geography line: make explicit what statistical unit the figures describe
    let geoLine = "";
    if (level === "metro") {
      const cty = countyText(id);
      geoLine = `<b>${esc(geoShort(sel))} figures</b> cover the whole ${sel.kind === "micro" ? "micropolitan" : "metropolitan"} area${cty ? ` (${esc(cty)})` : ""}, not the city of ${esc(sel.short)} alone.`;
    } else if (level === "state") {
      geoLine = `<b>Statewide figures</b>, seasonally adjusted. Metropolitan areas inside the state are listed below.`;
    } else {
      geoLine = `<b>National figures</b> from the Current Population Survey (seasonally adjusted) and Current Employment Statistics.`;
    }
    const sub = level === "metro" ? capitalText(sel) :
      level === "state" ? `Capital: ${(metroList.find((m) => (m.capital_of || []).some((c) => c.state === id))?.capital_of.find((c) => c.state === id)?.city) || "–"}` : "";

    // three figures: labor force, employment, unemployment rate (+ monthly and annual change)
    const persons = level === "nation" ? 1000 : 1; // CPS levels are in thousands
    const lf = last(series.labor_force), em = last(series.employed);
    const tiles = [
      ["Labor force", lf ? fmtNum(Math.round(lf.value * persons)) : "–", lf ? fmtMonth(lf.date) : "", ""],
      ["Employment", em ? fmtNum(Math.round(em.value * persons)) : "–", em ? fmtMonth(em.date) : "", ""],
      ["Unemployment rate", now ? `${now.value.toFixed(1)}<small>%</small>` : "–", now ? fmtMonth(now.date) : "",
        (m1 ? `<span class="kpi-delta">${deltaHtml(now, m1, "vs " + fmtMonth(m1.date))}</span>` : "") +
        (y1 ? `<span class="kpi-delta">${deltaHtml(now, y1, "vs " + fmtMonth(y1.date))}</span>` : "")],
    ];
    const jobs = jobsOf(level, id), jobsRow = last(series.payrolls);

    body.innerHTML = `
      <p class="d-tags"><span class="d-tag">${esc(fmtMonthLong(monthTag))} release</span><span class="d-tag d-tag-geo">${esc(geoTag)}</span></p>
      <h2 class="d-name">${esc(name)}</h2>
      <p class="d-geo">${geoLine}</p>
      ${sub ? `<p class="d-sub">${esc(sub)}</p>` : ""}
      <dl class="kpis kpis-3">${tiles.map(([k, v, s, extra]) => `<div class="kpi"><dt>${k}</dt><dd>${v}</dd><div class="kpi-sub">${esc(s)}</div>${extra}</div>`).join("")}</dl>
      <section class="d-section">
        <div class="d-section-head"><div><div class="d-section-title">Industry structure</div><div class="d-section-sub">${prof.length ? `% of nonfarm jobs${jobsRow ? ` · ${fmtNum(Math.round(jobs))}k jobs` : ""} · ${esc(fmtMonth(jobsRow ? jobsRow.date : rose.month))}` : ""}</div></div>
          ${prof.length ? `<div class="view-toggle" id="rose-toggle"><button data-v="chart" class="${app.roseView === "chart" ? "is-active" : ""}">Rose</button><button data-v="table" class="${app.roseView === "table" ? "is-active" : ""}">Table</button></div>` : ""}</div>
        <div id="rose-host"></div>
        <div id="dominant-host"></div>
      </section>
      ${level === "state" ? stateMetroChips(id) : ""}
      <p class="d-foot">${level === "metro" ? `${esc(geoShort(sel))} unemployment is not seasonally adjusted; state and national rates are. ` : ""}Industry percentages are from the Current Employment Statistics (not seasonally adjusted); "vs U.S." divides an industry's local percentage of jobs by its national percentage.${level === "metro" && sel.kind === "micro" ? " BLS does not publish industry series for micropolitan areas." : ""}</p>`;

    if (prof.length) {
      const toggle = document.getElementById("rose-toggle");
      toggle.onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; app.roseView = b.dataset.v; renderDrawer(); };
      if (app.roseView === "table") renderTable(prof, jobs); else renderRose(prof);
      renderDominant(prof, level);
    } else {
      document.getElementById("rose-host").innerHTML = `<p class="rose-note">BLS publishes no industry employment series for this area, so only the unemployment picture is shown.</p>`;
    }
  }

  function stateMetroChips(fips) {
    const list = metroList.filter((m) => (m.states || []).includes(fips)).sort((a, b) => jobsOf("metro", b.id) - jobsOf("metro", a.id));
    if (!list.length) return "";
    return `<section class="d-section"><div class="d-section-head"><div class="d-section-title">Metropolitan areas in ${esc(STATE_NAME(fips))}</div><div class="d-section-sub">on this map</div></div>
      <div class="chips">${list.map((m) => `<button class="chip" data-id="${m.id}"><b>${esc(m.short)}</b> ${esc(geoShort(m))}${(m.capital_of || []).some((c) => c.state === fips) ? `<span class="cap">capital</span>` : ""}</button>`).join("")}</div></section>`;
  }
  body.addEventListener("click", (ev) => {
    const c = ev.target.closest(".chip[data-id]");
    if (c) select("metro", c.dataset.id, true);
  });

  /* ------------------------------------------------------------------ rose */
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
    const ra = angleOf(0) + step / 2; // ring labels ride the spoke between the first two petals
    for (const sh of [0.1, 0.2, 0.3])
      g.append("text").attr("class", "rose-ring-label").attr("text-anchor", "start")
        .attr("x", rs(sh) * Math.cos(ra) + 2).attr("y", rs(sh) * Math.sin(ra) - 2).text(sh * 100 + "%");

    const arc = d3.arc().innerRadius(0).padAngle(0.012).padRadius(R).cornerRadius(2)
      .startAngle((i) => angleOf(i) + Math.PI / 2 - step / 2 + 0.01).endAngle((i) => angleOf(i) + Math.PI / 2 + step / 2 - 0.01);

    const petals = g.selectAll(".petal").data(SECTORS.map(([code], i) => ({ i, d: byCode.get(code) })).filter((x) => x.d)).join("path")
      .attr("class", "petal")
      .attr("fill", ({ d }) => lqColor(d.lq))
      .attr("fill-opacity", 0.95)
      .attr("d", ({ i, d }) => arc.outerRadius(rs(Math.min(d.share, SHARE_MAX)))(i))
      .on("mousemove", (ev, { d }) => showTip(petalTip(d), ev))
      .on("mouseleave", () => { hideTip(); petals.classed("is-dim", false); })
      .on("mouseenter", (_, x) => petals.classed("is-dim", (y) => y !== x));

    // U.S. profile outline: what each petal would be if the area matched the national mix
    if (US_SHARE.size) {
      const refArc = d3.arc().innerRadius((i) => rs(US_SHARE.get(SECTORS[i][0]) || 0) - 0.8).outerRadius((i) => rs(US_SHARE.get(SECTORS[i][0]) || 0) + 0.8)
        .startAngle((i) => angleOf(i) + Math.PI / 2 - step / 2 + 0.02).endAngle((i) => angleOf(i) + Math.PI / 2 + step / 2 - 0.02);
      g.selectAll(".rose-ref").data(SECTORS.map((_, i) => i)).join("path").attr("class", "rose-ref").attr("d", (i) => refArc(i));
    }

    // labels: full sector name (wrapped) + its percentage, on every petal
    SECTORS.forEach(([code, , , lines], i) => {
      const d = byCode.get(code); if (!d) return;
      const a = angleOf(i), lr = R + 14;
      const x = lr * Math.cos(a), y = lr * Math.sin(a);
      const anchor = Math.abs(Math.cos(a)) < 0.25 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
      const total = lines.length + 1, lh = 13;
      const y0 = y - ((total - 1) * lh) / 2 + 4 + (Math.abs(Math.cos(a)) < 0.25 ? (Math.sin(a) < 0 ? -8 : 8) : 0);
      const t = g.append("text").attr("class", "rose-label" + (lead && lead.code === code ? " is-lead" : "")).attr("text-anchor", anchor);
      lines.forEach((ln, j) => t.append("tspan").attr("x", x).attr("y", y0 + j * lh).text(ln));
      t.append("tspan").attr("class", "rose-value").attr("x", x).attr("y", y0 + lines.length * lh)
        .text(`${fmtPct(d.share)}${d.lq != null ? ` · ${d.lq.toFixed(2)}×` : ""}`);
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

  /* -------------------------------------------------- dominant sector card */
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
      <p class="dom-second">${largest.code === lead.code
        ? `It is also the <b>largest employer</b> in the area.`
        : `Largest employer: <b>${esc(largest.industry)}</b>, ${fmtPct(largest.share)} of jobs (${largest.lq != null ? largest.lq.toFixed(2) + "× the U.S." : "–"}).`}
        ${runnersUp.length ? ` Also concentrated: ${runnersUp.map((d) => `<b>${esc(d.industry)}</b> ${d.lq.toFixed(2)}×`).join(", ")}.` : ""}</p>
    </div>`;
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
