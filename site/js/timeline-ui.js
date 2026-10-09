import { createHelix, detectWebGL } from "./helix.js";
import { createEraBackdrop } from "./era-backdrop.js";
import {
  cancelCardMaterialize,
  materializeCardReveal,
  momentAccentColors,
  prefersReducedCardMotion,
} from "./card-materialize.js";

const VIEW_MODE_KEY = "radkey-view-mode";
const FILTERS = [
  { id: "all", label: "All" },
  { id: "life", label: "Life" },
  { id: "legal", label: "Legal" },
  { id: "music_video", label: "Music Videos" },
  { id: "lore", label: "RCU / Lore" },
  { id: "career", label: "Career" },
  { id: "personal", label: "Personal" },
];

const HINTS = {
  "2d": "2D — Rad Key = time · Focus slider = center view · Alt+drag twist · Shift+drag pan.",
  "3d": "3D — Rad Key = time · Focus = center view · Drag orbit · Alt corkscrew · Shift pan.",
};

const detailCache = new Map();
const LORE_TIERS = new Set(["canonical", "core"]);

function formatViews(n) {
  if (!n) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K views`;
  return `${n} views`;
}

function formatFreshness(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

const VERIFICATION_BADGE_STATUSES = new Set(["unproven", "disputed", "conflict"]);

function pickVerification(moment, detail) {
  return detail?.verification || moment?.verification || null;
}

function verificationBadgeHtml(ver) {
  if (!ver || !VERIFICATION_BADGE_STATUSES.has(ver.status)) return "";
  const label = ver.label || ver.status;
  return `<span class="verify-badge verify-${ver.status}" title="${ver.notes || label}">${label}</span>`;
}

function verificationNoteHtml(ver) {
  if (!ver || ver.status === "verified") return "";
  const parts = [];
  if (ver.label) parts.push(ver.label);
  if (ver.notes) parts.push(ver.notes);
  if (ver.conflicts?.length) {
    parts.push(`${ver.conflicts.length} conflict record(s) on file.`);
  }
  if (!parts.length) return "";
  return `<p class="verify-note">${parts.join(" — ")}</p>`;
}

function momentIsLore(m) {
  if (m.strand === "lore") return true;
  if (Array.isArray(m.related) && m.related.length > 0) return true;
  if (m.rcu_tier && LORE_TIERS.has(m.rcu_tier)) return true;
  if (m.rcu?.rcu_tier && LORE_TIERS.has(m.rcu.rcu_tier)) return true;
  return false;
}

function momentMatchesFilter(m, filterId) {
  if (filterId === "all") return true;
  if (filterId === "life") return m.strand === "life";
  if (filterId === "legal") return m.category === "legal";
  if (filterId === "music_video") return m.category === "music_video";
  if (filterId === "lore") return momentIsLore(m);
  if (filterId === "career") return m.category === "career";
  if (filterId === "personal") return m.category === "personal";
  return true;
}

function loadViewMode() {
  try {
    const v = sessionStorage.getItem(VIEW_MODE_KEY);
    return v === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

function saveViewMode(mode) {
  try {
    sessionStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function buildFallbackList(moments) {
  const root = document.getElementById("fallback-list");
  if (!root) return;
  root.innerHTML = "<h2>Ronnie's Rad Key — timeline</h2>";
  for (const m of moments) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<div class="year">${m.year}</div><strong>${m.title}</strong><p>${m.summary || ""}</p>`;
    if (m.youtube_id) {
      const a = document.createElement("a");
      a.href = `https://www.youtube.com/watch?v=${m.youtube_id}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Watch on YouTube";
      div.appendChild(a);
    }
    root.appendChild(div);
  }
}

function loreSummaryText(loreBlock, moment) {
  const raw = (loreBlock?.summary || "").trim();
  if (!raw || raw.startsWith("{") || raw.includes("entity_slug")) return "";
  if (moment.summary && raw === String(moment.summary).trim()) return "";
  return raw;
}

function hasLoreContent(moment, detail) {
  const loreBlock = detail?.lore || {};
  const related = loreBlock.related?.length ? loreBlock.related : moment.related || [];
  if (related.length > 0) return true;
  if (loreSummaryText(loreBlock, moment).length > 0) return true;
  return false;
}

function setLoreOpen(cardEl, open) {
  const panel = cardEl.querySelector('.tab-panel[data-tab="lore"]');
  const btn = cardEl.querySelector('.card-tabs button[data-tab="lore"]');
  if (!panel || !btn) return;
  const show = Boolean(open);
  panel.hidden = !show;
  panel.classList.toggle("active", show);
  btn.classList.toggle("active", show);
  btn.setAttribute("aria-expanded", show ? "true" : "false");
}

function renderLorePanel(cardEl, moment, detail) {
  const lore = cardEl.querySelector('.tab-panel[data-tab="lore"]');
  const tabs = cardEl.querySelector(".card-tabs");
  if (!lore || !tabs) return;

  const loreBlock = detail?.lore || {};
  const related = loreBlock.related?.length ? loreBlock.related : moment.related || [];
  const loreSummary = loreSummaryText(loreBlock, moment);

  if (!hasLoreContent(moment, detail)) {
    tabs.hidden = true;
    lore.hidden = true;
    setLoreOpen(cardEl, false);
    return;
  }

  tabs.hidden = false;
  lore.innerHTML = `
    ${loreSummary ? `<p>${loreSummary}</p>` : ""}
    ${
      related.length
        ? `<strong>Connected in the RCU</strong><ul class="detail-list related-links">${related
            .map((r) => {
              const label = r.title || r.relation || r.target_id || "Link";
              const id = r.target_id || r.id;
              if (id) {
                return `<li><button type="button" class="link-moment" data-moment-id="${id}">${label}${r.relation ? ` (${r.relation})` : ""}</button></li>`;
              }
              return `<li>${label}</li>`;
            })
            .join("")}</ul>`
        : ""
    }`;
}

/** Last-pass cleanup for scraped summaries shown in the card. */
function formatMomentSummary(text) {
  if (!text) return "";
  return text
    .replace(/\(also featuring\s*\)/gi, "")
    .replace(/,?\s*which features\s*,/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function updateCardOverview(cardEl, moment, detail) {
  const ver = pickVerification(moment, detail);
  const noteSlot = cardEl.querySelector(".verify-note-slot");
  if (noteSlot) noteSlot.innerHTML = verificationNoteHtml(ver);
  cardEl.querySelector(".summary").textContent = formatMomentSummary(moment.summary || "");
}

async function fetchMomentDetail(moment) {
  const cacheKey = moment.id;
  if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);
  try {
    let res = await fetch(`/api/moment/${encodeURIComponent(moment.id)}`);
    if (!res.ok) {
      const path = moment.detail_path || `data/moments/${moment.id}.json`;
      const url = path.startsWith("data/") ? `./${path}` : `./data/moments/${moment.id}.json`;
      res = await fetch(url);
    }
    if (!res.ok) return null;
    const json = await res.json();
    detailCache.set(cacheKey, json);
    return json;
  } catch {
    const path = moment.detail_path || `data/moments/${moment.id}.json`;
    const url = path.startsWith("data/") ? `./${path}` : `./data/moments/${moment.id}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      detailCache.set(cacheKey, json);
      return json;
    } catch {
      return null;
    }
  }
}

