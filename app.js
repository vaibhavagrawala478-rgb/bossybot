"use strict";

/* =========================================================
   BossyBot - 1 boss + 100 agent slots, all in the browser.
   State lives in localStorage. Chats use whichever model
   providers the visitor connects (their own keys / local
   models). With nothing connected, bots answer in demo mode.
   ========================================================= */

const SLOT_COUNT = 100;
const STORE_KEY = "bossybot.v2";
const OLD_STORE_KEY = "bossybot.v1";
const MAX_HISTORY = 30;

/* ---------- providers ---------- */
// kind "anthropic" = Messages API, "openai" = OpenAI-compatible /chat/completions.
const PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)", kind: "anthropic", base: "https://api.anthropic.com/v1", keyUrl: "https://console.anthropic.com/settings/keys", ph: "sk-ant-...", def: "claude-sonnet-5-5", models: ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  { id: "openai", name: "OpenAI (GPT)", kind: "openai", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", ph: "sk-...", def: "gpt-4o-mini", models: ["gpt-4o", "gpt-4o-mini", "o4-mini"] },
  { id: "google", name: "Google (Gemini)", kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", ph: "AIza...", def: "gemini-2.5-flash", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { id: "xai", name: "xAI (Grok)", kind: "openai", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", ph: "xai-...", def: "grok-4", models: ["grok-4", "grok-3-mini"] },
  { id: "mistral", name: "Mistral", kind: "openai", base: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", ph: "API key", def: "mistral-small-latest", models: ["mistral-large-latest", "mistral-small-latest"] },
  { id: "deepseek", name: "DeepSeek", kind: "openai", base: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", ph: "sk-...", def: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "groq", name: "Groq", kind: "openai", base: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", ph: "gsk_...", def: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile"] },
  { id: "together", name: "Together AI", kind: "openai", base: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys", ph: "API key", def: "meta-llama/Llama-3.3-70B-Instruct-Turbo", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  { id: "openrouter", name: "OpenRouter (hundreds of models)", kind: "openai", base: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", ph: "sk-or-...", def: "openrouter/auto", models: ["openrouter/auto"], oauth: true, blurb: "One sign-in, hundreds of models" },
  { id: "ollama", name: "Ollama (on your computer)", kind: "openai", base: "http://localhost:11434/v1", noKey: true, editBase: true, models: [], blurb: "Free, local. Start Ollama with OLLAMA_ORIGINS set to this site." },
  { id: "lmstudio", name: "LM Studio (on your computer)", kind: "openai", base: "http://localhost:1234/v1", noKey: true, editBase: true, models: [], blurb: "Free, local. Turn on CORS in the LM Studio server settings." },
  { id: "custom", name: "Custom (OpenAI-compatible)", kind: "openai", base: "", editBase: true, optionalKey: true, ph: "API key (if needed)", models: [], blurb: "Any server that speaks the OpenAI chat API" },
];
const providerById = (id) => PROVIDERS.find((p) => p.id === id);
const NON_CHAT = /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|rerank|guard|speech/i;

/* ---------- roles ---------- */
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
  role: "boss",
  emoji: "\u{1F451}",
  color: "#ffb340",
  prompt: "You are Bossy, the confident, slightly cheeky boss of a team of up to 100 AI agents. You are decisive and useful. When a request fits one of your team members, say who to talk to by name and slot number. Keep answers tight.",
};

const SUMMON_PREFIX = ["Zap", "Nova", "Pixel", "Turbo", "Echo", "Blaze", "Orbit", "Glitch", "Flux", "Volt"];
const SUMMON_SUFFIX = ["bot", "ron", "ix", "o", "zilla", "tron", "ling", "byte", "mind", "bit"];

/* ---------- state ---------- */
const state = {
  slots: Array(SLOT_COUNT).fill(null),
  chats: {}, // "boss" | slot index -> [{role, content, error?}]
  bossModel: "", // "" = auto, else "providerId|modelId"
  connections: {}, // providerId -> { key, base, models: [ids], def }
};
let openKey = null; // "boss" | index | null
let editIndex = null;
let expandedProvider = null;
const busy = new Set();

