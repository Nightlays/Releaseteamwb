import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Chart, LineController, CategoryScale, LinearScale,
  PointElement, LineElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Card, CardHeader, CardTitle, CardHint, CardBody, Divider, Badge, Button, Input, FieldLabel, InfoRow, EmptyState } from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { fetchLaunches, mapLaunch } from '../../services/allure';
import { AllureLaunchResult } from '../../types';

Chart.register(LineController, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

function BurndownChart({ total, finished }: { total: number; finished: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || total === 0) return;
    chartRef.current?.destroy();

    const NOW_H = new Date().getHours();
    const START_H = Math.max(8, NOW_H - 4);
    const labels: string[] = [];
    for (let h = START_H; h <= START_H + 8; h++) labels.push(`${h}:00`);

    const finRate  = finished / Math.max(1, NOW_H - START_H);
    const factData: (number | null)[] = [];
    const foreData: (number | null)[] = [];
    const idealData: number[] = [];
    const idealStep = (total - (total - finished)) / (labels.length - 1);

    labels.forEach((_, i) => {
      const h = START_H + i;
      if (h <= NOW_H) {
        factData.push(Math.max(0, total - Math.round(finRate * (h - START_H))));
        foreData.push(null);
      } else {
        factData.push(null);
        foreData.push(Math.max(0, (total - finished) - Math.round(finRate * (h - NOW_H))));
      }
      idealData.push(Math.max(0, total - Math.round(idealStep * i)));
    });

    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Факт',    data: factData, borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,.08)', fill: true, tension: .35, pointRadius: 3, borderWidth: 2 },
          { label: 'Прогноз', data: foreData, borderColor: '#9B5CFF', borderDash: [5,4], fill: false, tension: .35, pointRadius: 2, borderWidth: 1.5 },
          { label: 'Идеал',   data: idealData, borderColor: 'var(--border-hi)', borderDash: [3,3], fill: false, tension: .1, pointRadius: 0, borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 8, padding: 12, color: 'var(--text-2)', font: { size: 11 } } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { grid: { color: 'var(--surface-soft-3)' }, ticks: { color: 'var(--text-3)', font: { size: 10 } } },
          y: { grid: { color: 'var(--surface-soft-3)' }, ticks: { color: 'var(--text-3)', font: { size: 10 }, callback: v => Number(v) >= 1000 ? (Number(v)/1000).toFixed(1)+'k' : v } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [total, finished]);

  return <canvas ref={ref} style={{ display: 'block', height: 220 }} />;
}

