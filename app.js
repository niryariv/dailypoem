/* Minimal client-side Ben Yehuda “wake-up poem” viewer (no backend). */

// NOTE: Per your choice, the API key is intentionally present in frontend code.
// You can replace it, or load it differently if you later add a proxy/backend.
const BEN_YEHUDA_API_KEY = "f456e85106503870c542590768e1b218ed9b5218b178e9157593c6e8dc1f877d";
const APP_VERSION = "v1.1.0";

const API_BASE = "https://benyehuda.org";
const LS_KEY = "shir.state.v1";

// Check for debug mode in URL params
const urlParams = new URLSearchParams(window.location.search);
const DEBUG_MODE = urlParams.get("debug") === "1";

const el = {
  root: document.documentElement,
  app: document.getElementById("app"),
  splash: document.getElementById("splash"),
  title: document.getElementById("title"),
  author: document.getElementById("author"),
  poem: document.getElementById("poem"),
  sourceLink: document.getElementById("sourceLink"),
  version: document.getElementById("appVersion"),
  status: document.getElementById("status"),
  themeBtn: document.getElementById("themeBtn"),
};

/** @typedef {{id:number,title:string,author:string,url:string,snippet?:string,downloadUrl?:string,text?:string}} PoemItem */

let state = {
  theme: "dark", // "light" | "dark"
  // history is a list of IDs we visited, and a pointer to current index.
  historyIds: /** @type {number[]} */ ([]),
  pointer: -1,
  // cache for already-fetched items by ID
  itemsById: /** @type {Record<number, PoemItem>} */ ({}),
  // candidates we can show next (IDs) from the search endpoint
  queueIds: /** @type {number[]} */ ([]),
  // paging cursor for the search endpoint
  searchAfter: /** @type {string[]|null} */ (null),
};

let controlsHideTimer = null;
let splashHidden = false;

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  const parsed = raw ? safeJsonParse(raw) : null;
  if (!parsed || typeof parsed !== "object") return;

  if (parsed.theme === "dark" || parsed.theme === "light") state.theme = parsed.theme;
  if (Array.isArray(parsed.historyIds)) {
    state.historyIds = parsed.historyIds.filter((x) => Number.isInteger(x));
  }
  if (Number.isInteger(parsed.pointer)) state.pointer = parsed.pointer;
  if (parsed.itemsById && typeof parsed.itemsById === "object") state.itemsById = parsed.itemsById;
  if (Array.isArray(parsed.queueIds)) state.queueIds = parsed.queueIds.filter((x) => Number.isInteger(x));
  if (parsed.searchAfter === null || Array.isArray(parsed.searchAfter)) state.searchAfter = parsed.searchAfter;
}

function saveState() {
  // Keep state compact-ish.
  const maxHistory = 60;
  if (state.historyIds.length > maxHistory) {
    const extra = state.historyIds.length - maxHistory;
    state.historyIds = state.historyIds.slice(extra);
    state.pointer = Math.max(-1, state.pointer - extra);
  }

  // Keep a small cache of items (last N).
  const ids = state.historyIds.slice(-60);
  const itemsById = {};
  for (const id of ids) {
    // Do NOT persist full text into localStorage (too large / can exceed quota).
    const item = state.itemsById[id];
    if (!item) continue;
    const { text, ...rest } = item;
    itemsById[id] = rest;
  }

  const payload = {
    theme: state.theme,
    historyIds: state.historyIds,
    pointer: state.pointer,
    itemsById,
    queueIds: state.queueIds.slice(0, 80),
    searchAfter: state.searchAfter,
  };

  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

function setTheme(theme) {
  state.theme = theme;
  el.root.dataset.theme = theme;
  el.themeBtn.textContent = theme === "dark" ? "מצב בהיר" : "מצב כהה";
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", theme === "dark" ? "#0a0a0a" : "#ffffff");
  saveState();
}

function showControls() {
  el.root.dataset.controls = "visible";
  if (controlsHideTimer) window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => {
    el.root.dataset.controls = "hidden";
  }, 2200);
}

function hideControls() {
  el.root.dataset.controls = "hidden";
  if (controlsHideTimer) window.clearTimeout(controlsHideTimer);
  controlsHideTimer = null;
}

function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  el.root.dataset.splash = "hidden";
  if (el.splash) el.splash.setAttribute("aria-hidden", "true");
}

function showStatus(msg) {
  el.status.textContent = msg;
  el.root.dataset.status = "visible";
  window.setTimeout(() => {
    el.root.dataset.status = "hidden";
  }, 1500);
}

function normalizeText(text) {
  if (!text) return "";
  // Text/snippet are plaintext; keep it readable.
  return String(text).replace(/\s+\n/g, "\n").trim();
}

function render(item) {
  el.title.textContent = item.title || "";
  el.author.textContent = item.author || "";
  el.poem.textContent = normalizeText(item.text || item.snippet) || "…";
  // Put focus on content for screen readers (without scrolling).
  el.poem.scrollTop = 0;
}