function load() {
  try {
    let raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    let migrated = false;
    if (!raw) {
      raw = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || "null");
      migrated = !!raw;
    }
    if (!raw) return;
    if (Array.isArray(raw.slots)) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const s = raw.slots[i];
        if (s && typeof s.name === "string") state.slots[i] = sanitizeBot(s);
      }
    }
    if (raw.chats && typeof raw.chats === "object") state.chats = raw.chats;
    if (typeof raw.bossModel === "string") state.bossModel = raw.bossModel;
    if (raw.connections && typeof raw.connections === "object") {
      for (const [id, c] of Object.entries(raw.connections)) {
        if (providerById(id) && c && Array.isArray(c.models)) {
          state.connections[id] = { key: String(c.key || ""), base: String(c.base || ""), models: c.models.map(String), def: String(c.def || c.models[0] || "") };
        }
      }
    }
    // v1 stored a single Anthropic key.
    if (migrated && raw.settings && raw.settings.apiKey) {
      const p = providerById("anthropic");
      state.connections.anthropic = { key: String(raw.settings.apiKey), base: p.base, models: p.models.slice(), def: String(raw.settings.model || p.def) };
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
    model: typeof b.model === "string" ? b.model.slice(0, 200) : "",
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
  toast.t = setTimeout(() => t.classList.remove("show"), 2800);
}
const botFor = (key) => (key === "boss" ? { ...BOSS, model: state.bossModel } : state.slots[key]);
const hired = () => state.slots.filter(Boolean).length;
const connectedProviders = () => PROVIDERS.filter((p) => state.connections[p.id]);

