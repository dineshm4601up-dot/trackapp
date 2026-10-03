"use client";

import { useState } from "react";

export type ColumnSeries = { key: string; label: string; color: string };
export type ColumnDatum = { label: string; title: string; values: Record<string, number> };

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 34 };
const GAP = 2; // surface gap between stacked segments

function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => value <= s * magnitude) ?? 10;
  return step * magnitude;
}

/**
 * Stacked columns over time (one axis, counts). Each column is focusable and
 * shows a readout of every series on hover or focus; the legend is always
 * present, and the same numbers are available as a table below the chart.
 */
export function StackedColumns({ data, series, label }: { data: ColumnDatum[]; series: ColumnSeries[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const width = Math.max(720, data.length * 22 + PAD.left + PAD.right);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(4, band - 6)); // capped: leftover band width stays empty
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 8);
  const current = active === null ? null : data[active];

  return (
    <figure className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={`${label}: legend`}>
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          preserveAspectRatio="xMinYMid meet"
          role="group"
          aria-label={label}
          className="min-w-full"
          style={{ minWidth: Math.min(width, 640) }}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            let stacked = 0;
            const segments = series.flatMap((s) => {
              const value = d.values[s.key] ?? 0;
              if (!value) return [];
              const top = y(stacked + value);
              const bottom = y(stacked);
              stacked += value;
              return [{ key: s.key, color: s.color, top, height: Math.max(1, bottom - top - GAP) }];
            });
            const summary = series.map((s) => `${s.label} ${d.values[s.key] ?? 0}`).join(", ");
            return (
              <g
                key={d.label + i}
                tabIndex={0}
                role="img"
                aria-label={`${d.title}: ${summary}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none"
              >
                {/* hit area wider than the mark */}
                <rect x={PAD.left + i * band} y={PAD.top} width={band} height={plotH} fill={active === i ? "var(--viz-grid)" : "transparent"} opacity={0.5} />
                {segments.map((seg, index) => (
                  <rect
                    key={seg.key}
                    x={x}
                    y={seg.top}
                    width={barW}
                    height={seg.height}
                    fill={seg.color}
                    rx={index === segments.length - 1 ? 3 : 0}
                  />
                ))}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--viz-grid)" strokeWidth={1} />
        </svg>
        {current && (
          <div role="status" className="pointer-events-none absolute top-0 right-0 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
            <p className="font-medium">{current.title}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-0.5 w-3" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums">{current.values[s.key] ?? 0}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-medium">
                  Period
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-2 py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.label + i} className="border-t">
                  <th scope="row" className="px-2 py-1 text-left font-normal">
                    {d.title}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right tabular-nums">
                      {d.values[s.key] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