async function setupLocalAppTools(onDataRefresh) {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const health = await res.json();
    document.body.dataset.radkeyBackend = "local";

    const toolsBar = document.getElementById("dev-tools-bar");
    if (toolsBar) toolsBar.hidden = false;

    let badge = document.getElementById("dev-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "dev-badge";
      badge.className = "dev-badge";
      (toolsBar || document.body).appendChild(badge);
    }
    if (toolsBar && badge.parentElement !== toolsBar) toolsBar.appendChild(badge);
    badge.hidden = false;
    badge.textContent = `Local app · ${health.moments ?? "?"} moments`;

    let rebuild = document.getElementById("rebuild-btn");
    if (!rebuild) {
      rebuild = document.createElement("button");
      rebuild.id = "rebuild-btn";
      rebuild.type = "button";
      rebuild.className = "rebuild-btn";
      rebuild.textContent = "Sync RCU → site";
      (toolsBar || document.body).appendChild(rebuild);
      rebuild.addEventListener("click", async () => {
        rebuild.disabled = true;
        rebuild.textContent = "Building…";
        try {
          const r = await fetch("/api/rebuild", { method: "POST" });
          const body = await r.json();
          if (!r.ok) throw new Error(body.log || "rebuild failed");
          rebuild.textContent = "Done — reload";
          onDataRefresh?.(body.meta);
          setTimeout(() => window.location.reload(), 600);
        } catch (err) {
          rebuild.textContent = "Sync failed";
          console.error(err);
          setTimeout(() => {
            rebuild.disabled = false;
            rebuild.textContent = "Sync RCU → site";
          }, 2500);
        }
      });
    }
    if (toolsBar && rebuild.parentElement !== toolsBar) toolsBar.appendChild(rebuild);
    rebuild.hidden = false;

    const metaRes = await fetch("/api/meta");
    if (metaRes.ok) {
      const meta = await metaRes.json();
      badge.title = meta.synced_at ? `Dataset synced ${formatFreshness(meta.synced_at)}` : "Local RCU export";
    }
  } catch {
    /* static hosting — no local API */
  }
}

