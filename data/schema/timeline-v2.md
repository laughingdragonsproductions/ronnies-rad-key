# Timeline bundle schema (v2)

## `site/data/timeline.json`

- `schema_version`: `2`
- `title`, `subtitle`, `rcu_name`, `subject`
- `year_min`, `year_max`, `updated_at`
- `eras`, `tattoo_eras` (from `site_config.json`)
- `rcu_meta`: counts + `synced_at` (mirror of `rcu-meta.json`)
- `stats`: video views + RCU scope counts
- `moments[]`: helix rungs (minimal fields for render)

### Moment (timeline row)

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | stable slug |
| `strand` | `life` \| `music` \| `lore` | |
| `category` | string | e.g. `music_video`, `legal` |
| `year` | number | required for helix |
| `month`, `day` | number? | optional |
| `title`, `summary` | string | short card text |
| `youtube_id`, `url`, `thumbnail` | optional | music |
| `view_count`, `views_per_day`, `era`, `rcu_tier` | optional | music |
| `importance`, `importance_score` | number | 0–1 |
| `t` | number | 0–1 position on axis |
| `provenance` | object | RCU ids |
| `related` | `{id, rel_type, title?}[]` | lore edges |
| `detail_path` | string | e.g. `data/moments/mv-xxx.json` |

## `site/data/moments/{id}.json`

Full card: lore, frame_captions, comments_sample, sources, related videos.

## `site/data/search-index.json`

MiniSearch-compatible documents: `{ id, title, summary, strand, year, tokens? }`

## `site/data/graph.json`

`nodes[]`, `edges[]` for RCU universe view.
