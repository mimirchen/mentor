/* 领路人 Mentor — app logic
   Flow: auth → arc check → (interview | import) → study (journey panel) → session → energy check-in → distill.
   All persistence via the user's own supabase client (RLS owner-only);
   the Edge Function only reads the arc + calls the model. */

const C = window.MENTOR_CONFIG;
const I = window.MENTOR_I18N;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-guard", "view-onboard", "view-home", "view-arc", "view-chat"];
function show(view) {
  VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== view));
  const inApp = view !== "view-guard";
  $("nav-signout").classList.toggle("hidden", !inApp);
  $("nav-home").classList.toggle("hidden", !(inApp && view !== "view-home" && state.arc));
  $("nav-arc").classList.toggle("hidden", !(inApp && state.arc && view !== "view-arc"));
  window.scrollTo(0, 0);
}
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), ms);
}

const state = { user: null, arc: null, session: null, kind: null, msgs: [], busy: false };

// ---------- init ----------
I.apply();
$("lang-toggle").onclick = () => I.toggle();
window.addEventListener("mentor:lang", () => { if (!$("view-home").classList.contains("hidden")) loadJourney(); });

(async function init() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { show("view-guard"); return; }
  state.user = data.session.user;
  await loadArc();
  route();
})();
sb.auth.onAuthStateChange((_e, session) => {
  if (!session) { state.user = null; show("view-guard"); }
});

async function loadArc() {
  const { data, error } = await sb.from("mentor_arcs").select("doc").maybeSingle();
  if (error) console.error(error);
  state.arc = data?.doc ?? null;
}
function route() {
  if (!state.user) { show("view-guard"); return; }
  if (state.arc) { show("view-home"); loadJourney(); } else { show("view-onboard"); }
}

// ---------- journey panel ----------
async function loadJourney() {
  const { data, error } = await sb.from("mentor_sessions")
    .select("kind, started_at, ended_at, energy")
    .not("ended_at", "is", null)
    .order("started_at", { ascending: true });
  if (error) { console.error(error); return; }
  const done = (data || []).filter((s) => s.kind !== "interview");
  $("j-sessions").textContent = done.length;

  // streak: consecutive ISO weeks (ending at current or previous week) with ≥1 session
  const weekKey = (d) => {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7)); // ISO week anchor (Thu)
    const yStart = new Date(x.getFullYear(), 0, 4);
    const w = 1 + Math.round(((x - yStart) / 864e5 - 3 + ((yStart.getDay() + 6) % 7)) / 7);
    return x.getFullYear() * 100 + w;
  };
  const weeks = new Set(done.map((s) => weekKey(s.started_at)));
  let streak = 0;
  const cursor = new Date();
  if (!weeks.has(weekKey(cursor))) cursor.setDate(cursor.getDate() - 7); // 本周还没做不打断连续
  while (weeks.has(weekKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 7); }
  $("j-streak").textContent = streak;

  // countdown to next Sunday 20:00
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  next.setHours(20, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7);
  const days = Math.floor((next - now) / 864e5);
  $("j-next").textContent = days === 0 ? "☾" : days;
  $("j-next-cap").textContent = days === 0 ? I.t("j_today") : `${I.t("j_next")} (${I.t("j_days")})`;

  renderSparkline(done.filter((s) => s.energy != null));
}

function renderSparkline(points) {
  const box = $("sparkline");
  if (points.length < 2) {
    box.innerHTML = `<p class="note">${I.t("curve_empty")}</p>`;
    $("curve-range").textContent = "";
    return;
  }
  const W = 460, H = 72, PAD = 8, PR = 34;
  const n = points.length;
  const x = (i) => PAD + (i * (W - PAD - PR)) / (n - 1);
  const y = (e) => PAD + ((10 - e) * (H - 2 * PAD)) / 9; // energy 1–10, higher = up
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.energy).toFixed(1)}`).join(" ");
  const last = points[n - 1];
  const fmt = (d) => new Date(d).toLocaleDateString(I.lang === "zh" ? "zh-CN" : "en-GB", { month: "short", day: "numeric" });
  $("curve-range").textContent = `${fmt(points[0].started_at)} – ${fmt(last.started_at)}`;
  // single series on dark panel: 2px amber line, baseline grid at 5, last value direct-labeled
  box.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="energy 1-10 over sessions">
    <line x1="${PAD}" y1="${y(5)}" x2="${W - PR}" y2="${y(5)}" stroke="rgba(236,234,227,0.12)" stroke-width="1" stroke-dasharray="3 4"/>
    <polyline points="${pts}" fill="none" stroke="#C9A227" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(n - 1)}" cy="${y(last.energy)}" r="3.5" fill="#C9A227" stroke="#1C1D21" stroke-width="2"/>
    <text x="${x(n - 1) + 9}" y="${y(last.energy) + 4}" fill="#ECEAE3" font-size="13" font-family="inherit">${last.energy}</text>
  </svg>`;
}

// ---------- calendar (.ics) ----------
$("btn-calendar").onclick = () => {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
  next.setHours(20, 0, 0, 0);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const local = (d) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T200000`;
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DoubleMi//Mentor//EN",
    "BEGIN:VEVENT",
    `UID:weekly-calibration@mentor.doublemi.ai`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${local(next)}`,
    "DURATION:PT30M",
    "RRULE:FREQ=WEEKLY;BYDAY=SU",
    `SUMMARY:${I.t("ics_title")}`,
    `DESCRIPTION:${I.t("ics_desc")}`,
    "URL:https://mentor.doublemi.ai/app.html",
    "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${I.t("ics_title")}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url; a.download = "mentor-weekly-calibration.ics"; a.click();
  URL.revokeObjectURL(url);
};