function populateCardContent(moment, cardEl, { onRelatedSelect } = {}) {
  const tier = moment.rcu_tier || moment.rcu?.rcu_tier;
  const metaBits = [moment.year, moment.category || moment.strand, tier ? `RCU ${tier}` : ""].filter(Boolean);
  const metaEl = cardEl.querySelector(".meta");
  const verPreview = pickVerification(moment, null);
  metaEl.innerHTML = `${metaBits.join(" · ")}${verificationBadgeHtml(verPreview)}`;
  cardEl.querySelector("h2").textContent = moment.title;

  const thumb = cardEl.querySelector("img.thumb");
  const watch = cardEl.querySelector("a.watch");
  const embed = cardEl.querySelector(".embed-wrap");
  embed.classList.remove("active");
  embed.innerHTML = "";

  const hasVideo = Boolean(moment.youtube_id);

  if (hasVideo) {
    thumb.src = moment.thumbnail || `https://i.ytimg.com/vi/${moment.youtube_id}/hqdefault.jpg`;
    thumb.style.display = "block";
    watch.href = moment.url || `https://www.youtube.com/watch?v=${moment.youtube_id}`;
    watch.style.display = "inline-block";
    watch.textContent = `${formatViews(moment.view_count)} — open video`;
    watch.onclick = (e) => {
      e.preventDefault();
      embed.classList.add("active");
      embed.innerHTML = `<iframe allowfullscreen src="https://www.youtube.com/embed/${moment.youtube_id}?autoplay=1"></iframe>`;
    };
  } else {
    thumb.style.display = "none";
    watch.style.display = "none";
  }

  updateCardOverview(cardEl, moment, null);
  renderLorePanel(cardEl, moment, null);
  setLoreOpen(cardEl, false);

  cardEl.querySelectorAll(".link-moment").forEach((btn) => btn.replaceWith(btn.cloneNode(true)));
  cardEl.querySelectorAll(".link-moment").forEach((btn) => {
    btn.addEventListener("click", () => onRelatedSelect?.(btn.dataset.momentId));
  });

  fetchMomentDetail(moment).then((detail) => {
    if (cardEl.dataset.momentId !== moment.id) return;
    const verFull = pickVerification(moment, detail);
    const metaEl2 = cardEl.querySelector(".meta");
    const metaText = [moment.year, moment.category || moment.strand, tier ? `RCU ${tier}` : ""]
      .filter(Boolean)
      .join(" · ");
    metaEl2.innerHTML = `${metaText}${verificationBadgeHtml(verFull)}`;
    updateCardOverview(cardEl, moment, detail);
    renderLorePanel(cardEl, moment, detail);
    setLoreOpen(cardEl, false);
    cardEl.querySelectorAll(".link-moment").forEach((btn) => {
      btn.addEventListener("click", () => onRelatedSelect?.(btn.dataset.momentId));
    });
  });
}

