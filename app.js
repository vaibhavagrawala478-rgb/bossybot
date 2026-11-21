"use strict";

/* =========================================================
   BossyBot - 1 boss + 100 agent slots, all in the browser.
   State lives in localStorage. Chats use the Anthropic API
   (bring your own key) or fall back to a local demo mode.
   ========================================================= */

const SLOT_COUNT = 100;
const STORE_KEY = "bossybot.v1";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_HISTORY = 30;

const ROLES = [
  { id: "coder", label: "Coder", emoji: "\u{1F4BB}", color: "#35e0ff", prompt: "You are a sharp, pragmatic senior software engineer. Give working code, explain tradeoffs briefly, and ask a question only when the task is truly ambiguous." },
  { id: "writer", label: "Writer", emoji: "✍️", color: "#ff7ac6", prompt: "You are a gifted writer and editor. Produce vivid, clear prose and offer tighter alternatives when asked." },
  { id: "researcher", label: "Researcher", emoji: "\u{1F50E}", color: "#7c5cff", prompt: "You are a careful researcher. Break questions down, separate what is known from what is uncertain, and be explicit about confidence." },
  { id: "designer", label: "Designer", emoji: "\u{1F3A8}", color: "#ffb340", prompt: "You are a product designer with strong taste. Give concrete visual and UX suggestions, with reasons." },
  { id: "analyst", label: "Analyst", emoji: "\u{1F4CA}", color: "#3ddc97", prompt: "You are a data analyst. Think in numbers, state assumptions, and show your calculations." },
  { id: "coach", label: "Coach", emoji: "\u{1F4AA}", color: "#ff4d6d", prompt: "You are an encouraging but honest coach. Help the user set goals and take the next small step." },
  { id: "chef", label: "Chef", emoji: "\u{1F373}", color: "#ff9f43", prompt: "You are a friendly professional chef. Suggest practical recipes, substitutions and technique tips." },
  { id: "comedian", label: "Comedian", emoji: "\u{1F3AD}", color: "#f9e65c", prompt: "You are a quick-witted comedian. Be funny and warm, never mean, and still answer the question." },
  { id: "teacher", label: "Teacher", emoji: "\u{1F393}", color: "#5eead4", prompt: "You are a patient teacher. Explain simply with examples, then check understanding." },
  { id: "strategist", label: "Strategist", emoji: "♟️", color: "#a78bfa", prompt: "You are a sharp business strategist. Weigh options, name the key risk, and recommend one path." },
  { id: "custom", label: "Custom", emoji: "\u{1F916}", color: "#9aa4ff", prompt: "" },
];
const roleById = (id) => ROLES.find((r) => r.id === id) || ROLES[ROLES.length - 1];

const COLORS = ["#ff4d6d", "#ff9f43", "#ffb340", "#f9e65c", "#3ddc97", "#5eead4", "#35e0ff", "#7c5cff", "#a78bfa", "#ff7ac6"];

const BOSS = {
  name: "Bossy",
  role: "Boss",
  emoji: "\u{1F451}",
  color: "#ffb340",
  prompt: "You are Bossy, the confident, slightly cheeky boss of a team of up to 100 AI agents. You are decisive and useful. When a request fits one of your team members, say who to talk to by name and slot number. Keep answers tight.",
};

const SUMMON_PREFIX = ["Zap", "Nova", "Pixel", "Turbo", "Echo", "Blaze", "Orbit", "Glitch", "Flux", "Volt"];
const SUMMON_SUFFIX = ["bot", "ron", "ix", "o", "zilla", "tron", "ling", "byte", "mind", "bit"];

/* ---------- state ---------- */
const state = {
  slots: Array(SLOT_COUNT).fill(null),
  chats: {}, // key: "boss" | slot index -> [{role, content, error?}]
  settings: { apiKey: "", model: DEFAULT_MODEL },
};
let openKey = null; // "boss" | index | null
let editIndex = null; // slot being created/edited
const busy = new Set(); // keys with a reply in flight

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!raw) return;
    if (Array.isArray(raw.slots)) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const s = raw.slots[i];
        if (s && typeof s.name === "string") state.slots[i] = sanitizeBot(s);
      }
    }
    if (raw.chats && typeof raw.chats === "object") state.chats = raw.chats;
    if (raw.settings) {
      state.settings.apiKey = String(raw.settings.apiKey || "");
      state.settings.model = String(raw.settings.model || DEFAULT_MODEL);
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
function sanitizeBot(b) {
  return {
    name: String(b.name || "Bot").slice(0, 24),
    role: roleById(b.role).id,
    emoji: String(b.emoji || "\u{1F916}").slice(0, 4),
    color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#9aa4ff",
    prompt: String(b.prompt || "").slice(0, 1200),
  };
}

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2400);
}
const botFor = (key) => (key === "boss" ? { ...BOSS, role: "boss" } : state.slots[key]);
const hired = () => state.slots.filter(Boolean).length;

