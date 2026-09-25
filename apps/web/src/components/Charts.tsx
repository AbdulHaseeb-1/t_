import { useMemo, useState } from 'react';
import { useWidth } from '../lib/hooks';
import { ms, pct, usd } from '../lib/stats';
import { seriesColor } from './ui';

export interface Point {
  key: string;
  name: string;
  color: number;
  accuracy: number;
  lo: number;
  hi: number;
  cost: number;
  p50: number;
  p95: number;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * e) return m * e;
  return 10 * e;
};

/**
 * Accuracy against cost per question (log scale): the models worth choosing
 * lie on the dashed frontier; whiskers are 95% confidence intervals.
 */
export function AccuracyCostChart({ points, frontier }: { points: Point[]; frontier: string[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string>();
  const H = 300;
  const m = { top: 14, right: 16, bottom: 46, left: 46 };
  const priced = useMemo(() => points.filter((p) => p.cost > 0), [points]);

  const scale = useMemo(() => {
    if (!priced.length) return undefined;
    const costs = priced.map((p) => p.cost);
    let lo = Math.min(...costs) / 2;
    let hi = Math.max(...costs) * 2;
    if (hi / lo < 10) {
      const mid = Math.sqrt(lo * hi);
      lo = mid / Math.sqrt(10);
      hi = mid * Math.sqrt(10);
    }
    const yMin = Math.max(0, Math.floor(Math.min(...points.map((p) => p.lo)) * 10) / 10);
    const plotW = Math.max(10, width - m.left - m.right);
    const plotH = H - m.top - m.bottom;
    const x = (c: number) => m.left + ((Math.log10(c) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotW;
    const y = (a: number) => m.top + plotH - ((a - yMin) / (1 - yMin || 1)) * plotH;
    const xTicks: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const k of [1, 2, 5]) {
        const v = k * 10 ** e;
        if (v >= lo && v <= hi) xTicks.push(v);
      }
    }
    const ticks = xTicks.length > 7 ? xTicks.filter((v) => v.toExponential().startsWith('1')) : xTicks;
    const step = 1 - yMin > 0.5 ? 0.2 : 0.1;
    const yTicks: number[] = [];
    for (let v = yMin; v <= 1.0001; v += step) yTicks.push(Math.round(v * 100) / 100);
    return { x, y, xTicks: ticks, yTicks, plotW, plotH };
  }, [priced, points, width, m.left, m.right, m.top, m.bottom]);

  if (!priced.length) {
    return <div className="empty small">No cost data yet (costs appear once models with known prices finish cases).</div>;
  }

  // Direct labels: to the right of each point (flipped left near the edge), nudged apart vertically.
  const placed: { x: number; y: number }[] = [];
  const labels = scale
    ? priced
        .map((p) => ({ p, x: scale.x(p.cost), y: scale.y(p.accuracy) }))
        .sort((a, b) => a.y - b.y)
        .map((l) => {
          let ly = l.y;
          while (placed.some((o) => Math.abs(o.x - l.x) < 130 && Math.abs(o.y - ly) < 14)) ly += 14;
          placed.push({ x: l.x, y: ly });
          return { ...l, ly };
        })
    : [];

  const unpricedNames = points.filter((p) => p.cost <= 0).map((p) => p.name);
  const hovered = priced.find((p) => p.key === hover);
  const front = scale
    ? frontier
        .map((k) => priced.find((p) => p.key === k))
        .filter((p): p is Point => !!p)
        .map((p) => `${scale.x(p.cost)},${scale.y(p.accuracy)}`)
    : [];

  return (
    <div className="chart" ref={ref}>
      {scale && width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Accuracy versus cost per question for each model">
          {scale.yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={m.left} x2={width - m.right} y1={scale.y(v)} y2={scale.y(v)} stroke="var(--grid)" />
              <text x={m.left - 8} y={scale.y(v) + 4} textAnchor="end">
                {pct(v, 0)}
              </text>
            </g>
          ))}
          {scale.xTicks.map((v) => (
            <text key={`x${v}`} x={scale.x(v)} y={H - m.bottom + 18} textAnchor="middle">
              {usd(v)}
            </text>
          ))}
          <text x={m.left + scale.plotW / 2} y={H - 8} textAnchor="middle">
            Cost per question (log scale) →
          </text>
          {front.length > 1 && <polyline points={front.join(' ')} fill="none" stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="4 4" />}
          {priced.map((p) => (
            <g key={p.key} opacity={hover && hover !== p.key ? 0.35 : 1}>
              <line x1={scale.x(p.cost)} x2={scale.x(p.cost)} y1={scale.y(p.lo)} y2={scale.y(p.hi)} stroke={seriesColor(p.color)} strokeWidth={2} strokeLinecap="round" opacity={0.55} />
              <circle cx={scale.x(p.cost)} cy={scale.y(p.accuracy)} r={6} fill={seriesColor(p.color)} stroke="var(--surface)" strokeWidth={2}>
                <title>{`${p.name}: ${pct(p.accuracy)} (95% CI ${pct(p.lo)}–${pct(p.hi)}), ${usd(p.cost)} per question`}</title>
              </circle>
            </g>
          ))}
          {labels.map(({ p, x, ly }) => {
            const right = x + 150 < width;
            return (
              <text key={`l${p.key}`} x={right ? x + 10 : x - 10} y={ly + 4} textAnchor={right ? 'start' : 'end'} className="label-strong">
                {p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name}
              </text>
            );
          })}
          {priced.map((p) => (
            <circle
              key={`hit${p.key}`}
              cx={scale.x(p.cost)}
              cy={scale.y(p.accuracy)}
              r={16}
              fill="transparent"
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(undefined)}
            />
          ))}
        </svg>
      )}
      {hovered && scale && (
        <div className="tooltip" style={{ left: scale.x(hovered.cost), top: scale.y(hovered.accuracy) }}>
          <div className="row" style={{ fontWeight: 650 }}>
            <span className="swatch" style={{ background: seriesColor(hovered.color) }} />
            {hovered.name}
          </div>
          <div className="kv" style={{ marginTop: 4 }}>
            <span>
              Accuracy <b className="num">{pct(hovered.accuracy)}</b>
            </span>
            <span>
              95% CI <b className="num">{pct(hovered.lo, 0)}–{pct(hovered.hi, 0)}</b>
            </span>
            <span>
              Cost <b className="num">{usd(hovered.cost)}</b>/question
            </span>
            <span>
              Median <b className="num">{ms(hovered.p50)}</b>
            </span>
          </div>
          {frontier.includes(hovered.key) && <div className="hint" style={{ marginTop: 4 }}>On the frontier: nothing cheaper is as accurate.</div>}
        </div>
      )}
      {unpricedNames.length > 0 && <p className="hint" style={{ margin: '6px 0 0' }}>Not plotted (no known price): {unpricedNames.join(', ')}.</p>}
    </div>
  );
}