function showCard(moment, cardEl, { onRelatedSelect, origin = null, animate = true } = {}) {
  if (!moment) {
    cancelCardMaterialize();
    cardEl.classList.remove("visible");
    cardEl.removeAttribute("data-moment-id");
    return;
  }

  cancelCardMaterialize();
  cardEl.dataset.momentId = moment.id;
  cardEl.classList.remove("visible");
  populateCardContent(moment, cardEl, { onRelatedSelect });

  const reduced = prefersReducedCardMotion();
  const cardRect = cardEl.getBoundingClientRect();
  const canAnimate =
    animate &&
    !reduced &&
    origin &&
    Number.isFinite(origin.x) &&
    Number.isFinite(origin.y) &&
    cardRect.width > 0;

  if (!canAnimate) {
    cardEl.classList.add("visible");
    return;
  }

  materializeCardReveal({
    fromX: origin.x,
    fromY: origin.y,
    toRect: cardRect,
    colors: momentAccentColors(moment),
    onPeak: () => {
      if (cardEl.dataset.momentId === moment.id) {
        cardEl.classList.add("visible");
      }
    },
    onComplete: () => {
      if (cardEl.dataset.momentId === moment.id && !cardEl.classList.contains("visible")) {
        cardEl.classList.add("visible");
      }
    },
  });
}

function buildStats(data) {
  const el = document.getElementById("stats-panel");
  if (!el) return;
  const stats = data.stats || {};
  const rcu = stats.rcu || data.rcu_meta?.counts || {};
  const top = (stats.top_by_views || [])
    .slice(0, 3)
    .map((t) => `• ${t.title} (${formatViews(t.view_count)})`)
    .join("<br>");
  const synced = formatFreshness(data.rcu_meta?.synced_at || data.updated_at);
  el.innerHTML = `<strong>RCU dataset</strong>
    ${rcu.moments ?? stats.official_video_count ?? "—"} helix moments<br>
    ${rcu.videos_in_db ?? "—"} videos · ${rcu.entities ?? "—"} entities · ${rcu.relations ?? "—"} links<br>
    ${formatViews(stats.total_views_sampled)} sampled reach<br>
    ${synced ? `Synced ${synced}<br>` : ""}<br>${top}`;
}

function applyBranding(data) {
  const h1 = document.querySelector("header h1");
  if (h1 && data.title) h1.textContent = data.title;
  const sub = document.getElementById("site-subtitle");
  if (sub) sub.textContent = data.subtitle || "";
  const foot = document.getElementById("site-footer");
  if (foot) {
    const name = data.rcu_name || data.rcu_meta?.display_name || "Ronnie Cinematic Universe";
    foot.textContent = `Powered by the ${name} dataset`;
  }
}

function updateViewHint(mode) {
  const hint = document.getElementById("view-hint");
  if (hint) hint.textContent = HINTS[mode] || HINTS["2d"];
  document.body.dataset.viewMode = mode;
}

function syncViewToggle(mode) {
  document.querySelectorAll("[data-view-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.viewMode === mode);
  });
}