/* ---------- grid ---------- */
function buildGrid() {
  const grid = $("grid");
  grid.textContent = "";
  for (let i = 0; i < SLOT_COUNT; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "slot";
    b.dataset.i = String(i);
    b.setAttribute("role", "listitem");
    grid.appendChild(b);
  }
  grid.addEventListener("click", (e) => {
    const slot = e.target.closest(".slot");
    if (!slot) return;
    const i = Number(slot.dataset.i);
    if (state.slots[i]) openChat(i);
    else openBotDialog(i);
  });
  grid.addEventListener("pointermove", (e) => {
    const r = grid.getBoundingClientRect();
    grid.style.setProperty("--mx", `${e.clientX - r.left}px`);
    grid.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}

function paintSlot(i, pop) {
  const node = $("grid").children[i];
  const bot = state.slots[i];
  node.textContent = "";
  node.classList.toggle("on", !!bot);
  node.classList.remove("pop");
  if (bot) {
    node.style.setProperty("--c", bot.color);
    node.setAttribute("aria-label", `Chat with ${bot.name}, ${roleById(bot.role).label}, slot ${i + 1}`);
    node.append(el("span", "n", String(i + 1)), el("span", "emo", bot.emoji), el("span", "nm", bot.name), el("span", "dot"));
    if (pop) { void node.offsetWidth; node.classList.add("pop"); }
  } else {
    node.style.removeProperty("--c");
    node.setAttribute("aria-label", `Empty slot ${i + 1}. Hire a bot.`);
    node.append(el("span", "n", String(i + 1)), el("span", "plus", "+"));
  }
}
function paintAll() {
  for (let i = 0; i < SLOT_COUNT; i++) paintSlot(i, false);
  $("count").textContent = String(hired());
}

/* ---------- add / edit dialog ---------- */
let formRole = "coder";
let formColor = COLORS[0];
let lastPresetPrompt = "";

function buildFormControls() {
  const roles = $("f-roles");
  ROLES.forEach((r) => {
    const b = el("button", "chip", `${r.emoji} ${r.label}`);
    b.type = "button";
    b.dataset.role = r.id;
    roles.appendChild(b);
  });
  roles.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) pickRole(b.dataset.role, true);
  });
  const colors = $("f-colors");
  COLORS.forEach((c) => {
    const b = el("button", "sw");
    b.type = "button";
    b.style.setProperty("--c", c);
    b.dataset.color = c;
    b.setAttribute("aria-label", `Color ${c}`);
    colors.appendChild(b);
  });
  colors.addEventListener("click", (e) => {
    const b = e.target.closest(".sw");
    if (b) pickColor(b.dataset.color);
  });
}
function pickRole(id, applyDefaults) {
  formRole = id;
  const r = roleById(id);
  document.querySelectorAll("#f-roles .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.role === id)));
  if (applyDefaults) {
    $("f-emoji").value = r.emoji;
    pickColor(r.color);
    const p = $("f-prompt");
    if (!p.value.trim() || p.value === lastPresetPrompt) p.value = r.prompt;
    lastPresetPrompt = r.prompt;
  }
}
function pickColor(c) {
  formColor = c;
  document.querySelectorAll("#f-colors .sw").forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.color.toLowerCase() === c.toLowerCase())));
}
function openBotDialog(i) {
  editIndex = i;
  const bot = state.slots[i];
  $("bot-title").textContent = bot ? `Edit ${bot.name}` : "Hire a bot";
  $("bot-save").textContent = bot ? "Save" : "Hire bot";
  $("bot-slot").textContent = `Slot ${i + 1} of ${SLOT_COUNT}`;
  lastPresetPrompt = "";
  if (bot) {
    $("f-name").value = bot.name;
    $("f-prompt").value = bot.prompt;
    pickRole(bot.role, false);
    $("f-emoji").value = bot.emoji;
    pickColor(bot.color);
  } else {
    $("f-name").value = "";
    $("f-prompt").value = "";
    pickRole("coder", true);
  }
  $("bot-dialog").showModal();
  $("f-name").focus();
}
function submitBotForm(e) {
  e.preventDefault();
  const name = $("f-name").value.trim();
  if (!name || editIndex === null) return;
  const isNew = !state.slots[editIndex];
  state.slots[editIndex] = sanitizeBot({
    name,
    role: formRole,
    emoji: $("f-emoji").value.trim() || roleById(formRole).emoji,
    color: formColor,
    prompt: $("f-prompt").value.trim() || roleById(formRole).prompt,
  });
  save();
  paintSlot(editIndex, isNew);
  $("count").textContent = String(hired());
  const wasChatOpen = openKey === editIndex;
  $("bot-dialog").close();
  if (wasChatOpen) renderChatHeader();
  else if (isNew) openChat(editIndex);
  toast(isNew ? `${name} is on the team` : `${name} updated`);
}

