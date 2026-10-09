/** Tattoo-era backdrop: colorful -> transition -> blackout by active year */

const COLORFUL_IMG = "./assets/eras/colorful-ref.png";
const BLACKOUT_IMG = "./assets/eras/then-now-ref.png";

export function createEraBackdrop(tattooEras) {
  const backdrop = document.getElementById("backdrop");
  const ink = document.getElementById("ink-overlay");
  if (!backdrop || !tattooEras?.length) {
    return { update() {} };
  }

  backdrop.style.backgroundSize = "cover";
  backdrop.style.backgroundPosition = "center";
  backdrop.style.backgroundRepeat = "no-repeat";

  function eraForYear(year) {
    for (const e of tattooEras) {
      if (year >= e.start_year && year <= e.end_year) return e;
    }
    return tattooEras[tattooEras.length - 1];
  }

  function blendAmount(year) {
    const trans = tattooEras.find((e) => e.backdrop === "transition");
    if (!trans) return year >= 2023 ? 1 : 0;
    if (year <= trans.start_year) return 0;
    if (year >= trans.end_year) return 1;
    return (year - trans.start_year) / (trans.end_year - trans.start_year);
  }

  return {
    update(year) {
      const era = eraForYear(year);
      const blend = blendAmount(year);
      backdrop.className = era.backdrop || "colorful";

      if (blend <= 0.05) {
        backdrop.style.backgroundImage = `linear-gradient(rgba(5,5,8,0.82), rgba(5,5,8,0.88)), url('${COLORFUL_IMG}')`;
      } else if (blend >= 0.95) {
        backdrop.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.75), rgba(0,0,0,0.85)), url('${BLACKOUT_IMG}')`;
        backdrop.style.backgroundPosition = "right center";
      } else {
        backdrop.style.backgroundImage = `linear-gradient(rgba(5,5,8,${0.7 + blend * 0.2}), rgba(0,0,0,${0.75 + blend * 0.15})), url('${COLORFUL_IMG}'), url('${BLACKOUT_IMG}')`;
      }

      if (ink) {
        const inkAmt =
          era.backdrop === "transition"
            ? 0.15 + blend * 0.5
            : era.backdrop === "blackout"
              ? 0.4
              : 0;
        ink.style.opacity = String(inkAmt);
      }
    },
  };
}