function localSearch(docs, q, limit = 8) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return docs
    .map((d) => {
      const hay = `${d.title} ${d.summary || ""} ${d.strand || ""} ${d.category || ""}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      return { doc: d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.doc.year || 0) - (a.doc.year || 0))
    .slice(0, limit)
    .map((x) => x.doc);
}

async function apiSearch(q) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || data.documents || null;
  } catch {
    return null;
  }
}

function setupSearch(searchDocs, onPick) {
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-results");
  if (!input || !list) return;

  let debounce = null;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        list.hidden = true;
        list.innerHTML = "";
        return;
      }
      let hits = await apiSearch(q);
      if (!hits) hits = localSearch(searchDocs, q);
      list.innerHTML = hits
        .map(
          (d) =>
            `<li><button type="button" data-id="${d.id}"><span class="sr">${d.year}</span> ${d.title}</button></li>`
        )
        .join("");
      list.hidden = hits.length === 0;
      list.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          onPick(btn.dataset.id);
          list.hidden = true;
          input.value = "";
        });
      });
    }, 180);
  });

  document.addEventListener("click", (e) => {
    if (!list.contains(e.target) && e.target !== input) list.hidden = true;
  });
}

export async function initTimelineApp() {
  const [timelineRes, searchRes] = await Promise.all([
    fetch("./data/timeline.json"),
    fetch("./data/search-index.json").catch(() => null),
  ]);
  const data = await timelineRes.json();
  const searchIndex = searchRes?.ok ? await searchRes.json() : { documents: [] };
  const allMoments = data.moments || [];
  const momentById = new Map(allMoments.map((m) => [m.id, m]));

  applyBranding(data);
  buildStats(data);
  buildFallbackList(allMoments);
  setupLocalAppTools();

  const card = document.getElementById("card");
  const cardNeedsLayout =
    card && (card.dataset.layout !== "v2" || card.querySelector('[data-tab="overview"]'));
  if (cardNeedsLayout) {
    card.dataset.layout = "v2";
    card.innerHTML = `
      <button type="button" class="card-close" aria-label="Close">×</button>
      <div class="meta"></div>
      <h2></h2>
      <div class="verify-note-slot"></div>
      <p class="summary"></p>
      <img class="thumb" alt="" />
      <a class="watch" href="#" target="_blank" rel="noopener">Watch</a>
      <div class="embed-wrap"></div>
      <nav class="card-tabs" role="tablist" hidden>
        <button type="button" role="tab" data-tab="lore" aria-expanded="false">Lore</button>
      </nav>
      <div class="tab-panels">
        <div class="tab-panel" data-tab="lore" hidden></div>
      </div>`;
    card.querySelector(".card-close")?.addEventListener("click", () => {
      cancelCardMaterialize();
      card.classList.remove("visible");
      card.removeAttribute("data-moment-id");
    });
    const loreTabBtn = card.querySelector('.card-tabs button[data-tab="lore"]');
    loreTabBtn?.addEventListener("click", () => {
      const panel = card.querySelector('.tab-panel[data-tab="lore"]');
      const open = panel?.hidden !== false;
      setLoreOpen(card, open);
    });
  }

  if (!detectWebGL()) {
    document.body.classList.add("no-webgl");
    return;
  }

  const canvas = document.getElementById("helix-canvas");
  const slider = document.getElementById("key-slider");
  const focusSlider = document.getElementById("focus-slider");
  const yearDisplay = document.getElementById("year-display");
  const controls = document.getElementById("controls");
  const backdropCtl = createEraBackdrop(data.tattoo_eras);

  let activeFilter = "all";
  let savedViewMode = loadViewMode();
  let helix;

  function pickMoment(id) {
    const m = momentById.get(id);
    if (!m || !helix) return;
    helix.focusMoment(id);
    card.dataset.momentId = id;
    showCard(m, card, { onRelatedSelect: pickMoment });
  }

  setupSearch(searchIndex.documents || [], pickMoment);

  function filteredMoments() {
    return allMoments.filter((m) => momentMatchesFilter(m, activeFilter));
  }

  function makeHelix(viewMode) {
    return createHelix({
      canvas,
      moments: filteredMoments(),
      eras: data.eras,
      yearMin: data.year_min,
      yearMax: data.year_max,
      viewMode,
      onProgress(_p, year) {
        yearDisplay.textContent = Math.round(year);
        slider.value = String(((year - data.year_min) / (data.year_max - data.year_min)) * 100);
        backdropCtl.update(year);
      },
      onSelect(m, ctx) {
        showCard(m, card, {
          onRelatedSelect: pickMoment,
          origin: ctx?.origin ?? null,
          animate: Boolean(ctx?.origin),
        });
      },
      onHover(m) {
        if (m && !card.classList.contains("visible")) {
          yearDisplay.textContent = m.year;
        }
      },
      onViewModeChange(mode) {
        saveViewMode(mode);
        syncViewToggle(mode);
        updateViewHint(mode);
      },
    });
  }

  helix = makeHelix(savedViewMode);
  syncViewToggle(savedViewMode);
  updateViewHint(savedViewMode);

  if (focusSlider) {
    const applyFocus = () => {
      helix.setFocusProgress(Number(focusSlider.value) / 100);
    };
    applyFocus();
    focusSlider.addEventListener("input", applyFocus, { passive: true });
  }

  slider.addEventListener("input", () => {
    const p = Number(slider.value) / 100;
    helix.setProgress(p);
    const year = data.year_min + p * (data.year_max - data.year_min);
    yearDisplay.textContent = Math.round(year);
    backdropCtl.update(year);
  });

  slider.addEventListener(
    "change",
    () => {
      const p = Number(slider.value) / 100;
      const year = data.year_min + p * (data.year_max - data.year_min);
      yearDisplay.textContent = Math.round(year);
      backdropCtl.update(year);
    },
    { passive: true }
  );

  const viewRow = document.getElementById("view-toggle");
  if (viewRow) {
    viewRow.querySelectorAll("[data-view-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.viewMode === "3d" ? "3d" : "2d";
        helix.setViewMode(mode);
        saveViewMode(mode);
        syncViewToggle(mode);
        updateViewHint(mode);
      });
    });
  }

  const row = document.createElement("div");
  row.className = "controls-row filters-row";
  for (const f of FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${f.id === "all" ? " active" : ""}`;
    btn.textContent = f.label;
    btn.addEventListener("click", () => {
      activeFilter = f.id;
      row.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const p = helix.getProgress();
      const fp = helix.getFocusProgress();
      const mode = helix.getViewMode();
      helix.dispose();
      helix = makeHelix(mode);
      helix.setProgress(p, { emit: false });
      helix.setFocusProgress(fp);
      if (focusSlider) focusSlider.value = String(fp * 100);
    });
    row.appendChild(btn);
  }
  controls.appendChild(row);

  const eraRow = document.createElement("div");
  eraRow.className = "controls-row eras-row";
  for (const era of data.eras || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "era-jump";
    btn.textContent = era.label;
    btn.addEventListener("click", () => {
      const mid = (era.start + era.end) / 2;
      const p = (mid - data.year_min) / (data.year_max - data.year_min);
      helix.setProgress(p);
      slider.value = String(p * 100);
      yearDisplay.textContent = Math.round(mid);
      backdropCtl.update(mid);
    });
    eraRow.appendChild(btn);
  }
  controls.appendChild(eraRow);

  const startYear = 2019;
  const startP = (startYear - data.year_min) / (data.year_max - data.year_min);
  helix.setProgress(startP);
  slider.value = String(startP * 100);
  yearDisplay.textContent = String(startYear);
  backdropCtl.update(startYear);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cancelCardMaterialize();
      card.classList.remove("visible");
      card.removeAttribute("data-moment-id");
    }
  });
}