async function fetchTextFromUrl(downloadUrl) {
  if (DEBUG_MODE) {
    console.log("[Download Request]", { url: downloadUrl });
  }
  const res = await fetch(downloadUrl, { method: "GET" });
  const body = await res.text().catch(() => "");
  if (DEBUG_MODE) {
    console.log("[Download Response]", {
      url: downloadUrl,
      status: res.status,
      statusText: res.statusText,
      length: body.length,
    });
  }
  if (!res.ok) throw new Error(`Download ${res.status}: ${body.slice(0, 200)}`);
  return body;
}

async function ensureFullText(id) {
  const cached = state.itemsById[id];
  if (!cached) return false;
  if (cached.text) return false;

  try {
    const m = await apiGet(
      `/api/v1/texts/${id}?key=${encodeURIComponent(BEN_YEHUDA_API_KEY)}&view=basic&file_format=txt&snippet=false`
    );
    const downloadUrl = m?.download_url || m?.downloadUrl;
    if (downloadUrl) cached.downloadUrl = downloadUrl;
    if (!downloadUrl) return false;

    const fullText = await fetchTextFromUrl(downloadUrl);
    cached.text = normalizeText(fullText);
    // Persist metadata only (saveState strips `text`).
    saveState();
    return true;
  } catch (e) {
    if (DEBUG_MODE) console.warn("[FullText] failed", e);
    return false;
  }
}

async function apiPost(path, body) {
  const url = `${API_BASE}${path}`;
  const options = {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  };
  
  if (DEBUG_MODE) {
    console.log("[API Request]", {
      method: "POST",
      url,
      body: body,
    });
  }
  
  const res = await fetch(url, options);
  const responseText = await res.text().catch(() => "");
  
  if (DEBUG_MODE) {
    console.log("[API Response]", {
      method: "POST",
      url,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: responseText,
    });
  }
  
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${responseText.slice(0, 200)}`);
  }
  
  const json = JSON.parse(responseText);
  if (DEBUG_MODE) {
    console.log("[API Response JSON]", json);
  }
  
  return json;
}

async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  const options = {
    method: "GET",
    headers: { accept: "application/json" },
  };
  
  if (DEBUG_MODE) {
    console.log("[API Request]", {
      method: "GET",
      url,
    });
  }
  
  const res = await fetch(url, options);
  const responseText = await res.text().catch(() => "");
  
  if (DEBUG_MODE) {
    console.log("[API Response]", {
      method: "GET",
      url,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: responseText,
    });
  }
  
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${responseText.slice(0, 200)}`);
  }
  
  const json = JSON.parse(responseText);
  if (DEBUG_MODE) {
    console.log("[API Response JSON]", json);
  }
  
  return json;
}

async function fetchSearchPage() {
  // Search endpoint supports pagination via next_page_search_after.
  const body = {
    key: BEN_YEHUDA_API_KEY,
    view: "basic",
    file_format: "html",
    snippet: true,
    sort_by: "popularity",
    sort_dir: "default",
    genres: ["poetry"],
    intellectual_property_types: ["public_domain"],
  };
  if (state.searchAfter) body.search_after = state.searchAfter;

  const page = await apiPost("/api/v1/search", body);
  const data = Array.isArray(page?.data) ? page.data : [];

  // Collect IDs; also opportunistically cache snippet/title/author/url from the search response.
  for (const m of data) {
    const id = m?.id;
    const meta = m?.metadata || {};
    if (!Number.isInteger(id)) continue;

    state.queueIds.push(id);
    if (!state.itemsById[id]) {
      state.itemsById[id] = {
        id,
        title: meta?.title || "",
        author: meta?.author_string || "",
        url: m?.url || "",
        snippet: m?.snippet || "",
      };
    } else {
      // Fill missing fields if we already had it.
      state.itemsById[id].title ||= meta?.title || "";
      state.itemsById[id].author ||= meta?.author_string || "";
      state.itemsById[id].url ||= m?.url || "";
      state.itemsById[id].snippet ||= m?.snippet || "";
    }
  }

  state.searchAfter = page?.next_page_search_after ?? null;
  // If we reached the end, wrap around.
  if (!state.searchAfter) state.searchAfter = null;
  saveState();
}

async function ensureQueue(min = 10) {
  // Avoid unbounded growth; also shuffle a bit for variety.
  if (state.queueIds.length >= min) return;
  await fetchSearchPage();
  // Small shuffle to avoid deterministic feel while still being stable.
  for (let i = state.queueIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queueIds[i], state.queueIds[j]] = [state.queueIds[j], state.queueIds[i]];
  }
}

async function hydrateItems(ids) {
  const need = ids.filter((id) => {
    const item = state.itemsById[id];
    return !item || (!item.snippet && !item.text);
  });
  if (need.length === 0) return;

  // Batch endpoint: POST /api/v1/texts/batch
  const payload = {
    key: BEN_YEHUDA_API_KEY,
    ids: need.slice(0, 40),
    view: "basic",
    file_format: "html",
    snippet: true,
  };
  const data = await apiPost("/api/v1/texts/batch", payload);
  const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  for (const m of items) {
    const id = m?.id;
    if (!Number.isInteger(id)) continue;
    const meta = m?.metadata || {};
    state.itemsById[id] = {
      id,
      title: meta?.title || "",
      author: meta?.author_string || "",
      url: m?.url || "",
      snippet: m?.snippet || "",
    };
  }
  saveState();
}

