const $ = (s) => document.querySelector(s);
const SECTIONS = ["home", "dashboard", "demo", "calculator", "recommendations", "maintenance", "awareness", "about"];
const NS = "http://www.w3.org/2000/svg";

async function api(url, opts) {
  let res;
  try { res = await fetch(url, opts); }
  catch { throw new Error("Cannot reach the server. Please check that it is running."); }
  if (!res.ok) {
    let msg = "Something went wrong. Please try again.";
    try {
      const d = await res.json();
      if (typeof d.detail === "string") msg = d.detail;
      else if (Array.isArray(d.detail)) msg = "Please check the numbers you entered.";
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ---------- navigation ---------- */
function route() {
  let id = (location.hash || "#home").slice(1);
  if (!SECTIONS.includes(id)) id = "home";
  SECTIONS.forEach((s) => ($("#" + s).hidden = s !== id));
  document.querySelectorAll("nav a").forEach((a) =>
    a.getAttribute("href") === "#" + id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
  refresh(id);
}
function refresh(id) {
  if (id === "dashboard") loadDashboard();
  if (id === "recommendations") loadRecommendations();
  if (id === "maintenance") loadTasks();
}
window.addEventListener("hashchange", route);
setInterval(() => {
  const id = (location.hash || "#home").slice(1);
  if (id === "dashboard" || id === "recommendations") refresh(id);
}, 30000);

/* ---------- charts (plain SVG, no libraries) ---------- */
function svg(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function drawChart(target, points, color, type) {
  target.replaceChildren();
  if (!points.length) { target.append(el("p", "muted", "No readings yet.")); return; }
  const W = 600, H = 220, L = 34, R = 10, T = 10, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Chart of recent readings" });
  [0, 50, 100].forEach((v) => {
    const y = T + ih - (v / 100) * ih;
    s.append(svg("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "#d3e5ea" }));
    const t = svg("text", { x: L - 6, y: y + 4, "text-anchor": "end" });
    t.textContent = v;
    s.append(t);
  });
  const step = iw / points.length;
  const xs = points.map((_, i) => L + step * i + step / 2);
  const ys = points.map((p) => T + ih - (Math.max(0, Math.min(100, p.v)) / 100) * ih);
  if (type === "bar") {
    points.forEach((p, i) => {
      const h = T + ih - ys[i];
      s.append(svg("rect", { x: xs[i] - step * 0.35, y: ys[i], width: step * 0.7, height: h, fill: color, rx: 2 }));
    });
  } else {
    s.append(svg("polygon", { points: `${xs[0]},${T + ih} ` + xs.map((x, i) => `${x},${ys[i]}`).join(" ") + ` ${xs.at(-1)},${T + ih}`, fill: color, opacity: 0.12 }));
    s.append(svg("polyline", { points: xs.map((x, i) => `${x},${ys[i]}`).join(" "), fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "round" }));
    s.append(svg("circle", { cx: xs.at(-1), cy: ys.at(-1), r: 4.5, fill: color }));
  }
  [[0, "start"], [points.length - 1, "end"]].forEach(([i, anchor]) => {
    const t = svg("text", { x: i === 0 ? L : W - R, y: H - 8, "text-anchor": anchor });
    t.textContent = fmtTime(points[i].t);
    s.append(t);
  });
  target.append(s);
}

/* ---------- dashboard ---------- */
async function loadDashboard() {
  try {
    const d = await api("/api/dashboard");
    const b = $("#mode-banner"), r = d.latest;
    if (d.mode === "live") {
      b.className = "banner live";
      b.textContent = "Live data from your sensors. Last reading: " + fmtDate(d.last_seen) + ".";
    } else {
      b.className = "banner demo";
      b.textContent = "DEMO DATA – sample numbers for preview only. No sensor is connected" +
        (d.last_seen ? " (last real reading: " + fmtDate(d.last_seen) + ")." : " yet.");
    }
    $("#s-rain").textContent = r.rain_label;
    $("#s-rain-sub").textContent = "Wetness " + r.rain_percent + "%";
    $("#s-level").textContent = r.level_percent + "%";
    $("#s-meter").style.width = r.level_percent + "%";
    $("#s-liters").textContent = r.stored_liters.toLocaleString();
    const st = $("#s-status");
    st.textContent = r.status;
    st.className = "badge" + (["Low", "Nearly full"].includes(r.status) ? " warn" : ["Empty", "Full"].includes(r.status) ? " bad" : "");
    drawChart($("#chart-level"), d.history.map((h) => ({ t: h.ts, v: h.level_percent })), "#0b5d7a", "line");
    drawChart($("#chart-rain"), d.history.map((h) => ({ t: h.ts, v: h.rain_percent })), "#2bb3c6", "bar");
    const f = $("#settings-form");
    if (!f.dataset.filled) {
      for (const k in d.settings) f.elements[k].value = d.settings[k];
      f.dataset.filled = "1";
    }
  } catch (e) {
    const b = $("#mode-banner");
    b.className = "banner demo";
    b.textContent = e.message;
  }
}

$("#settings-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, msg = $("#settings-msg");
  const body = {};
  ["tank_height_cm", "tank_capacity_l", "sensor_offset_cm"].forEach((k) => (body[k] = parseFloat(f.elements[k].value)));
  try {
    await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    msg.className = "msg ok"; msg.textContent = "Saved.";
    loadDashboard();
  } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
});

/* ---------- calculator ---------- */
$("#calc-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("#calc-msg"), out = $("#calc-result");
  msg.textContent = "";
  const area = parseFloat($("#c-area").value) * parseFloat($("#c-unit").value);
  const body = { roof_area_m2: area, rainfall_mm: parseFloat($("#c-rain").value), efficiency: parseFloat($("#c-eff").value) };
  try {
    const r = await api("/api/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    out.replaceChildren(
      el("p", "muted", "You can collect about"),
      el("p", "big", r.liters.toLocaleString() + " litres"),
      el("p", "", "That is about " + r.buckets_20l.toLocaleString() + " buckets of 20 litres.")
    );
  } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
});

/* ---------- recommendations ---------- */
async function loadRecommendations() {
  const list = $("#rec-list"), b = $("#rec-banner");
  try {
    const d = await api("/api/recommendations");
    b.className = "banner " + (d.mode === "live" ? "live" : "demo");
    b.textContent = d.mode === "live" ? "Based on your latest sensor readings." : "DEMO DATA – tips are based on sample numbers because no sensor is connected.";
    list.replaceChildren(...d.items.map((i) => {
      const c = el("div", "card note " + (i.kind === "good" ? "" : i.kind));
      const w = el("div");
      w.append(el("h3", "", i.title), el("p", "", i.text));
      c.append(w);
      return c;
    }));
  } catch (e) { b.className = "banner demo"; b.textContent = e.message; list.replaceChildren(); }
}

/* ---------- maintenance ---------- */
const PILL = { ok: "On track", due_soon: "Due soon", overdue: "Overdue", not_recorded: "Not recorded yet" };
async function loadTasks() {
  const list = $("#task-list");
  try {
    const tasks = await api("/api/maintenance");
    list.replaceChildren(...tasks.map((t) => {
      const c = el("div", "card task " + t.status);
      const info = el("div");
      let when = "Do this every " + t.interval_days + " days.";
      if (t.days_left !== null) when = t.days_left < 0 ? "Overdue by " + -t.days_left + " days." : "Next due in " + t.days_left + " days.";
      const pill = el("span", "pill " + t.status, PILL[t.status]);
      info.append(el("h3", "", t.name), el("p", "muted", t.tip), el("p", "", when + " "));
      info.lastChild.append(pill);
      const btn = el("button", "btn btn-small", "Mark as done");
      btn.type = "button";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try { await api("/api/maintenance/" + t.id + "/done", { method: "POST" }); loadTasks(); }
        catch (e) { btn.disabled = false; alert(e.message); }
      });
      c.append(info, btn);
      return c;
    }));
  } catch (e) { list.replaceChildren(el("p", "msg err", e.message)); }
}


/* ---------- rain drops ---------- */
document.querySelectorAll(".rain").forEach((r) => {
  for (let i = 0; i < +r.dataset.drops; i++) {
    const d = document.createElement("i");
    d.style.left = (i + Math.random()) * (100 / r.dataset.drops) + "%";
    d.style.animationDelay = (Math.random() * 1.2).toFixed(2) + "s";
    d.style.animationDuration = (0.8 + Math.random() * 0.6).toFixed(2) + "s";
    r.append(d);
  }
});

/* ---------- workflow demo (runs in the browser, saves nothing) ---------- */
const DEMO = { h: 150, cap: 1000, off: 20 };
const nodes = [...document.querySelectorAll("#pipe .node")];
const rIn = $("#d-r"), dIn = $("#d-d"), logEl = $("#d-log");
let playing = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function demoCalc() {
  const rain = +rIn.value, dist = +dIn.value;
  const depth = Math.max(0, Math.min(DEMO.h, DEMO.h - (dist - DEMO.off)));
  const pct = Math.round((depth / DEMO.h) * 100);
  const status = pct < 10 ? "Empty" : pct < 30 ? "Low" : pct < 85 ? "Good" : pct < 95 ? "Nearly full" : "Full";
  let tip = ["good", "Water level is healthy. No action needed."];
  if (pct >= 90) tip = ["warn", rain >= 5 ? "Almost full and still raining. Use or divert water now." : "Almost full. Check the overflow pipe."];
  else if (pct < 10) tip = ["warn", "Tank is almost empty. Use water only for essentials."];
  else if (pct < 30) tip = ["good", "Water is low. Keep it for plants and cleaning."];
  else if (rain >= 35) tip = ["good", "Heavy rain: a good time to collect. Check gutters and filter."];
  return { rain, dist, pct, status, tip, liters: Math.round((pct / 100) * DEMO.cap) };
}
function demoRender() {
  const d = demoCalc();
  $("#d-rv").textContent = d.rain + "%"; $("#d-dv").textContent = d.dist + " cm";
  $("#d-tank").style.setProperty("--lvl", d.pct + "%"); $("#d-pct").textContent = d.pct + "%";
  $("#d-rain").style.setProperty("--rainop", d.rain < 5 ? 0 : 0.35 + d.rain / 160);
  $("#o-lvl").textContent = d.pct + "%"; $("#o-l").textContent = d.liters.toLocaleString(); $("#o-st").textContent = d.status;
  $("#d-tip").className = "demo-tip " + (d.tip[0] === "warn" ? "warn" : ""); $("#d-tip").textContent = d.tip[1];
  return d;
}
function log(msg, cls) { const l = el("div", cls, msg); logEl.append(l); logEl.scrollTop = logEl.scrollHeight; }
function setNode(i) { nodes.forEach((n, k) => { n.classList.toggle("on", k === i); n.classList.toggle("done", k < i); }); $("#pipe").style.setProperty("--prog", i < 0 ? 0 : i / 4); }
async function sendOnce() {
  const d = demoRender(), t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const steps = [
    ["Sensors read rain " + d.rain + "% and distance " + d.dist + " cm", ""],
    ["ESP32 packs the values into JSON", ""],
    ["POST /api/readings {\"rain_percent\":" + d.rain + ",\"distance_cm\":" + d.dist + "}", "w"],
    ["Server: level " + d.pct + "%, " + d.liters + " L, status " + d.status, "k"],
    ["Website updated. Tip: " + d.tip[1], "k"],
  ];
  for (let i = 0; i < 5; i++) { setNode(i); log("[" + t + "] " + steps[i][0], steps[i][1]); await sleep(i === 4 ? 900 : 650); }
  nodes.forEach((n) => { n.classList.remove("on"); n.classList.add("done"); });
}
[rIn, dIn].forEach((s) => s.addEventListener("input", demoRender));
[rIn, dIn].forEach((s) => s.addEventListener("change", () => { if (!playing) sendOnce(); }));
$("#d-play").addEventListener("click", async () => {
  if (playing) return;
  playing = true; $("#d-play").disabled = true; logEl.replaceChildren();
  const script = [[0, 105], [35, 95], [80, 70], [95, 50], [60, 35], [10, 28], [0, 28]];
  for (const [r, d] of script) { rIn.value = r; dIn.value = d; await sendOnce(); await sleep(300); }
  log("Storm over. Your tank is filled and advice is ready.", "k");
  playing = false; $("#d-play").disabled = false;
});
$("#d-reset").addEventListener("click", () => { if (playing) return; rIn.value = 0; dIn.value = 100; logEl.replaceChildren(); setNode(-1); nodes.forEach((n) => n.classList.remove("done")); demoRender(); log("Ready. Press play or move a slider."); });
demoRender(); log("Ready. Press play or move a slider.");

route();
