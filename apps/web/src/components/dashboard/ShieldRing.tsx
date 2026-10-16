import type { CSSProperties } from "react";

interface ShieldRingProps {
  enabled: number;
  total: number;
  className?: string;
}

const CENTER = 100;
const RADIUS = 83;

function segmentPath(start: number, end: number) {
  const point = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return [
      CENTER + RADIUS * Math.cos(radians),
      CENTER + RADIUS * Math.sin(radians),
    ];
  };
  const [x0, y0] = point(start);
  const [x1, y1] = point(end);
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${RADIUS} ${RADIUS} 0 ${end - start > 180 ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

/** One segment represents one Shield module; this is not a security rating. */
export function ShieldRing({
  enabled,
  total,
  className = "",
}: ShieldRingProps) {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const active = Number.isFinite(enabled)
    ? Math.min(Math.max(0, Math.floor(enabled)), count)
    : 0;
  const step = count ? 360 / count : 0;
  const gap = Math.min(6, step * 0.24);

  return (
    <svg
      viewBox="0 0 200 200"
      className={`nox-shield-ring ${className}`}
      role="img"
      aria-label={`Включено модулей защиты: ${active} из ${count}`}
    >
      <circle className="nox-ring-guide" cx="100" cy="100" r="66" />
      <path
        className="nox-ring-crosshair"
        d="M 97 27 h 6 M 97 173 h 6 M 27 97 v 6 M 173 97 v 6"
      />
      {count === 0 && (
        <circle cx="100" cy="100" r={RADIUS} className="nox-segment" />
      )}
      {count === 1 ? (
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          className={`nox-segment ${active ? "nox-segment--on" : ""}`}
          style={{ "--segment-index": 0 } as CSSProperties}
        />
      ) : (
        Array.from({ length: count }, (_, index) => (
          <path
            key={index}
            d={segmentPath(
              index * step + gap / 2,
              (index + 1) * step - gap / 2,
            )}
            className={`nox-segment ${index < active ? "nox-segment--on" : ""}`}
            style={{ "--segment-index": index } as CSSProperties}
          />
        ))
      )}
      <text className="nox-ring-count" x="100" y="110" textAnchor="middle">
        {active}
        <tspan className="nox-ring-total">/{count}</tspan>
      </text>
    </svg>
  );
}
