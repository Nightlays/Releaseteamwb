import React, { useRef, useEffect } from 'react';
import { Chart, DoughnutController, ArcElement, Tooltip } from 'chart.js';

Chart.register(DoughnutController, ArcElement, Tooltip);

interface DonutProps {
  value:   number;   // 0–100
  size?:   number;   // px
  color?:  string;
  label?:  string;
  thickness?: number; // cutout %
}

export function DonutChart({ value, size = 100, color = '#9B5CFF', label, thickness = 72 }: DonutProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const pct = Math.max(0, Math.min(100, Math.round(value)));

  const fillColor =
    pct >= 90 ? '#22C55E' :
    pct >= 70 ? color :
    pct >= 50 ? '#F59E0B' : '#EF4444';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    chartRef.current?.destroy();

    chartRef.current = new Chart(canvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [pct, 100 - pct],
          backgroundColor: [fillColor, getComputedStyle(document.documentElement).getPropertyValue('--chart-track').trim() || 'var(--surface-soft-4)'],
          borderColor:     [fillColor + '66', 'transparent'],
          borderWidth:     1,
          // @ts-expect-error custom prop
          __pct: pct,
        }],
      },
      options: {
        cutout:       `${thickness}%`,
        responsive:   false,
        animation:    { duration: 800, easing: 'easeInOutQuart' },
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [{
        id: 'centerText',
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top  + chartArea.bottom) / 2;
          ctx.save();
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle    = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || 'var(--text)';
          ctx.font         = `700 ${Math.round(size * 0.18)}px Inter, system-ui`;
          ctx.fillText(pct + '%', cx, cy);
          ctx.restore();
        },
      }],
    });

    return () => { chartRef.current?.destroy(); };
  }, [pct, fillColor, size, thickness]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <canvas ref={ref} width={size} height={size} style={{ display: 'block' }} />
      {label && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textAlign: 'center', maxWidth: size + 16 }}>{label}</span>}
    </div>
  );
}

/* ─── GAUGE (полукруг) ────────────────────────────────────── */
interface GaugeProps { value: number; size?: number; }
export function GaugeChart({ value, size = 140 }: GaugeProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color = pct <= 30 ? '#22C55E' : pct <= 60 ? '#F59E0B' : '#EF4444';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [pct, 100 - pct],
          backgroundColor: [color, getComputedStyle(document.documentElement).getPropertyValue('--chart-track').trim() || 'var(--surface-soft-4)'],
          borderColor:     ['transparent', 'transparent'],
          borderWidth:     0,
        }],
      },
      options: {
        cutout:      '78%',
        rotation:    -90,
        circumference: 180,
        responsive:  false,
        animation:   { duration: 1000 },
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [{
        id: 'gaugePct',
        afterDraw(chart) {
          const { ctx, chartArea } = chart;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top  + chartArea.bottom) / 2 + (chartArea.bottom - chartArea.top) * 0.15;
          ctx.save();
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle    = color;
          ctx.font         = `800 ${Math.round(size * 0.2)}px Inter, system-ui`;
          ctx.fillText(pct + '%', cx, cy);
          ctx.restore();
        },
      }],
    });
    return () => { chartRef.current?.destroy(); };
  }, [pct, color, size]);

  return <canvas ref={ref} width={size} height={Math.round(size * 0.56)} style={{ display: 'block' }} />;
}
