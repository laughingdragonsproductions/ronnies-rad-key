# Reference video style notes

Source: `Mouse_sliding_bar_rotates_DNA_20260926040548.mp4`

Extracted frames: `ref_01.jpg` … `ref_05.jpg`

Observations for implementation:
- **Background:** near-black with soft vignette; helix is the brightest element.
- **Helix:** cyan/teal and magenta dual strands; rungs read as short luminous bars.
- **Motion:** continuous Y-axis rotation; vertical scrub maps to travel along the helix height.
- **Slider:** vertical control on the right edge; knob position = active year / progress.
- **Pace:** smooth easing when releasing the slider; no hard snaps.

Site palette aligned to reference: strand A `#22d3ee`, strand B `#e879f9`, rungs `#fbbf24` (importance-scaled).

## Hybrid render stack (2026)

1. **Solid tubes + rungs** — `helix-geometry.js` (glass shader on strands, physical material rungs).
2. **Wisp particles** — halo-only strands and rung halos in `particle-helix.js`.
3. **Flow** — shader bands + curve streams + Rad Key trail; see [REF-FLOW.md](./REF-FLOW.md) for tiers and tuning.