/* ---------- chat ---------- */
function openChat(key) {
  openKey = key;
  renderChatHeader();
  renderMessages();
  $("demo-banner").hidden = !!state.settings.apiKey;
  $("scrim").hidden = false;
  const chat = $("chat");
  chat.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => chat.classList.add("open"));
  setTimeout(() => $("c-input").focus(), 250);
}
function closeChat() {
  openKey = null;
  $("chat").classList.remove("open");
  $("chat").setAttribute("aria-hidden", "true");
  $("scrim").hidden = true;
}
function renderChatHeader() {
  const bot = botFor(openKey);
  if (!bot) return;
  const av = $("chat-avatar");
  av.textContent = bot.emoji;
  av.style.setProperty("--c", bot.color);
  $("chat-name").textContent = bot.name;
  $("chat-role").textContent = openKey === "boss" ? "The boss" : `${roleById(bot.role).label} · slot ${openKey + 1}`;
  const boss = openKey === "boss";
  $("chat-edit").hidden = boss;
  $("chat-remove").hidden = boss;
  $("c-input").placeholder = `Message ${bot.name}...`;
}

// Minimal, safe formatting: build DOM nodes only, never innerHTML.
function renderRich(container, text) {
  const parts = text.split(/```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      const pre = el("pre");
      pre.textContent = part.replace(/^[\w-]*\n/, "").replace(/\n$/, "");
      container.appendChild(pre);
      return;
    }
    part.split(/(`[^`\n]+`)/).forEach((seg) => {
      if (/^`[^`\n]+`$/.test(seg)) container.appendChild(el("code", "", seg.slice(1, -1)));
      else if (seg) container.appendChild(document.createTextNode(seg));
    });
  });
}
function messageNode(m) {
  const n = el("div", `msg ${m.role === "user" ? "user" : "bot"}${m.error ? " err" : ""}`);
  if (m.role === "user" || m.error) n.textContent = m.content;
  else renderRich(n, m.content);
  return n;
}
function renderMessages() {
  const box = $("msgs");
  box.textContent = "";
  const list = state.chats[openKey] || [];
  const bot = botFor(openKey);
  if (!list.length && !busy.has(openKey)) {
    const empty = el("div", "empty-chat");
    empty.append(el("div", "big", bot.emoji), el("p", "", openKey === "boss" ? "Ask Bossy anything, or who on your team should handle it." : `Say hi to ${bot.name}.`));
    box.appendChild(empty);
  }
  list.forEach((m) => box.appendChild(messageNode(m)));
  if (busy.has(openKey)) box.appendChild(typingNode());
  box.scrollTop = box.scrollHeight;
}
function typingNode() {
  const n = el("div", "msg bot");
  const t = el("span", "typing");
  t.append(el("i"), el("i"), el("i"));
  n.appendChild(t);
  n.id = "typing";
  return n;
}

async function sendMessage(text) {
  const key = openKey;
  if (key === null || busy.has(key) || !text.trim()) return;
  const list = (state.chats[key] ||= []);
  list.push({ role: "user", content: text.trim() });
  save();
  busy.add(key);
  renderMessages();

  try {
    const reply = state.settings.apiKey ? await askClaude(key, list) : await demoReply(key, text);
    list.push({ role: "assistant", content: reply });
  } catch (err) {
    list.push({ role: "assistant", content: errorText(err), error: true });
  } finally {
    busy.delete(key);
    save();
    if (openKey === key) renderMessages();
  }
}
function errorText(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/401|authentication|invalid x-api-key/i.test(msg)) return "Anthropic rejected the API key. Check it in Settings.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Could not reach Anthropic. Check your connection and try again.";
  return msg;
}

function systemPromptFor(key) {
  const bot = botFor(key);
  let p = bot.prompt || roleById(bot.role).prompt;
  p += `\n\nYour name is ${bot.name}. Keep replies concise unless the user asks for depth.`;
  if (key === "boss") {
    const roster = state.slots
      .map((s, i) => (s ? `#${i + 1} ${s.name} (${roleById(s.role).label})` : null))
      .filter(Boolean);
    p += roster.length ? `\n\nYour current team:\n${roster.join("\n")}` : "\n\nYour team is empty. Encourage the user to hire bots by clicking empty squares.";
  }
  return p;
}

async function askClaude(key, list) {
  const history = list.filter((m) => !m.error).slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: state.settings.model || DEFAULT_MODEL,
      max_tokens: 1024,
      system: systemPromptFor(key),
      messages: history,
      stream: true,
    }),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { const j = await res.json(); detail = `${res.status} ${j.error?.message || ""}`.trim(); } catch { /* ignore */ }
    throw new Error(detail);
  }

  // Stream into the typing bubble while the request runs.
  let acc = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const evt = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = evt.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
          acc += data.delta.text;
          if (openKey === key) updateLive(acc);
        } else if (data.type === "error") {
          throw new Error(data.error?.message || "Stream error");
        }
      }
  }
  if (!acc) throw new Error("The model returned an empty reply.");
  return acc;
}
function updateLive(text) {
  const box = $("msgs");
  let node = $("typing");
  if (!node) return;
  node.textContent = "";
  renderRich(node, text);
  box.scrollTop = box.scrollHeight;
}

