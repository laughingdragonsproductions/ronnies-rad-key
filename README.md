# Ronnie's Rad Key

Interactive DNA timeline for Ronnie Radke — life strand + music video strand. Data merges [RCU Universe](G:\LocalAIagent\rcu-universe) releases with curated biography moments.

## First setup (RCU → Rad Key → browser)

One command refreshes RCU SQLite, copies library stills, rebuilds the helix dataset, and validates:

```powershell
cd "G:\Laughing Dragons\Websites\Ronnies Rad Key"
.\setup-first.ps1 -Serve
```

Without auto-starting the server:

```powershell
.\setup-first.ps1
.\serve.ps1
```

Open **http://127.0.0.1:8790/** (dev app serves `site/` at the root).

**RCU pipeline** (research map, wiki, collect) lives at `G:\LocalAIagent\rcu-universe\` — see that README. Rad Key only **reads** `rcu.sqlite` at build time.

## Quick start (already built)

```powershell
cd "G:\Laughing Dragons\Websites\Ronnies Rad Key"
.\serve.ps1
```

## Rebuild timeline JSON

After RCU refresh or edits to `data/key_moments.curated.json`:

```powershell
py -3 .\scripts\build_timeline.py
```

Set `RCU_DATA` to override the default RCU data path.

## Structure

| Path | Purpose |
|------|---------|
| `site/index.html` | Main experience |
| `site/js/helix.js` | Three.js DNA helix |
| `site/js/timeline-ui.js` | Slider, cards, filters, stats |
| `site/js/era-backdrop.js` | Tattoo-era background (color → blackout) |
| `data/key_moments.curated.json` | Hand-curated moments + eras |
| `scripts/build_timeline.py` | Builds `site/data/timeline.json` |
| `site/assets/ref/` | Reference video frames + style notes |

## Reference

DNA motion reference: `G:\Laughing Dragons\Music storyboard\snippet-4bar\Best images\Mouse_sliding_bar_rotates_DNA_20260926040548.mp4`

## Public launch note

Replace any copyrighted promo photos with licensed or original art before deploying (see plan: tattoo backdrop phase).
