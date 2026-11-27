/** Tattoo-era backdrop: young (then/now left) -> full ink -> blackout (then/now right) */

const COLORFUL_IMG = "./assets/eras/colorful-ref.png";
const THEN_NOW_IMG = "./assets/eras/then-now-ref.png";

/** Side-by-side composite: show one half at a time. */
const SPLIT_BG_SIZE = "200% auto";

function splitLayer(url, side, overlayAlpha = 0.85) {
  const pos = side === "left" ? "left center" : "right center";
  return {
    image: `linear-gradient(rgba(5,5,8,${overlayAlpha}), rgba(5,5,8,${overlayAlpha + 0.05})), url('${url}')`,
    size: SPLIT_BG_SIZE,
    position: pos,
  };
}

function coverLayer(url, overlayAlpha = 0.85) {
  return {
    image: `linear-gradient(rgba(5,5,8,${overlayAlpha}), rgba(5,5,8,${overlayAlpha + 0.05})), url('${url}')`,
    size: "cover",
    position: "center",
  };
}

function applyLayer(backdrop, layer) {
  backdrop.style.backgroundImage = layer.image;
  backdrop.style.backgroundSize = layer.size;
  backdrop.style.backgroundPosition = layer.position;
  backdrop.style.backgroundRepeat = "no-repeat";
}

export function createEraBackdrop(tattooEras) {
  const backdrop = document.getElementById("backdrop");
  const ink = document.getElementById("ink-overlay");
  if (!backdrop || !tattooEras?.length) {
    return { update() {} };
  }

  const youngEra = tattooEras.find((e) => e.backdrop === "young");
  const colorEra = tattooEras.find((e) => e.backdrop === "colorful");
  const colorStart = colorEra?.start_year ?? 2004;
  const youngEnd = youngEra?.end_year ?? colorStart - 0.1;

  function eraForYear(year) {
    for (const e of tattooEras) {
      if (year >= e.start_year && year <= e.end_year) return e;
    }
    return tattooEras[tattooEras.length - 1];
  }

  function blastoverBlend(year) {
    const trans = tattooEras.find((e) => e.backdrop === "transition");
    if (!trans) return year >= 2023 ? 1 : 0;
    if (year <= trans.start_year) return 0;
    if (year >= trans.end_year) return 1;
    return (year - trans.start_year) / (trans.end_year - trans.start_year);
  }

  function youngColorfulBlend(year) {
    const fadeStart = youngEnd - 0.25;
    const fadeEnd = colorStart + 1.25;
    if (year <= fadeStart) return 0;
    if (year >= fadeEnd) return 1;
    return (year - fadeStart) / (fadeEnd - fadeStart);
  }

  return {
    update(year) {
      const era = eraForYear(year);
      const toColorful = youngColorfulBlend(year);
      const toBlackout = blastoverBlend(year);

      backdrop.className = era.backdrop || "colorful";

      if (toColorful < 0.08) {
        applyLayer(backdrop, splitLayer(THEN_NOW_IMG, "left"));
      } else if (toColorful > 0.92 && toBlackout <= 0.05) {
        applyLayer(backdrop, coverLayer(COLORFUL_IMG));
      } else if (toBlackout >= 0.95) {
        const layer = splitLayer(THEN_NOW_IMG, "right", 0.78);
        layer.image = `linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.86)), url('${THEN_NOW_IMG}')`;
        applyLayer(backdrop, layer);
      } else if (toColorful < 0.92) {
        const t = toColorful;
        backdrop.style.backgroundSize = `${SPLIT_BG_SIZE}, cover`;
        backdrop.style.backgroundPosition = `left center, center`;
        backdrop.style.backgroundImage = [
          `linear-gradient(rgba(5,5,8,${0.86 - t * 0.12}), rgba(5,5,8,${0.9 - t * 0.1})), url('${THEN_NOW_IMG}')`,
          `linear-gradient(rgba(5,5,8,${0.82 * t}), rgba(5,5,8,${0.88 * t})), url('${COLORFUL_IMG}')`,
        ].join(", ");
      } else {
        const t = toBlackout;
        backdrop.style.backgroundSize = `cover, ${SPLIT_BG_SIZE}`;
        backdrop.style.backgroundPosition = `center, right center`;
        backdrop.style.backgroundImage = [
          `linear-gradient(rgba(5,5,8,${0.85 - t * 0.08}), rgba(5,5,8,${0.9 - t * 0.06})), url('${COLORFUL_IMG}')`,
          `linear-gradient(rgba(0,0,0,${0.55 * t}), rgba(0,0,0,${0.78 * t})), url('${THEN_NOW_IMG}')`,
        ].join(", ");
      }

      if (ink) {
        const inkAmt =
          era.backdrop === "transition"
            ? 0.15 + toBlackout * 0.5
            : era.backdrop === "blackout"
              ? 0.4
              : era.backdrop === "young"
                ? 0.05
                : 0;
        ink.style.opacity = String(inkAmt);
      }
    },
  };
}