export function Vangovat() {
  const { settings } = useSettings();
  const [version, setVersion]   = useState('7.3.5420');
  const [launches, setLaunches] = useState<AllureLaunchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const DEMO: AllureLaunchResult[] = [
    { id:1, name:'CP Android', platform:'android', type:'high_blocker', total:1240, finished:1168, remaining:72, in_progress:5, pct:94, status:'RUNNING', createdDate:Date.now()-7200000, stream:'' },
    { id:2, name:'CP iOS',     platform:'ios',     type:'high_blocker', total:980,  finished:980,  remaining:0,  in_progress:0, pct:100,status:'DONE',    createdDate:Date.now()-7000000, stream:'' },
    { id:3, name:'Smoke And',  platform:'android', type:'smoke',        total:440,  finished:440,  remaining:0,  in_progress:0, pct:100,status:'DONE',    createdDate:Date.now()-7100000, stream:'' },
    { id:4, name:'NAPI Smoke', platform:'napi',    type:'smoke',        total:320,  finished:227,  remaining:93, in_progress:3, pct:71, status:'RUNNING',  createdDate:Date.now()-5400000, stream:'' },
  ];

  useEffect(() => { setLaunches(DEMO); }, []);

  const load = useCallback(async () => {
    if (!settings.allureToken) return;
    setLoading(true); setError('');
    try {
      const raw = await fetchLaunches({
        base: settings.allureBase,
        token: settings.allureToken,
        projectId: settings.projectId,
        proxyBase: settings.proxyBase,
        proxyMode: settings.proxyMode,
        useProxy: settings.useProxy,
      }, version);
      setLaunches(raw.map(mapLaunch));
    } catch(e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [settings, version]);

  const total      = launches.reduce((s, l) => s + l.total, 0);
  const finished   = launches.reduce((s, l) => s + l.finished, 0);
  const remaining  = launches.reduce((s, l) => s + l.remaining, 0);
  const failed     = launches.reduce((s, l) => s + (l.total - l.finished - l.remaining - l.in_progress), 0);
  const inProgress = launches.reduce((s, l) => s + l.in_progress, 0);
  const pct        = total > 0 ? Math.round((finished / total) * 100) : 0;

  // Speed est: cases/hour
  const hoursSinceStart = 4; // demo
  const speed = hoursSinceStart > 0 ? Math.round(finished / hoursSinceStart) : 0;
  const etaHours = speed > 0 ? (remaining / speed).toFixed(1) : '—';

  const etaTime = (() => {
    if (speed === 0) return '—';
    const ms = (remaining / speed) * 3600_000;
    const eta = new Date(Date.now() + ms);
    return eta.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◐</div>
        Ванговатор
      </div>

      {/* METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[
          { label: 'Прогноз завершения', value: etaTime,                 color: 'var(--text)', sub: `через ~${etaHours}ч` },
          { label: 'Скорость (кейс/ч)',  value: speed,                   color: '#9B5CFF', sub: 'выше среднего' },
          { label: 'Пройдено %',         value: pct + '%',               color: pct >= 90 ? '#22C55E' : '#F59E0B', sub: `${finished.toLocaleString('ru-RU')} кейсов` },
          { label: 'Провалено',          value: Math.max(0, failed),     color: failed > 20 ? '#EF4444' : 'var(--text-2)', sub: `${inProgress} в работе` },
        ].map(m => (
          <div key={m.label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: m.color, fontVariantNumeric: 'tabular-nums' }}>{m.value}</div>
            {m.sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      {/* PARAMS */}
      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div><FieldLabel>Версия</FieldLabel><Input value={version} onChange={e => setVersion(e.target.value)} style={{ width: 160 }} /></div>
            <div><FieldLabel>Allure Token</FieldLabel><Input defaultValue={settings.allureToken} type="password" style={{ width: 220 }} /></div>
            <Button variant="primary" onClick={load} disabled={loading}>{loading ? '...' : '⟳ Загрузить'}</Button>
          </div>
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
        {/* BURNDOWN */}
        <Card>
          <CardHeader><CardTitle>Прогнозный бёрндаун</CardTitle><CardHint>Факт · Прогноз · Идеал</CardHint></CardHeader>
          <div style={{ padding: '14px 16px 14px' }}><BurndownChart total={total} finished={finished} /></div>
        </Card>

        {/* DETAILS */}
        <Card>
          <CardHeader><CardTitle>Параметры прогона</CardTitle></CardHeader>
          <CardBody>
            <InfoRow label="Версия"       value={<span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{version}</span>} />
            <InfoRow label="Проект Allure" value={`${settings.projectId} (WB Mobile)`} />
            <InfoRow label="Всего кейсов" value={total.toLocaleString('ru-RU')} />
            <InfoRow label="Пройдено"     value={<span style={{ color: '#22C55E' }}>{finished.toLocaleString('ru-RU')} ({pct}%)</span>} />
            <InfoRow label="Провалено"    value={<span style={{ color: Math.max(0,failed) > 20 ? '#EF4444' : 'var(--text-2)' }}>{Math.max(0,failed)}</span>} />
            <InfoRow label="Остаток"      value={<span style={{ color: '#F59E0B' }}>{remaining.toLocaleString('ru-RU')}</span>} />
            <InfoRow label="В процессе"   value={inProgress.toLocaleString('ru-RU')} />
            <InfoRow label="Скорость"     value={`${speed} кейс/ч`} />
          </CardBody>
          <Divider />
          <CardBody style={{ paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>Прогнозы</div>
            {launches.filter(l => l.status === 'RUNNING').map(l => {
              const spd = l.total > 0 ? Math.round(l.finished / Math.max(1, hoursSinceStart)) : 0;
              const eta = spd > 0 ? new Date(Date.now() + (l.remaining / spd) * 3600_000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '—';
              return (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{l.name.slice(0, 28)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{eta}</span>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