/* ---------- model selection ---------- */
function fillModelSelect(sel, current) {
  sel.textContent = "";
  sel.appendChild(new Option("Auto (first connected model)", ""));
  for (const p of PROVIDERS) {
    const conn = state.connections[p.id];
    const ids = conn ? conn.models : p.models;
    if (!ids.length) continue;
    const g = document.createElement("optgroup");
    g.label = conn ? p.name : `${p.name} - connect to unlock`;
    for (const id of ids) {
      const o = new Option(id, `${p.id}|${id}`);
      o.disabled = !conn;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.value = current || "";
  if (sel.value !== (current || "")) sel.value = "";
}
// Returns null (demo mode), { error }, or { p, conn, model }.
function resolveModel(key) {
  const pref = botFor(key).model;
  if (pref) {
    const [pid, ...rest] = pref.split("|");
    const model = rest.join("|");
    const p = providerById(pid);
    const conn = state.connections[pid];
    if (!p || !conn) return { error: `${p ? p.name : "That provider"} isn't connected, so ${model} is locked. Connect it under "Connect models", or pick another model for this bot.` };
    return { p, conn, model };
  }
  const first = connectedProviders()[0];
  return first ? { p: first, conn: state.connections[first.id], model: state.connections[first.id].def } : null;
}
function describeModel(key) {
  const r = resolveModel(key);
  if (!r) return "Demo mode";
  if (r.error) return "Locked model";
  return r.model;
}
function refreshModelUi() {
  const n = connectedProviders().length;
  const badge = $("nav-badge");
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $("model-status").textContent = n ? `${n} provider${n > 1 ? "s" : ""} connected` : "No models connected - demo mode";
  $("model-status").classList.toggle("on", n > 0);
  $("demo-banner").hidden = n > 0;
  if (openKey !== null) fillModelSelect($("chat-model"), botFor(openKey).model);
}

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
  fillModelSelect($("f-model"), bot ? bot.model : "");
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
    model: $("f-model").value,
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
  refreshModelUi();
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
  fillModelSelect($("chat-model"), bot.model);
}

// Minimal, safe formatting: build DOM nodes only, never innerHTML.
function renderRich(container, text) {
  text.split(/```/).forEach((part, idx) => {
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
    const target = resolveModel(key);
    if (!target) list.push({ role: "assistant", content: await demoReply(key, text) });
    else if (target.error) list.push({ role: "assistant", content: target.error, error: true });
    else list.push({ role: "assistant", content: await askModel(key, list, target) });
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
  if (/^(401|403)\b/.test(msg)) return `The provider rejected your key or your account can't use this model (${msg}). Check "Connect models".`;
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Couldn't reach the provider. Check your connection, and for local models make sure the server is running and allows this site (CORS).";
  return msg;
}
async function httpError(res) {
  let detail = "";
  try {
    const j = await res.json();
    detail = (j.error && (j.error.message || (typeof j.error === "string" ? j.error : ""))) || j.message || "";
  } catch { /* ignore */ }
  return `${res.status} ${detail}`.trim();
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

const baseOf = (p, conn) => (conn.base || p.base).replace(/\/+$/, "");
const anthropicHeaders = (key) => ({
  "content-type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

async function askModel(key, list, { p, conn, model }) {
  const history = list.filter((m) => !m.error).slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
  const system = systemPromptFor(key);
  let res;
  if (p.kind === "anthropic") {
    res = await fetch(`${baseOf(p, conn)}/messages`, {
      method: "POST",
      headers: anthropicHeaders(conn.key),
      body: JSON.stringify({ model, max_tokens: 1024, system, messages: history, stream: true }),
    });
  } else {
    const headers = { "content-type": "application/json" };
    if (conn.key) headers.authorization = `Bearer ${conn.key}`;
    res = await fetch(`${baseOf(p, conn)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...history], stream: true }),
    });
  }
  if (!res.ok) throw new Error(await httpError(res));

  let acc = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const evt = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of evt.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let data;
        try { data = JSON.parse(payload); } catch { continue; }
        let piece = "";
        if (p.kind === "anthropic") {
          if (data.type === "content_block_delta" && data.delta && data.delta.type === "text_delta") piece = data.delta.text;
          else if (data.type === "error") throw new Error((data.error && data.error.message) || "Stream error");
        } else {
          if (data.error) throw new Error(data.error.message || "Stream error");
          piece = (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) || "";
        }
        if (piece) {
          acc += piece;
          if (openKey === key) updateLive(acc);
        }
      }
    }
  }
  if (!acc) throw new Error("The model returned an empty reply.");
  return acc;
}
function updateLive(text) {
  const node = $("typing");
  if (!node) return;
  node.textContent = "";
  renderRich(node, text);
  const box = $("msgs");
  box.scrollTop = box.scrollHeight;
}

/* ---------- demo mode (nothing connected) ---------- */
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
  custom: ["Got it. I'm in demo mode, so my replies are canned. Connect a model and I'll really think.", "Interesting. Tell me more."],
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
    const role = ROLES[i % 10];
    const name = SUMMON_PREFIX[i % 10] + SUMMON_SUFFIX[Math.floor(i / 10)];
    state.slots[i] = sanitizeBot({ name, role: role.id, emoji: role.emoji, color: role.color, prompt: role.prompt });
  }
  save();
  for (let i = 0; i < SLOT_COUNT; i++) setTimeout(() => paintSlot(i, true), i * 12);
  $("count").textContent = String(hired());
  toast(`Summoned ${empties} agents`);
}
function resetAll() {
  if (!confirm("Remove all bots and clear every chat? Your connected models are kept.")) return;
  closeChat();
  state.slots.fill(null);
  state.chats = {};
  save();
  paintAll();
  toast("Team cleared");
}

/* ---------- connecting models ---------- */
async function fetchModels(p, key, base) {
  const url = `${base.replace(/\/+$/, "")}/models${p.kind === "anthropic" ? "?limit=1000" : ""}`;
  const headers = p.kind === "anthropic" ? anthropicHeaders(key) : key ? { authorization: `Bearer ${key}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await httpError(res));
  const j = await res.json();
  const arr = Array.isArray(j) ? j : j.data || j.models || [];
  let ids = arr.map((m) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean).map((id) => String(id).replace(/^models\//, ""));
  if (p.kind !== "anthropic") ids = ids.filter((id) => !NON_CHAT.test(id));
  ids = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  if (!ids.length) throw new Error("Connected, but no chat models were returned for this account.");
  return ids;
}
async function connectProvider(p, key, base) {
  const useBase = (base || p.base).trim();
  if (p.editBase && !/^https?:\/\/.+/i.test(useBase)) throw new Error("Enter a server address starting with http:// or https://");
  if (!p.noKey && !p.optionalKey && !key) throw new Error("Paste your API key first.");
  const models = await fetchModels(p, key, useBase);
  const def = models.includes(p.def) ? p.def : models[0];
  state.connections[p.id] = { key, base: p.editBase ? useBase : "", models, def };
  save();
  refreshModelUi();
  return models.length;
}
function disconnectProvider(p) {
  delete state.connections[p.id];
  // Bots pinned to a model of this provider keep their choice but become locked.
  save();
  refreshModelUi();
}

// OpenRouter "sign in" (OAuth PKCE): returns an API key tied to the visitor's account.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function startOpenRouterLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  try { sessionStorage.setItem("bossybot.or", verifier); } catch { throw new Error("Your browser blocked temporary storage, which sign-in needs."); }
  const cb = location.origin + location.pathname;
  location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${challenge}&code_challenge_method=S256`;
}
async function finishOpenRouterLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  let verifier = null;
  try { verifier = sessionStorage.getItem("bossybot.or"); } catch { /* ignore */ }
  if (!code || !verifier) return;
  history.replaceState(null, "", location.pathname + location.hash);
  try { sessionStorage.removeItem("bossybot.or"); } catch { /* ignore */ }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    });
    if (!res.ok) throw new Error(await httpError(res));
    const { key } = await res.json();
    const n = await connectProvider(providerById("openrouter"), key, "");
    toast(`OpenRouter connected: ${n} models unlocked`);
  } catch (err) {
    toast(`OpenRouter sign-in failed: ${errorText(err)}`);
  }
}

function renderProviders() {
  const list = $("prov-list");
  list.textContent = "";
  for (const p of PROVIDERS) {
    const conn = state.connections[p.id];
    const row = el("div", `prov${conn ? " on" : ""}`);
    const top = el("div", "prov-top");
    const title = el("div", "prov-title");
    title.append(el("strong", "", p.name), el("small", "", conn ? `${conn.models.length} models unlocked` : p.blurb || "Not connected"));
    const btn = el("button", "btn small" + (conn ? "" : " primary"), conn ? "Manage" : "Connect");
    btn.type = "button";
    btn.setAttribute("aria-expanded", String(expandedProvider === p.id));
    btn.addEventListener("click", () => { expandedProvider = expandedProvider === p.id ? null : p.id; renderProviders(); });
    top.append(title, btn);
    row.appendChild(top);

    if (expandedProvider === p.id) {
      const form = el("form", "prov-form");
      form.autocomplete = "off";
      const baseIn = document.createElement("input");
      const keyIn = document.createElement("input");
      if (p.editBase) {
        const l = el("label", "field");
        l.append(el("span", "", "Server address"));
        baseIn.value = (conn && conn.base) || p.base;
        baseIn.placeholder = "https://your-server/v1";
        baseIn.spellcheck = false;
        l.appendChild(baseIn);
        form.appendChild(l);
      }
      if (!p.noKey) {
        const l = el("label", "field");
        l.append(el("span", "", p.optionalKey ? "API key (optional)" : "API key"));
        keyIn.type = "password";
        keyIn.placeholder = p.ph || "";
        keyIn.spellcheck = false;
        keyIn.value = conn ? conn.key : "";
        l.appendChild(keyIn);
        form.appendChild(l);
      }
      const err = el("p", "prov-err");
      err.hidden = true;
      const actions = el("div", "prov-actions");
      if (p.oauth) {
        const o = el("button", "btn small primary", "Sign in with OpenRouter");
        o.type = "button";
        o.addEventListener("click", () => startOpenRouterLogin().catch((e) => { err.textContent = e.message; err.hidden = false; }));
        actions.appendChild(o);
      }
      const go = el("button", "btn small" + (p.oauth ? " ghost" : " primary"), conn ? "Save & refresh models" : p.oauth ? "Use a key instead" : "Connect");
      go.type = "submit";
      actions.appendChild(go);
      if (conn) {
        const d = el("button", "btn small ghost", "Disconnect");
        d.type = "button";
        d.addEventListener("click", () => { disconnectProvider(p); renderProviders(); toast(`${p.name} disconnected`); });
        actions.appendChild(d);
      }
      if (p.keyUrl) {
        const a = el("a", "get-key", "Get a key");
        a.href = p.keyUrl;
        a.target = "_blank";
        a.rel = "noopener";
        actions.appendChild(a);
      }
      form.append(err, actions);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        go.disabled = true;
        go.textContent = "Checking...";
        err.hidden = true;
        try {
          const n = await connectProvider(p, keyIn.value.trim(), baseIn.value);
          toast(`${p.name} connected: ${n} models unlocked`);
          expandedProvider = null;
          renderProviders();
        } catch (ex) {
          err.textContent = errorText(ex);
          err.hidden = false;
          go.disabled = false;
          go.textContent = conn ? "Save & refresh models" : "Connect";
        }
      });
      row.appendChild(form);
    }
    list.appendChild(row);
  }
}
function openSettings() {
  renderProviders();
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
  refreshModelUi();

  $("boss").addEventListener("click", () => openChat("boss"));
  $("summon").addEventListener("click", summonAll);
  $("reset").addEventListener("click", resetAll);

  $("bot-form").addEventListener("submit", submitBotForm);
  $("bot-cancel").addEventListener("click", () => $("bot-dialog").close());

  $("open-settings").addEventListener("click", openSettings);
  $("model-status").addEventListener("click", openSettings);
  $("banner-settings").addEventListener("click", openSettings);
  $("s-close").addEventListener("click", () => $("settings-dialog").close());

  $("chat-model").addEventListener("change", (e) => {
    if (openKey === "boss") state.bossModel = e.target.value;
    else if (typeof openKey === "number" && state.slots[openKey]) state.slots[openKey].model = e.target.value;
    save();
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
  finishOpenRouterLogin();
}
init();