function currentId() {
  if (state.pointer < 0 || state.pointer >= state.historyIds.length) return null;
  return state.historyIds[state.pointer];
}

async function showCurrent() {
  const id = currentId();
  if (!id) return;
  if (!state.itemsById[id] || !state.itemsById[id].snippet) {
    // Fallback: try the single item endpoint.
    try {
      const m = await apiGet(
        `/api/v1/texts/${id}?key=${encodeURIComponent(BEN_YEHUDA_API_KEY)}&view=basic&file_format=txt&snippet=true`
      );
      const meta = m?.metadata || {};
      state.itemsById[id] = {
        id,
        title: meta?.title || "",
        author: meta?.author_string || "",
        url: m?.url || "",
        snippet: m?.snippet || "",
      };
      saveState();
    } catch {
      // keep going; we might at least render something cached
    }
  }

  const item = state.itemsById[id];
  if (item) render(item);

  // Fetch full text in the background, then re-render if still on same poem.
  void ensureFullText(id).then((updated) => {
    if (!updated) return;
    if (currentId() !== id) return;
    const updatedItem = state.itemsById[id];
    if (updatedItem) render(updatedItem);
  });
}

async function goNext() {
  if (state.pointer < state.historyIds.length - 1) {
    state.pointer += 1;
    saveState();
    await showCurrent();
    return;
  }

  try {
    showStatus("טוען…");
    await ensureQueue(12);

    // Pick a random candidate from the queue to avoid serial feel.
    const seen = new Set(state.historyIds);
    let attempts = state.queueIds.length;
    let nextId = null;
    while (attempts-- > 0 && state.queueIds.length) {
      const idx = Math.floor(Math.random() * state.queueIds.length);
      const [candidate] = state.queueIds.splice(idx, 1);
      if (!seen.has(candidate)) {
        nextId = candidate;
        break;
      }
    }
    if (!nextId) throw new Error("No candidates");

    state.historyIds.push(nextId);
    state.pointer = state.historyIds.length - 1;
    saveState();

    // Ensure we have data (snippet usually comes from search already).
    if (!state.itemsById[nextId] || !state.itemsById[nextId].snippet) {
      await hydrateItems([nextId]);
    }
    await showCurrent();
  } catch (e) {
    console.error(e);
    showStatus("לא הצלחתי לטעון (אופליין?)");
  }
}

async function goPrev() {
  if (state.pointer <= 0) {
    showStatus("זה הראשון");
    return;
  }
  state.pointer -= 1;
  saveState();
  await showCurrent();
}

function setupSwipe() {
  let startX = 0;
  let startY = 0;
  let moved = false;
  const thresholdX = 42;
  const thresholdY = 70;

  el.app.addEventListener(
    "touchstart",
    (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      moved = false;
    },
    { passive: true }
  );

  el.app.addEventListener(
    "touchmove",
    (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true;
    },
    { passive: true }
  );

  el.app.addEventListener(
    "touchend",
    async (e) => {
      // If it was basically a tap, just show controls.
      if (!moved) {
        showControls();
        return;
      }
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > thresholdY) return; // vertical scroll gesture
      if (dx <= -thresholdX) await goNext(); // swipe left => next
      else if (dx >= thresholdX) await goPrev(); // swipe right => previous
    },
    { passive: true }
  );
}

function setupButtons() {
  el.themeBtn.addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
    showControls();
  });

  // Tap logic:
  // - left edge: next (consistent with swipe-left)
  // - right edge: previous
  // - middle: toggle controls
  el.app.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest("a")) return;
    if (target.closest("#controls")) return;
    const rect = el.app.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edge = rect.width * 0.2;
    if (x <= edge) {
      void goNext();
    } else if (x >= rect.width - edge) {
      void goPrev();
    } else {
      if (el.root.dataset.controls === "visible") hideControls();
      else showControls();
    }
  });
}

async function init() {
  loadState();
  setTheme(state.theme);
  hideControls();
  setupButtons();
  setupSwipe();
  if (el.version) el.version.textContent = APP_VERSION;

  el.root.dataset.splash = "visible";
  const splashDelay = new Promise((resolve) => setTimeout(resolve, 3000));

  const loadPoem = (async () => {
    // If we have a last viewed item cached, render immediately.
    if (state.historyIds.length && state.pointer >= 0) {
      await hydrateItems([state.historyIds[state.pointer]]);
      await showCurrent();
    } else {
      // First run: fetch one.
      await goNext();
    }
  })().catch((e) => {
    console.error(e);
  });

  await Promise.all([splashDelay, loadPoem]);
  hideSplash();

  // Register service worker (best-effort).
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    } catch (e) {
      console.warn("SW registration failed", e);
    }
  }
}

void init();