/** Median and 95th-percentile answer time per model: the dot is typical, the ring is a slow day. */
export function LatencyChart({ points }: { points: Point[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const row = 34;
  const m = { top: 8, right: 70, bottom: 30, left: 12 };
  const labelW = Math.min(170, Math.max(90, width * 0.32));
  // ~6.6px per character at 11.5px semibold.
  const maxChars = Math.max(6, Math.floor((labelW - 14) / 6.6));
  const H = points.length * row + m.top + m.bottom;
  const max = niceMax(Math.max(1, ...points.map((p) => p.p95)));
  const plotW = Math.max(10, width - m.left - labelW - m.right);
  const x = (v: number) => m.left + labelW + (v / max) * plotW;
  const ticks = [0, max / 2, max];

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Median and 95th percentile time per model">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={m.top} y2={H - m.bottom} stroke="var(--grid)" />
              <text x={x(t)} y={H - m.bottom + 18} textAnchor="middle">
                {ms(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cy = m.top + i * row + row / 2;
            return (
              <g key={p.key}>
                <text x={m.left + labelW - 10} y={cy + 4} textAnchor="end" className="label-strong">
                  {p.name.length > maxChars ? `${p.name.slice(0, maxChars - 1)}…` : p.name}
                  <title>{p.name}</title>
                </text>
                <line x1={x(p.p50)} x2={x(p.p95)} y1={cy} y2={cy} stroke={seriesColor(p.color)} strokeWidth={2} opacity={0.6} />
                <circle cx={x(p.p50)} cy={cy} r={5} fill={seriesColor(p.color)} stroke="var(--surface)" strokeWidth={2}>
                  <title>{`${p.name}: median ${ms(p.p50)}, p95 ${ms(p.p95)}`}</title>
                </circle>
                <circle cx={x(p.p95)} cy={cy} r={4.5} fill="var(--surface)" stroke={seriesColor(p.color)} strokeWidth={2} />
                <text x={x(p.p95) + 10} y={cy + 4}>
                  {ms(p.p50)} · {ms(p.p95)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="legend" style={{ marginTop: 4 }}>
        <span className="row small muted">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="var(--muted)" />
          </svg>
          median
        </span>
        <span className="row small muted">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4" fill="none" stroke="var(--muted)" strokeWidth="2" />
          </svg>
          95th percentile
        </span>
      </div>
    </div>
  );
}
