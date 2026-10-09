/**
 * Optional Phase 2 API — search + meta + moment detail at same origin as Pages.
 * Static site works without this worker (client uses search-index.json).
 */

const DEFAULT_PAGES_HOST = "ronnies-rad-key.pages.dev";

function json(data, status = 200, cacheSeconds = 0) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cacheSeconds > 0) headers["Cache-Control"] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(data), { status, headers });
}

function proxyToPages(request, pagesHost) {
  const url = new URL(request.url);
  url.hostname = pagesHost;
  return fetch(new Request(url, request));
}

async function loadSearchIndex(env, pagesHost) {
  if (env.RADKEY_KV) {
    const raw = await env.RADKEY_KV.get("search-index");
    if (raw) return JSON.parse(raw);
  }
  const res = await fetch(`https://${pagesHost}/data/search-index.json`);
  if (!res.ok) throw new Error("search-index unavailable");
  return res.json();
}

function searchDocuments(documents, q, limit = 12) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return documents
    .map((d) => {
      const hay = `${d.title} ${d.summary || ""} ${d.strand || ""}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      return { doc: d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.doc);
}

async function handleSearch(request, env, pagesHost) {
  const q = new URL(request.url).searchParams.get("q") || "";
  if (q.trim().length < 2) return json({ results: [] });
  const index = await loadSearchIndex(env, pagesHost);
  const results = searchDocuments(index.documents || [], q);
  return json({ results, q }, 200, 120);
}

async function handleMeta(env, pagesHost) {
  if (env.RADKEY_KV) {
    const raw = await env.RADKEY_KV.get("rcu-meta");
    if (raw) return json(JSON.parse(raw), 200, 300);
  }
  const res = await fetch(`https://${pagesHost}/data/rcu-meta.json`);
  if (!res.ok) return json({ error: "meta unavailable" }, 502);
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function handleMoment(request, env, pagesHost) {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.replace(/^\/api\/moment\//, ""));
  if (!id || id.includes("..")) return json({ error: "invalid id" }, 400);

  if (env.RADKEY_KV) {
    const raw = await env.RADKEY_KV.get(`moment:${id}`);
    if (raw) return json(JSON.parse(raw), 200, 600);
  }

  const res = await fetch(`https://${pagesHost}/data/moments/${id}.json`);
  if (res.status === 404) return json({ error: "not found" }, 404);
  if (!res.ok) return json({ error: "upstream error" }, 502);
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pagesHost = env.PAGES_HOST || DEFAULT_PAGES_HOST;

    if (url.pathname === "/api/search") {
      return handleSearch(request, env, pagesHost);
    }
    if (url.pathname === "/api/meta") {
      return handleMeta(env, pagesHost);
    }
    if (url.pathname.startsWith("/api/moment/")) {
      return handleMoment(request, env, pagesHost);
    }

    return proxyToPages(request, pagesHost);
  },
};