// ---------- nav ----------
$("nav-signout").onclick = async () => { await sb.auth.signOut(); location.href = "index.html"; };
$("nav-home").onclick = () => route();
function showArc() {
  const el = $("arc-content");
  try { el.innerHTML = marked.parse(state.arc || ""); }
  catch { el.textContent = state.arc || ""; }
  show("view-arc");
}
$("nav-arc").onclick = showArc;
$("btn-view-arc").onclick = showArc;

// ---------- onboarding ----------
$("btn-interview").onclick = () => startSession("interview");
$("btn-import").onclick = () => $("import-box").classList.toggle("hidden");
$("btn-import-save").onclick = async () => {
  const doc = $("import-text").value.trim();
  if (doc.length < 100) { toast(I.t("too_short")); return; }
  const { error } = await sb.from("mentor_arcs").upsert({ user_id: state.user.id, doc, updated_at: new Date().toISOString() });
  if (error) { toast(error.message); return; }
  state.arc = doc;
  toast(I.t("imported"));
  route();
};

// ---------- sessions ----------
$("btn-weekly").onclick = () => startSession("calibration");
$("btn-urgent").onclick = () => startSession("urgent");

async function startSession(kind) {
  const { data, error } = await sb.from("mentor_sessions")
    .insert({ user_id: state.user.id, kind }).select("id").single();
  if (error) { toast(error.message); return; }
  state.session = data.id;
  state.kind = kind;
  state.msgs = [];
  $("chat-log").innerHTML = "";
  $("chat-title").textContent = I.t("t_" + kind);
  show("view-chat");
  await send(I.t("opener_" + kind), { silent: true });
}

function render(role, text, cls = "") {
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "user" : "mentor"} ${cls}`;
  div.textContent = text;
  $("chat-log").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div;
}

async function callFunction(body) {
  const { data: { session } } = await sb.auth.getSession();
  const resp = await fetch(C.FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (json.error === "waitlist") {
      // not yet invited: quietly queue them so the curator sees the demand
      sb.from("waitlist").insert({ email: session.user.email, locale: I.lang, source: "mentor" }).then(() => {});
      throw new Error(I.t("err_waitlist"));
    }
    const map = { mentor_not_configured: I.t("err_config"), daily_cap: I.t("err_cap"), unauthorized: I.t("err_auth") };
    throw new Error(map[json.error] || I.t("err_generic"));
  }
  return json;
}

async function send(text, opts = {}) {
  if (state.busy) return;
  text = (text ?? $("chat-input").value).trim();
  if (!text) return;
  state.busy = true;
  $("btn-send").disabled = true;
  if (!opts.silent) { render("user", text); $("chat-input").value = ""; }
  state.msgs.push({ role: "user", content: text });
  sb.from("mentor_messages").insert({ session_id: state.session, user_id: state.user.id, role: "user", content: text }).then(() => {});

  const thinking = render("mentor", "……", "thinking");
  try {
    const { reply } = await callFunction({ mode: "chat", kind: state.kind, messages: state.msgs });
    thinking.remove();
    render("mentor", reply);
    state.msgs.push({ role: "assistant", content: reply });
    sb.from("mentor_messages").insert({ session_id: state.session, user_id: state.user.id, role: "assistant", content: reply }).then(() => {});
  } catch (e) {
    thinking.remove();
    state.msgs.pop(); // let the user retry the same message
    toast(e.message, 5000);
  } finally {
    state.busy = false;
    $("btn-send").disabled = false;
  }
}
$("btn-send").onclick = () => send();
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
});

// ---------- energy check-in + end & distill ----------
function askEnergy() {
  return new Promise((resolve) => {
    const row = $("energy-row");
    row.innerHTML = "";
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement("button");
      b.className = "energy-btn";
      b.textContent = i;
      b.onclick = () => { $("energy-modal").classList.add("hidden"); resolve(i); };
      row.appendChild(b);
    }
    $("energy-skip").onclick = () => { $("energy-modal").classList.add("hidden"); resolve(null); };
    $("energy-modal").classList.remove("hidden");
  });
}

$("btn-end").onclick = async () => {
  if (state.msgs.filter((m) => m.role === "assistant").length < 1) { route(); return; }
  if (state.busy) return;
  const energy = state.kind === "interview" ? null : await askEnergy();
  state.busy = true;
  $("btn-end").disabled = true;
  const thinking = render("mentor", I.t("engraving"), "thinking");
  try {
    const { log, arc } = await callFunction({ mode: "distill", kind: state.kind, messages: state.msgs });
    await sb.from("mentor_arcs").upsert({ user_id: state.user.id, doc: arc, updated_at: new Date().toISOString() });
    await sb.from("mentor_sessions").update({ log, energy, ended_at: new Date().toISOString() }).eq("id", state.session);
    state.arc = arc;
    toast(I.t("engraved"));
    route();
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    thinking.remove();
    state.busy = false;
    $("btn-end").disabled = false;
  }
};

// ---------- voice input (speak-first, like 觅梦) ----------
(function voice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("btn-voice");
  if (!SR) { btn.classList.add("hidden"); return; }
  let rec = null, base = "";
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = I.lang === "zh" ? "zh-CN" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    base = $("chat-input").value;
    rec.onresult = (e) => {
      let text = "";
      for (const r of e.results) text += r[0].transcript;
      $("chat-input").value = (base ? base + " " : "") + text;
    };
    rec.onend = () => { rec = null; btn.classList.remove("listening"); };
    rec.onerror = () => { rec = null; btn.classList.remove("listening"); };
    btn.classList.add("listening");
    rec.start();
  };
})();
