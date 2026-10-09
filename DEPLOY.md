# Ronnie's Rad Key — deploy & RCU data

## Local pipeline

1. Refresh RCU SQLite (in `rcu-universe`): `run-rcu publish` or your usual sync.
2. Point at the database and build:

```powershell
$env:RCU_DB = "G:\LocalAIagent\rcu-universe\data\rcu.sqlite"
py -3 scripts\build_from_rcu.py
py -3 scripts\verify_claims.py
py -3 scripts\validate_data.py
```

Optional: probe public source URLs during verification (HEAD requests, capped):

```powershell
$env:VERIFY_FETCH = "1"
py -3 scripts\verify_claims.py
```

Future bot-scraper denials: copy `data/verification_denials.scaffold.json` → `data/verification_denials.json` and append entries; re-run `verify_claims.py`. Full report: `site/data/verification-report.json`.

3. **Full local app** (recommended — same origin as production Worker):

```powershell
.\run-local.ps1
```

Opens `http://127.0.0.1:8790/` with `/api/search`, `/api/meta`, `/api/moment/:id`, `/api/graph`, and **POST `/api/rebuild`** (re-runs `build_from_rcu.py` from your `RCU_DB`).

Quick serve (skip rebuild): `.\serve.ps1` or `.\run-local.ps1 -SkipBuild`

**Pre-live / Pages preview (no API):**

```powershell
py -3 scripts\build_from_rcu.py
py -3 scripts\verify_claims.py
py -3 scripts\validate_data.py
.\serve-static.ps1
```

Same as Cloudflare Pages: only `site/` + JSON; no Local app badge or Sync button.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `RCU_DB` | Path to `rcu.sqlite` for `scripts/build_from_rcu.py` (default: `G:\LocalAIagent\rcu-universe\data\rcu.sqlite`) |
| `RCU_DATA` | Alias accepted by some tooling — set to the same path as `RCU_DB` if you prefer that name |

Outputs land in `site/data/` (`timeline.json`, `search-index.json`, `rcu-meta.json`, `graph.json`, `verification-report.json`, `moments/*.json` with optional `verification` blocks).

## Cloudflare Pages (static-first)

- **Project root for Pages:** `site/`
- **Build command:** none (pre-built JSON committed or built in CI)
- **GitHub Actions:** `.github/workflows/deploy-pages.yml`
  - Set secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  - Optional secret `RCU_DB`: absolute path only works on self-hosted runners; for GitHub-hosted runners, commit built `site/data/*` or mount RCU via submodule/checkout

## Optional Worker (Phase 2)

`worker/radkey-api.js` + `wrangler.toml`:

- `GET /api/search?q=` — same ranking as static `search-index.json`
- `GET /api/meta` — `rcu-meta.json`
- `GET /api/moment/:id` — detail shard proxy
- Other paths proxy to `PAGES_HOST`

Deploy:

```powershell
npx wrangler deploy
```

Bind `RADKEY_KV` if you want cached search/meta without hitting Pages on every request.

## Curated layer

Edit `data/key_moments.curated.json` and `data/site_config.json`, then rebuild. Curated rows win on matching `id` or `youtube_id`.
