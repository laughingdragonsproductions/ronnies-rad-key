# Flow VFX reference and tuning

## Intended look

- **Solid glass strands and rungs** (`helix-geometry.js`) — structure reads without particles.
- **Shader flow** on strands — soft luminous bands moving along the tube (timeline direction).
- **Stream particles** (`particle-flow.js`) — points advect with `curve.getPointAt(along)` on both strands.
- **Rad Key trail** — additive burst at `progressToX(progress)` when scrub velocity is high or canvas scrub is active.

Reference clip (local): `hi.mp4` under Music storyboard `snippet-4bar/Best images/` — copy here and extract frames when tuning speed.

## Tuning knobs

| Knob | Location | Default (high tier) |
|------|----------|---------------------|
| `uFlowSpeed` | `helixGlassUniforms` | 0.35 |
| `uFlowRepeat` | `helixGlassUniforms` | 14 |
| `uFlowStrength` | `helixGlassUniforms` | 0.55 |
| Stream cap | `streamParticleCapForTier()` | 2000 (high), 600 (medium), 0 (low) |
| Trail spawns/frame | `maxTrailSpawnsPerFrame()` | 8 / 4 / 0 |
| Bloom | `helix.js` UnrealBloomPass | strength 0.42, radius 0.38, threshold 0.32 |

## Quality tiers (`helix-quality.js`)

- **high** — full flow shader, streams, trail.
- **medium** — slower flow, fewer streams, limited trail (narrow viewport or ≤4 cores).
- **low** — `prefers-reduced-motion` or degraded after sustained slow frames: no flow motion, no streams/trail; solids + static wisps remain.

## Degrade path (frame watchdog)

Rolling frame time over ~22ms for ~120 frames steps tier down: high → medium → low. Streams rebuild on tier change.

## Failure modes (handled)

- Tab hidden: capped `dt`, no trail/stream advance while hidden.
- WebGL context loss: pause rAF until restored.
- Transparency: solids `depthWrite: true`; particles additive with `depthWrite: false`.
- Trail semantics: tied to **Rad Key progress**, not focus slider.
