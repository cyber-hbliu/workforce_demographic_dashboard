/* The Workforce Monitor — app.js
   Levels: nation / state / metro. Data from docs/data/*.json (built by
   scripts/fetch_bls.py). Map topology is pre-projected us-atlas albers. */

(async function () {
  const [meta, national, states, metros, rose, topo] = await Promise.all([
    "data/meta.json", "data/national.json", "data/states.json",
    "data/metros.json", "data/rose.json", "lib/states-albers-10m.json",
  ].map((u) => fetch(u).then((r) => r.json())));

  const SHORT_IND = {
    "Construction": "Construction",
    "Manufacturing": "Manufacturing",
    "Trade, Transportation & Utilities": "Trade & Transport",
    "Information": "Information",
    "Financial Activities": "Financial",
    "Professional & Business Services": "Prof. & Business",
    "Education & Health Services": "Educ. & Health",
    "Leisure & Hospitality": "Leisure & Hosp.",
    "Other Services": "Other Services",
    "Government": "Government",
  };

  const fmtMonth = (d) => {
    const [y, m] = d.split("-");
    return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  };
  const fmtNum = d3.format(",");
  const last = (rows) => (rows && rows.length ? rows[rows.length - 1] : null);
  const yearAgo = (rows) => (rows && rows.length > 12 ? rows[rows.length - 13] : null);

  const state = { level: "nation", id: null, search: "" };

  const tip = document.getElementById("tip");
  const showTip = (html, ev) => {
    tip.innerHTML = html;
    tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 12, innerWidth - 260) + "px";
    tip.style.top = ev.clientY + 12 + "px";
  };
  const hideTip = () => (tip.hidden = true);

  document.getElementById("updated").textContent =
    meta.source === "sample"
      ? "sample data — first fetch pending"
      : `updated ${meta.updated} · data through ${fmtMonth(meta.latest_state_month)}`;

  /* ------------------------------------------------------------- helpers */
  function areaEntries() {
    if (state.level === "state")
      return Object.entries(states).map(([id, s]) => ({ id, name: s.name, series: s.series }));
    if (state.level === "metro")
      return Object.entries(metros).map(([id, m]) => ({ id, name: m.short, series: m.series }));
    return [];
  }
  function current() {
    if (state.level === "state" && state.id) return { name: states[state.id].name, series: states[state.id].series };
    if (state.level === "metro" && state.id) return { name: metros[state.id].name, series: metros[state.id].series };
    return { name: "United States", series: { unemp_rate: national.unemp_rate } };
  }
  function roseData() {
    if (state.level === "state" && state.id) return rose.states[state.id] || [];
    if (state.level === "metro" && state.id) return rose.metros[state.id] || [];
    return null; // nation
  }

  /* ---------------------------------------------------------------- rail */
  const listEl = document.getElementById("area-list");
  function renderList() {
    const q = state.search.toLowerCase();
    const rows = areaEntries()
      .filter((a) => a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    listEl.innerHTML = "";
    for (const a of rows) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "area-item" + (a.id === state.id ? " is-selected" : "");
      const r = last(a.series.unemp_rate);
      btn.innerHTML = `<span>${a.name}</span><span class="rate">${r ? r.value.toFixed(1) : "–"}</span>`;
      btn.onclick = () => select(state.level, a.id);
      li.appendChild(btn);
      listEl.appendChild(li);
    }
  }

  document.querySelectorAll(".level-btn").forEach((b) => {
    b.onclick = () => {
      state.level = b.dataset.level;
      state.id = null;
      document.querySelectorAll(".level-btn").forEach((x) => x.classList.toggle("is-active", x === b));
      renderAll();
    };
  });
  document.getElementById("search").oninput = (e) => {
    state.search = e.target.value;
    renderList();
  };

  function select(level, id) {
    state.level = level;
    state.id = id;
    document.querySelectorAll(".level-btn").forEach((x) =>
      x.classList.toggle("is-active", x.dataset.level === level));
    renderAll();
  }

  /* ---------------------------------------------------------------- hero */
  function renderHero() {
    const cur = current();
    const r = last(cur.series.unemp_rate);
    const prev = yearAgo(cur.series.unemp_rate);
    document.getElementById("hero-eyebrow").textContent =
      state.level === "nation" ? "National · CPS" :
      state.level === "state" ? "State · LAUS" : "Metropolitan area · LAUS";
    document.getElementById("hero-name").textContent = cur.name;
    document.getElementById("hero-rate").textContent = r ? r.value.toFixed(1) : "–";
    document.getElementById("hero-delta").textContent =
      r && prev
        ? `${r.value >= prev.value ? "+" : "−"}${Math.abs(r.value - prev.value).toFixed(1)} pt vs ${fmtMonth(prev.date)} · as of ${fmtMonth(r.date)}`
        : "";
    const statsEl = document.getElementById("stats");
    statsEl.innerHTML = "";
    const rows = [];
    const lf = last(cur.series.labor_force);
    if (lf) rows.push(["Labor force", fmtNum(lf.value)]);
    const emp = last(cur.series.employed);
    if (emp) rows.push(["Employed", fmtNum(emp.value)]);
    const unemp = last(cur.series.unemployed);
    if (unemp) rows.push(["Unemployed", fmtNum(unemp.value)]);
    if (state.level === "nation") {
      const p = last(national.payrolls);
      if (p) rows.push(["Nonfarm payrolls", fmtNum(Math.round(p.value)) + "k"]);
    }
    for (const [k, v] of rows) {
      const d = document.createElement("div");
      d.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
      statsEl.appendChild(d);
    }
  }

  /* ----------------------------------------------------------------- map */
  const mapW = 975, mapH = 610;
  const mapSvg = d3.select("#map").append("svg").attr("viewBox", `0 0 ${mapW} ${mapH}`);
  const geo = topojson.feature(topo, topo.objects.states).features
    .filter((f) => states[f.id]); // 50 states + DC
  const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const rateOf = (fips) => last(states[fips]?.series.unemp_rate)?.value ?? null;
  const rateExtent = d3.extent(geo.map((f) => rateOf(f.id)).filter((v) => v != null));
  const color = d3.scaleSequential(d3.interpolateRgb("#eae4d6", "#6b51c0")).domain(rateExtent);

  const statesG = mapSvg.append("g");
  statesG.selectAll("path").data(geo).join("path")
    .attr("class", "state-path")
    .attr("d", d3.geoPath())
    .attr("fill", (d) => (rateOf(d.id) != null ? color(rateOf(d.id)) : "#ddd"))
    .on("mousemove", (ev, d) =>
      showTip(`${states[d.id].name} · ${rateOf(d.id)?.toFixed(1) ?? "–"}%`, ev))
    .on("mouseleave", hideTip)
    .on("click", (_, d) => select("state", d.id));

  const dotsG = mapSvg.append("g");
  function renderMap() {
    statesG.selectAll("path")
      .classed("is-selected", (d) => state.level === "state" && d.id === state.id)
      .attr("fill-opacity", state.level === "metro" ? 0.35 : 1);
    const dots = state.level === "metro" ? Object.entries(metros) : [];
    dotsG.selectAll("circle").data(dots, (d) => d[0]).join("circle")
      .attr("class", "metro-dot")
      .attr("transform", (d) => `translate(${projection([d[1].lon, d[1].lat])})`)
      .attr("r", (d) => Math.max(4, Math.sqrt((last(d[1].series.labor_force)?.value ?? 0) / 60000)))
      .classed("is-selected", (d) => d[0] === state.id)
      .on("mousemove", (ev, d) =>
        showTip(`${d[1].name}<br>${last(d[1].series.unemp_rate)?.value.toFixed(1) ?? "–"}% unemployment`, ev))
      .on("mouseleave", hideTip)
      .on("click", (_, d) => select("metro", d[0]));
    document.getElementById("map-month").textContent =
      meta.latest_state_month ? fmtMonth(meta.latest_state_month) : "";
  }

  const ramp = document.getElementById("ramp");
  const rampBar = document.createElement("div");
  rampBar.className = "ramp-bar";
  rampBar.style.background = `linear-gradient(to right, ${color(rateExtent[0])}, ${color(rateExtent[1])})`;
  ramp.append(document.createTextNode(rateExtent[0]?.toFixed(1) + "%"), rampBar,
              document.createTextNode(rateExtent[1]?.toFixed(1) + "%"));

  /* --------------------------------------------------------------- trend */
  const tW = 860, tH = 300, tM = { t: 14, r: 16, b: 26, l: 34 };
  const trendSvg = d3.select("#trend").append("svg").attr("viewBox", `0 0 ${tW} ${tH}`);
  const tX = trendSvg.append("g").attr("class", "axis").attr("transform", `translate(0,${tH - tM.b})`);
  const tY = trendSvg.append("g").attr("class", "axis").attr("transform", `translate(${tM.l},0)`);
  const natPath = trendSvg.append("path").attr("class", "trend-nat");
  const selPath = trendSvg.append("path").attr("class", "trend-line");
  const natLabel = trendSvg.append("text").attr("class", "trend-label").attr("fill", "#9c7326");
  const selLabel = trendSvg.append("text").attr("class", "trend-label").attr("fill", "#6b51c0");
  const parse = d3.timeParse("%Y-%m");

  function renderTrend() {
    const cur = current();
    const sel = (cur.series.unemp_rate || []).map((d) => ({ t: parse(d.date), v: d.value }));
    const nat = national.unemp_rate.map((d) => ({ t: parse(d.date), v: d.value }));
    const both = sel.concat(state.level === "nation" ? [] : nat);
    if (!both.length) return;
    const x = d3.scaleTime().domain(d3.extent(both, (d) => d.t)).range([tM.l, tW - tM.r]);
    const y = d3.scaleLinear().domain([0, d3.max(both, (d) => d.v)]).nice().range([tH - tM.b, tM.t]);
    const line = d3.line().x((d) => x(d.t)).y((d) => y(d.v));
    tX.call(d3.axisBottom(x).ticks(8).tickSizeOuter(0));
    tY.call(d3.axisLeft(y).ticks(5).tickSize(-(tW - tM.l - tM.r)).tickSizeOuter(0));
    tY.selectAll("line").attr("stroke-opacity", 0.6);
    selPath.attr("d", line(sel));
    natPath.attr("d", state.level === "nation" ? null : line(nat));
    const endSel = sel[sel.length - 1], endNat = nat[nat.length - 1];
    selLabel.attr("x", tW - tM.r - 2).attr("y", y(endSel.v) - 6)
      .attr("text-anchor", "end").text(state.level === "nation" ? "U.S." : "selection");
    natLabel.attr("x", tW - tM.r - 2)
      .attr("y", state.level === "nation" ? -20 : y(endNat.v) + 12)
      .attr("text-anchor", "end").text(state.level === "nation" ? "" : "U.S.");
  }

  /* -------------------------------------------------------- ribbon radar */
  const rW = 340, rH = 372, rC = [rW / 2, rH / 2 + 4], rMax = 118;
  const roseEl = d3.select("#rose");

  function renderRose() {
    roseEl.selectAll("*").remove();
    const data = roseData();
    if (data === null) {
      roseEl.append("p").attr("class", "rose-note")
        .text("The national profile is the reference itself: every industry sits on the ring at 1.0. Choose a state or metro to see its shape against the U.S.");
      return;
    }
    if (!data.length) {
      roseEl.append("p").attr("class", "rose-note").text("No industry data published for this area.");
      return;
    }
    const svg = roseEl.append("svg").attr("viewBox", `0 0 ${rW} ${rH}`);
    const g = svg.append("g").attr("transform", `translate(${rC})`);
    const lqMax = Math.max(2, d3.max(data, (d) => d.lq) * 1.08);
    const r = d3.scaleLinear().domain([0, lqMax]).range([0, rMax]);
    const angle = (i) => (i / data.length) * 2 * Math.PI - Math.PI / 2;

    for (const ring of [0.5, 1.5, 2]) if (ring < lqMax)
      g.append("circle").attr("class", "rose-ring").attr("r", r(ring));
    data.forEach((_, i) =>
      g.append("line").attr("class", "rose-spoke")
        .attr("x2", r(lqMax) * Math.cos(angle(i))).attr("y2", r(lqMax) * Math.sin(angle(i))));
    g.append("circle").attr("class", "rose-ring-one").attr("r", r(1));
    g.append("text").attr("class", "rose-scale").attr("x", 3).attr("y", -r(1) - 3).text("1.0 = U.S.");

    const pts = data.map((d, i) => [r(d.lq) * Math.cos(angle(i)), r(d.lq) * Math.sin(angle(i))]);
    const ribbon = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.8));
    g.append("path").attr("class", "ribbon-fill").attr("d", ribbon(pts));
    for (const w of [3.2, 1.6, 0.7])
      g.append("path").attr("class", "ribbon").attr("stroke-width", w)
        .attr("stroke-opacity", w > 2 ? 0.25 : w > 1 ? 0.55 : 1).attr("d", ribbon(pts));

    g.selectAll(".rose-tick").data(data).join("circle")
      .attr("class", "rose-tick").attr("r", 3)
      .attr("cx", (_, i) => pts[i][0]).attr("cy", (_, i) => pts[i][1])
      .on("mousemove", (ev, d) => showTip(
        `${d.industry}<br>LQ ${d.lq.toFixed(2)} · ${(d.share * 100).toFixed(1)}% of local jobs`, ev))
      .on("mouseleave", hideTip);

    const pills = g.selectAll(".pill-g").data(data).join("g");
    pills.each(function (d, i) {
      const label = SHORT_IND[d.industry] || d.industry;
      const a = angle(i), pr = r(lqMax) + 16;
      let px = pr * Math.cos(a), py = pr * Math.sin(a);
      px = Math.max(-rC[0] + 58, Math.min(rC[0] - 58, px * 1.12));
      const w = label.length * 5.3 + 14;
      const el = d3.select(this);
      el.append("rect").attr("class", "rose-pill")
        .attr("x", px - w / 2).attr("y", py - 9).attr("width", w).attr("height", 18)
        .attr("rx", 9);
      el.append("text").attr("class", "rose-pill-text")
        .attr("x", px).attr("y", py + 3).attr("text-anchor", "middle").text(label);
    });
  }

  /* ----------------------------------------------------------------- go */
  function renderAll() {
    renderList();
    renderHero();
    renderMap();
    renderTrend();
    renderRose();
  }
  renderAll();
})();