/* ---------- demo mode (no API key) ---------- */
const DEMO = {
  coder: ["Let's break that into small functions first. Want me to sketch the structure?", "I'd start with the simplest version that works, then add tests. What language are we in?"],
  writer: ["Good seed. Let me draft an opening line and we'll bend it from there.", "Lead with the strongest image, cut the first paragraph, and see if it still stands."],
  researcher: ["Three questions worth answering first: what is known, what is disputed, and what is missing?", "I'd look for primary sources before trusting any summary, including mine."],
  designer: ["Give it more breathing room, one clear focal point, and a tighter palette.", "Try a bolder hierarchy: one big thing, two medium things, everything else quiet."],
  analyst: ["Before I run numbers: what decision does this inform, and what would change your mind?", "Let's define the metric first, then check the baseline."],
  coach: ["Nice. What is one small step you can take in the next ten minutes?", "Progress beats perfect. What would make today a win?"],
  chef: ["Salt early, acid late, and do not crowd the pan. What is in your fridge?", "Give me your ingredients and I'll find you dinner."],
  comedian: ["I'd tell a joke, but my demo mode is on a budget. Picture a really good one here.", "Funny thing about that: it's also true. Go on."],
  teacher: ["Let's start simple, then build up. What part feels fuzzy?", "Try explaining it back to me in your own words and I'll fix the gaps."],
  strategist: ["Name the goal, the constraint, and the biggest risk. Then we pick one path.", "Most options look equal until you price the downside. What is yours?"],
  custom: ["Got it. I'm in demo mode, so my replies are canned. Add an API key in Settings and I'll really think.", "Interesting. Tell me more."],
};
function demoReply(key, text) {
  return new Promise((resolve) => {
    const bot = botFor(key);
    let out;
    if (key === "boss") {
      const team = state.slots.map((s, i) => (s ? { s, i } : null)).filter(Boolean);
      if (!team.length) out = "You have no team yet. Click an empty square below to hire your first bot, or hit Summon all 100.";
      else {
        const pick = team[Math.floor(Math.random() * team.length)];
        out = `Sounds like a job for ${pick.s.name} in slot ${pick.i + 1}. They're our ${roleById(pick.s.role).label.toLowerCase()}. Click their square and tell them I sent you.`;
      }
    } else {
      const pool = DEMO[bot.role] || DEMO.custom;
      const snippet = text.length > 60 ? `${text.slice(0, 57)}...` : text;
      out = `"${snippet}"\n\n${pool[Math.floor(Math.random() * pool.length)]}`;
    }
    setTimeout(() => resolve(out), 600 + Math.random() * 600);
  });
}

