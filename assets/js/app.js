/* 领路人 Mentor — app logic
   Flow: auth → arc check → (interview | import) → study → calibration chat → distill → arc updated.
   All persistence via the user's own supabase client (RLS owner-only);
   the Edge Function only reads the arc + calls the model. */

const C = window.MENTOR_CONFIG;
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

const OPENERS = {
  interview: "你好，我准备好了，开始入职访谈吧。",
  calibration: "开始本周校准。",
  urgent: "我现在需要一次加急对话。",
};
const TITLES = { interview: "入职访谈", calibration: "每周校准", urgent: "加急会话" };

// ---------- init ----------
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
  if (error) { console.error(error); }
  state.arc = data?.doc ?? null;
}
function route() {
  if (!state.user) { show("view-guard"); return; }
  show(state.arc ? "view-home" : "view-onboard");
}

// ---------- nav ----------
$("nav-signout").onclick = async () => { await sb.auth.signOut(); location.href = "index.html"; };
$("nav-home").onclick = () => route();
$("nav-arc").onclick = () => { $("arc-content").textContent = state.arc || ""; show("view-arc"); };
$("btn-view-arc").onclick = () => { $("arc-content").textContent = state.arc || ""; show("view-arc"); };

// ---------- onboarding ----------
$("btn-interview").onclick = () => startSession("interview");
$("btn-import").onclick = () => $("import-box").classList.toggle("hidden");
$("btn-import-save").onclick = async () => {
  const doc = $("import-text").value.trim();
  if (doc.length < 100) { toast("文档太短——请粘贴完整的弧线文档"); return; }
  const { error } = await sb.from("mentor_arcs").upsert({ user_id: state.user.id, doc, updated_at: new Date().toISOString() });
  if (error) { toast("保存失败：" + error.message); return; }
  state.arc = doc;
  toast("弧线文档已导入");
  route();
};

// ---------- sessions ----------
$("btn-weekly").onclick = () => startSession("calibration");
$("btn-urgent").onclick = () => startSession("urgent");

async function startSession(kind) {
  const { data, error } = await sb.from("mentor_sessions")
    .insert({ user_id: state.user.id, kind }).select("id").single();
  if (error) { toast("无法开始会话：" + error.message); return; }
  state.session = data.id;
  state.kind = kind;
  state.msgs = [];
  $("chat-log").innerHTML = "";
  $("chat-title").textContent = TITLES[kind];
  show("view-chat");
  await send(OPENERS[kind], { silent: true });
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
    const map = {
      mentor_not_configured: "服务尚未配置——请稍后再来",
      daily_cap: "今天聊得够多了——领路人的价值在于低频高重。明天见。",
      unauthorized: "登录已过期，请重新登录",
    };
    throw new Error(map[json.error] || "服务暂时不可用，请稍后重试");
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

// ---------- end & distill ----------
$("btn-end").onclick = async () => {
  if (state.msgs.filter((m) => m.role === "assistant").length < 1) { route(); return; }
  if (state.busy) return;
  state.busy = true;
  $("btn-end").disabled = true;
  const thinking = render("mentor", "正在镌刻本次会话到你的弧线文档……", "thinking");
  try {
    const { log, arc } = await callFunction({ mode: "distill", kind: state.kind, messages: state.msgs });
    await sb.from("mentor_arcs").upsert({ user_id: state.user.id, doc: arc, updated_at: new Date().toISOString() });
    await sb.from("mentor_sessions").update({ log, ended_at: new Date().toISOString() }).eq("id", state.session);
    state.arc = arc;
    toast("已镌刻——弧线文档已更新");
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
    rec.lang = /^zh/.test(navigator.language) ? "zh-CN" : navigator.language || "zh-CN";
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
