import { SKILL_CATEGORIES } from "@/lib/skills";

// Self-contained SVG radar/spider chart for a member's skills (0–100 per axis).
// No chart lib — pure SVG so it works under the strict CSP and both themes.

export function SkillRadar({
  values,
  size = 320,
  accent = "#a3e635",
}: {
  values: Record<string, number>;
  size?: number;
  accent?: string;
}) {
  const cats = SKILL_CATEGORIES;
  const n = cats.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.34;
  const angle = (i: number) => (-90 + (i * 360) / n) * (Math.PI / 180);
  const pt = (i: number, r: number): [number, number] => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const ring = (f: number) => cats.map((_, i) => pt(i, R * f).join(",")).join(" ");
  const dataPts = cats.map((c, i) => pt(i, R * (Math.max(0, Math.min(100, values[c.key] ?? 0)) / 100)));
  const dataPath = dataPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + " Z";
  const pad = size * 0.22;

  return (
    <svg
      viewBox={`${-pad} ${-pad * 0.5} ${size + pad * 2} ${size + pad}`}
      className="h-auto w-full max-w-[460px]"
      role="img"
      aria-label="Radar de skills"
    >
      {/* grid rings */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <polygon key={i} points={ring(f)} fill="none" stroke="var(--color-border)" strokeWidth={1} />
      ))}
      {/* axes */}
      {cats.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-border)" strokeWidth={1} />;
      })}
      {/* data polygon */}
      <path d={dataPath} fill={accent} fillOpacity={0.22} stroke={accent} strokeWidth={2} strokeLinejoin="round" />
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill={accent} />
      ))}
      {/* labels */}
      {cats.map((c, i) => {
        const [x, y] = pt(i, R + size * 0.05);
        const cos = Math.cos(angle(i));
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const v = values[c.key];
        return (
          <text
            key={c.key}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{ fill: "var(--color-foreground-muted)", fontSize: size * 0.032 }}
          >
            {c.label}
            {typeof v === "number" ? ` · ${v}` : ""}
          </text>
        );
      })}
    </svg>
  );
}