/* ---------- summon / reset ---------- */
function summonAll() {
  const empties = state.slots.filter((s) => !s).length;
  if (!empties) return toast("All 100 slots are already filled");
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (state.slots[i]) continue;
    const role = ROLES[i % 10]; // the ten named roles
    const name = SUMMON_PREFIX[i % 10] + SUMMON_SUFFIX[Math.floor(i / 10)];
    state.slots[i] = sanitizeBot({ name, role: role.id, emoji: role.emoji, color: role.color, prompt: role.prompt });
  }
  save();
  // staggered pop-in
  for (let i = 0; i < SLOT_COUNT; i++) setTimeout(() => paintSlot(i, true), i * 12);
  $("count").textContent = String(hired());
  toast(`Summoned ${empties} agents`);
}
function resetAll() {
  if (!confirm("Remove all bots and clear every chat? Your API key is kept.")) return;
  closeChat();
  state.slots.fill(null);
  state.chats = {};
  save();
  paintAll();
  toast("Team cleared");
}

/* ---------- settings ---------- */
function openSettings() {
  $("s-key").value = state.settings.apiKey;
  $("s-model").value = state.settings.model;
  $("settings-dialog").showModal();
}

/* ---------- downloads ---------- */
function detectOS() {
  const ua = navigator.userAgent || "";
  const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  const s = `${plat} ${ua}`;
  if (/android|iphone|ipad|ipod/i.test(s)) return null;
  if (/mac/i.test(s)) return "mac";
  if (/win/i.test(s)) return "win";
  if (/linux|x11/i.test(s)) return "linux";
  return null;
}
async function setupDownloads() {
  const os = detectOS();
  if (os) document.querySelector(`.dl-card[data-os="${os}"]`)?.classList.add("rec");
  try {
    const res = await fetch("https://api.github.com/repos/nightly-labs/openbot/releases/latest", { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const rel = await res.json();
    const find = (re) => rel.assets.find((a) => re.test(a.name))?.browser_download_url;
    const map = {
      "mac-arm64": find(/arm64\.dmg$/),
      "mac-x64": find(/x64\.dmg$/),
      "win-x64": find(/x64\.exe$/),
      "linux-x64": find(/x86_64\.AppImage$/),
      "linux-arm64": find(/arm64\.AppImage$/),
    };
    for (const [k, url] of Object.entries(map)) {
      const a = document.querySelector(`[data-asset="${k}"]`);
      if (a && url) a.href = url;
    }
    $("dl-version").textContent = `Latest: ${rel.tag_name}.`;
  } catch { /* offline or rate limited: buttons fall back to the releases page */ }
}

/* ---------- wiring ---------- */
function init() {
  load();
  buildGrid();
  buildFormControls();
  paintAll();

  $("boss").addEventListener("click", () => openChat("boss"));
  $("summon").addEventListener("click", summonAll);
  $("reset").addEventListener("click", resetAll);

  $("bot-form").addEventListener("submit", submitBotForm);
  $("bot-cancel").addEventListener("click", () => $("bot-dialog").close());

  $("open-settings").addEventListener("click", openSettings);
  $("banner-settings").addEventListener("click", openSettings);
  $("s-cancel").addEventListener("click", () => $("settings-dialog").close());
  $("s-clear").addEventListener("click", () => { $("s-key").value = ""; });
  $("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.settings.apiKey = $("s-key").value.trim();
    state.settings.model = $("s-model").value.trim() || DEFAULT_MODEL;
    save();
    $("demo-banner").hidden = !!state.settings.apiKey;
    $("settings-dialog").close();
    toast(state.settings.apiKey ? "Key saved. Bots will use real AI." : "Key removed. Demo mode on.");
  });

  $("scrim").addEventListener("click", closeChat);
  $("chat-close").addEventListener("click", closeChat);
  $("chat-edit").addEventListener("click", () => { if (typeof openKey === "number") openBotDialog(openKey); });
  $("chat-clear").addEventListener("click", () => {
    if (openKey === null) return;
    state.chats[openKey] = [];
    save();
    renderMessages();
  });
  $("chat-remove").addEventListener("click", () => {
    if (typeof openKey !== "number") return;
    const i = openKey;
    if (!confirm(`Remove ${state.slots[i].name} and their chat?`)) return;
    closeChat();
    state.slots[i] = null;
    delete state.chats[i];
    save();
    paintSlot(i, false);
    $("count").textContent = String(hired());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openKey !== null && !document.querySelector("dialog[open]")) closeChat();
  });

  const input = $("c-input");
  const fit = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };
  input.addEventListener("input", fit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    fit();
    sendMessage(text);
  });

  setupDownloads();
}
init();
