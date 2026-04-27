import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardHint,
  CardTitle,
  EmptyState,
  FieldLabel,
  Input,
  LogView,
  Progress,
  SegmentControl,
  Table,
  Th,
  Td,
} from '../../components/ui';
import { useSettings } from '../../context/SettingsContext';
import { checkProxy } from '../../services/proxy';
import {
  collectChpRange,
  compareChpComposition,
  getChpTableStyles,
  uploadChpToGoogleDrive,
  type ChpCompositionResult,
  type ChpGitlabEntry,
  type ChpReleaseTotalRow,
  type ChpRunResult,
} from '../../services/chp';

const STORAGE_KEYS = ['chp_turtles_v1_0_3', 'chp_turtles_v1_0_2'];
const STORAGE_KEY_WRITE = STORAGE_KEYS[0];
const DEFAULT_START_RELEASE = '7.3.3000';
const DEFAULT_END_RELEASE = '7.3.4000';

type StatusTone = 'neutral' | 'ok' | 'warn' | 'error';
type BusyAction = 'collect' | 'composition' | 'upload' | null;
type LogLevel = 'info' | 'ok' | 'warn' | 'error';
type PlatformView = 'android' | 'ios';

interface StoredState {
  startRel?: string;
  endRel?: string;
  gitlabToken?: string;
  dlToken?: string;
  ytToken?: string;
  driveUrl?: string;
  savedAt?: number;
}

interface StreamOverviewRow {
  stream: string;
  android: number;
  ios: number;
  total: number;
  substreamCount: number;
  topSubstream: string;
}

function splitStreamKey(rowKey: string) {
  const parts = String(rowKey || '').split(' | ');
  const stream = String(parts.shift() || '').trim() || 'Без стрима';
  const substream = parts.join(' | ').trim() || '—';
  return { stream, substream };
}

function sumReleaseCounts(values: Record<string, number> | undefined) {
  return Object.values(values || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function addStreamCounts(
  bucket: Map<string, { stream: string; android: number; ios: number; substreams: Map<string, number> }>,
  counts: Record<string, Record<string, number>>,
  platform: PlatformView
) {
  Object.entries(counts || {}).forEach(([rowKey, releaseCounts]) => {
    const total = sumReleaseCounts(releaseCounts);
    if (total <= 0) return;
    const { stream, substream } = splitStreamKey(rowKey);
    if (!bucket.has(stream)) {
      bucket.set(stream, { stream, android: 0, ios: 0, substreams: new Map() });
    }
    const row = bucket.get(stream)!;
    row[platform] += total;
    if (substream && substream !== '—') {
      row.substreams.set(substream, (row.substreams.get(substream) || 0) + total);
    }
  });
}

function buildStreamOverviewRows(result: ChpRunResult): StreamOverviewRow[] {
  const bucket = new Map<string, { stream: string; android: number; ios: number; substreams: Map<string, number> }>();
  addStreamCounts(bucket, result.android.counts, 'android');
  addStreamCounts(bucket, result.ios.counts, 'ios');

  return Array.from(bucket.values())
    .map(row => {
      const top = Array.from(row.substreams.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))[0];
      return {
        stream: row.stream,
        android: row.android,
        ios: row.ios,
        total: row.android + row.ios,
        substreamCount: row.substreams.size,
        topSubstream: top ? `${top[0]} (${top[1]})` : '—',
      };
    })
    .sort((left, right) => right.total - left.total || left.stream.localeCompare(right.stream, 'ru'));
}

function readStoredState(): StoredState {
  try {
    for (const key of STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredState | null;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeStoredState(patch: Partial<StoredState>) {
  try {
    const current = readStoredState();
    localStorage.setItem(STORAGE_KEY_WRITE, JSON.stringify({
      ...current,
      ...patch,
      savedAt: Date.now(),
    }));
  } catch {
    /* ignore */
  }
}

function formatTimeStamp() {
  return new Date().toLocaleTimeString('ru-RU');
}

function issueHref(base: string, key: string) {
  return `${String(base || 'https://youtrack.wildberries.ru').replace('youtrack.wb.ru', 'youtrack.wildberries.ru').replace(/\/+$/, '')}/issue/${encodeURIComponent(key)}`;
}

function formatDateTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function severityBadgeColor(severity: ChpReleaseTotalRow['severity']) {
  if (severity === 'high') return 'red';
  if (severity === 'medium') return 'yellow';
  return 'green';
}

function progressColor(tone: StatusTone) {
  if (tone === 'ok') return 'green';
  if (tone === 'warn') return 'yellow';
  if (tone === 'error') return 'red';
  return 'accent';
}

function MetricCard({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  valueColor?: string;
}) {
  return (
    <Card>
      <CardBody>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>{label}</div>
        <div style={{ marginTop: 6, fontSize: 26, fontWeight: 700, color: valueColor || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>{hint}</div>
      </CardBody>
    </Card>
  );
}

function TotalsTable({ rows }: { rows: ChpReleaseTotalRow[] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Сводка по релизам</CardTitle>
          <CardHint>Итоговые черепики по Android и iOS с дельтой между релизами.</CardHint>
        </div>
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>Релиз</Th>
            <Th>Android</Th>
            <Th>iOS</Th>
            <Th>Итого</Th>
            <Th>Δ</Th>
            <Th>Оценка</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.release}>
              <Td mono bold>{row.release}</Td>
              <Td>{row.android}</Td>
              <Td>{row.ios}</Td>
              <Td bold>{row.total}</Td>
              <Td style={{ color: row.delta > 0 ? '#F87171' : row.delta < 0 ? '#4ADE80' : 'var(--text-3)' }}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </Td>
              <Td>
                <Badge color={severityBadgeColor(row.severity)}>
                  {row.severity === 'high' ? 'Высокий' : row.severity === 'medium' ? 'Средний' : 'Низкий'}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PlatformTableCard({
  title,
  html,
  count,
}: {
  title: string;
  html: string;
  count: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardHint>Разбивка по стримам и substream с месячными и квартальными итогами.</CardHint>
        </div>
        <Badge color={count > 0 ? 'purple' : 'gray'}>{count}</Badge>
      </CardHeader>
      <CardBody style={{ paddingTop: 10 }}>
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <EmptyState text={`Нет данных для ${title}.`} />
        )}
      </CardBody>
    </Card>
  );
}

function StreamOverviewCard({ rows }: { rows: StreamOverviewRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const androidTotal = rows.reduce((sum, row) => sum + row.android, 0);
  const iosTotal = rows.reduce((sum, row) => sum + row.ios, 0);
  const top = rows[0] || null;
  const statBox = (label: string, value: React.ReactNode, hint: string, color?: string) => (
    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4 }}>{hint}</div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Просмотр по стримам</CardTitle>
          <CardHint>Сводка принесенных ЧП по Android и iOS за выбранный диапазон.</CardHint>
        </div>
        <Badge color={rows.length ? 'purple' : 'gray'}>{rows.length} стримов</Badge>
      </CardHeader>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {statBox('Всего ЧП', total, 'Сумма Android и iOS по всем стримам.')}
          {statBox('Android', androidTotal, 'Все принесенные ЧП Android.')}
          {statBox('iOS', iosTotal, 'Все принесенные ЧП iOS.')}
          {statBox('Лидер', top ? top.stream : '—', top ? `${top.total} ЧП в диапазоне.` : 'Нет данных по стримам.', top && top.total >= 10 ? '#FCD34D' : undefined)}
        </div>

        {rows.length ? (
          <Table style={{ border: '1px solid var(--border)', borderRadius: 14 }}>
            <thead>
              <tr>
                <Th>Стрим</Th>
                <Th>Android</Th>
                <Th>iOS</Th>
                <Th>Итого</Th>
                <Th>Сабстримов</Th>
                <Th>Топ сабстрим</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.stream}>
                  <Td bold>{row.stream}</Td>
                  <Td>{row.android}</Td>
                  <Td>{row.ios}</Td>
                  <Td bold>{row.total}</Td>
                  <Td>{row.substreamCount || '—'}</Td>
                  <Td>{row.topSubstream}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState text="После сбора здесь появится количество ЧП по каждому стриму." />
        )}
      </CardBody>
    </Card>
  );
}

function GitlabEntryView({ entry }: { entry: ChpGitlabEntry }) {
  return (
    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55 }}>
        <a href={entry.webUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
          !{entry.iid ?? '—'} {entry.title || 'MR без названия'}
        </a>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        {entry.platform} · {entry.sourceBranch || '—'} → {entry.targetBranch || '—'}
      </div>
      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-3)' }}>
        {formatDateTime(entry.mergedAt)} · {entry.mergedBy || 'merge user не найден'}
      </div>
    </div>
  );
}

function CompositionPanel({
  composition,
  busy,
  errorMessage,
  ytBase,
  readyToRun,
  onRun,
  disabled,
}: {
  composition: ChpCompositionResult | null;
  busy?: boolean;
  errorMessage?: string | null;
  ytBase: string;
  readyToRun?: boolean;
  onRun?: () => void;
  disabled?: boolean;
}) {
  if (busy) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Проверка состава ЧП</CardTitle>
            <CardHint>Сверяю последний релиз диапазона между DeployLab и merged MR релизной ветки.</CardHint>
          </div>
          <Badge color="purple">Проверка...</Badge>
        </CardHeader>
        <CardBody>
          <EmptyState text="Идёт проверка состава. Результат появится здесь." />
        </CardBody>
      </Card>
    );
  }

  if (errorMessage) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Проверка состава ЧП</CardTitle>
            <CardHint>Сверка последнего релиза в диапазоне между DeployLab и merged MR релизной ветки.</CardHint>
          </div>
          <Badge color="red">Ошибка</Badge>
        </CardHeader>
        <CardBody>
          <div style={{ fontSize: 13, color: '#F87171', lineHeight: 1.6 }}>{errorMessage}</div>
          {readyToRun && (
            <div style={{ marginTop: 14 }}>
              <Button variant="secondary" size="sm" onClick={onRun} disabled={disabled}>
                Повторить проверку
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  if (!composition) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Проверка состава ЧП</CardTitle>
            <CardHint>Сверка последнего релиза в диапазоне между DeployLab и merged MR релизной ветки.</CardHint>
          </div>
          <Badge color={readyToRun ? 'yellow' : 'gray'}>{readyToRun ? 'Готова к запуску' : 'Нет данных'}</Badge>
        </CardHeader>
        <CardBody>
          <EmptyState text={readyToRun ? 'Диапазон уже собран. Запусти проверку состава по последнему релизу.' : 'Сначала собери диапазон релизов, затем запусти проверку состава.'} />
          {readyToRun && (
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
              <Button variant="secondary" size="sm" onClick={onRun} disabled={disabled}>
                Проверить состав ЧП
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  const titleColor = composition.hasDiff ? 'yellow' : 'green';

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Проверка состава ЧП</CardTitle>
          <CardHint>Релиз {composition.releaseLabel} · ветка {composition.branch}</CardHint>
        </div>
        <Badge color={titleColor}>{composition.hasDiff ? 'Есть расхождения' : 'Состав совпал'}</Badge>
      </CardHeader>
      <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <MetricCard label="Ветка" value={<span style={{ fontSize: 18, fontFamily: 'var(--mono)' }}>{composition.branch}</span>} hint="Проверка по последнему релизу диапазона." />
          <MetricCard label="GitLab keys" value={composition.gitlabUniqueCount} hint="Уникальные ANDR-/IOS-ключи в merged MR." />
          <MetricCard label="DeployLab keys" value={composition.deployUniqueCount} hint="Уникальные ключи из merged_after_cutoff." />
          <MetricCard label="Совпало" value={composition.matchedCount} hint="Пересечение GitLab и DeployLab." valueColor={composition.hasDiff ? '#FCD34D' : '#4ADE80'} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={onRun} disabled={disabled}>
            Перезапустить проверку
          </Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <Card style={{ borderColor: composition.gitlabOnly.length ? 'rgba(239,68,68,.24)' : 'rgba(34,197,94,.24)' }}>
            <CardHeader>
              <div>
                <CardTitle>Есть в GitLab, но нет в DeployLab</CardTitle>
                <CardHint>Дополнительные задачи в релизной ветке.</CardHint>
              </div>
              <Badge color={composition.gitlabOnly.length ? 'red' : 'green'}>{composition.gitlabOnly.length}</Badge>
            </CardHeader>
            <CardBody style={{ paddingTop: 10, maxHeight: 360, overflowY: 'auto' }}>
              {!composition.gitlabOnly.length && <EmptyState text="Дополнительных MR вне DeployLab не найдено." />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {composition.gitlabOnly.map(item => (
                  <div key={item.key} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', background: 'var(--surface-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <a href={issueHref(ytBase, item.key)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 800, textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 13 }}>
                        {item.key}
                      </a>
                      <Badge color={item.reason ? 'yellow' : 'gray'}>{item.entries.length} MR</Badge>
                    </div>
                    {item.reason && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                        Причина: {item.reason}
                      </div>
                    )}
                    {item.entries.map(entry => (
                      <GitlabEntryView key={`${item.key}:${entry.fullPath}:${entry.iid}:${entry.webUrl}`} entry={entry} />
                    ))}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card style={{ borderColor: composition.deployOnly.length ? 'rgba(245,158,11,.24)' : 'rgba(34,197,94,.24)' }}>
            <CardHeader>
              <div>
                <CardTitle>Есть в DeployLab, но не найдены в GitLab</CardTitle>
                <CardHint>Ключи из deploy состава без merged MR релизной ветки.</CardHint>
              </div>
              <Badge color={composition.deployOnly.length ? 'yellow' : 'green'}>{composition.deployOnly.length}</Badge>
            </CardHeader>
            <CardBody style={{ paddingTop: 10, maxHeight: 360, overflowY: 'auto' }}>
              {!composition.deployOnly.length && <EmptyState text="Все ключи из DeployLab найдены в GitLab." />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {composition.deployOnly.map(item => (
                  <div key={item.key} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', background: 'var(--surface-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <a href={issueHref(ytBase, item.key)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 800, textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 13 }}>
                        {item.key}
                      </a>
                      <Badge color="yellow">{item.platforms.join(', ') || '—'}</Badge>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
                      Релизы: {item.releases.join(', ') || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>MR без ANDR-/IOS-ключа</CardTitle>
                <CardHint>MR релизной ветки, которые нельзя автоматически связать с задачей.</CardHint>
              </div>
              <Badge color={composition.withoutKeys.length ? 'gray' : 'green'}>{composition.withoutKeys.length}</Badge>
            </CardHeader>
            <CardBody style={{ paddingTop: 10, maxHeight: 360, overflowY: 'auto' }}>
              {!composition.withoutKeys.length && <EmptyState text="Все MR удалось привязать к ключам." />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {composition.withoutKeys.map(entry => (
                  <div key={`${entry.fullPath}:${entry.iid}:${entry.webUrl}`} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', background: 'var(--surface-soft)' }}>
                    <GitlabEntryView entry={entry} />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </CardBody>
    </Card>
  );
}

export function ChpCollect() {
  const { settings, save } = useSettings();
  const stored = useMemo(readStoredState, []);
  const [startRelease, setStartRelease] = useState(String(stored.startRel || '').trim() || DEFAULT_START_RELEASE);
  const [endRelease, setEndRelease] = useState(String(stored.endRel || '').trim() || DEFAULT_END_RELEASE);
  const [platformView, setPlatformView] = useState<PlatformView>('android');
  const [proxyState, setProxyState] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [status, setStatus] = useState('Заполни диапазон релизов и нажми «Запустить сбор».');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [progress, setProgress] = useState(0);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [logs, setLogs] = useState<Array<{ text: string; level: LogLevel }>>([]);
  const [runResult, setRunResult] = useState<ChpRunResult | null>(null);
  const [composition, setComposition] = useState<ChpCompositionResult | null>(null);
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState<string | null>(String(stored.driveUrl || '').trim() || null);
  const abortRef = useRef<AbortController | null>(null);
  const actionIdRef = useRef(0);
  const compositionRef = useRef<HTMLDivElement | null>(null);

  const log = useCallback((text: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev.slice(-399), { text: `[${formatTimeStamp()}] ${text}`, level }]);
  }, []);

  useEffect(() => {
    writeStoredState({ startRel: startRelease, endRel: endRelease });
  }, [startRelease, endRelease]);

  useEffect(() => {
    writeStoredState({ driveUrl: driveUrl || '' });
  }, [driveUrl]);

  useEffect(() => {
    const legacyToken = String(stored.gitlabToken || '').trim();
    if (!legacyToken || String(settings.gitlabToken || '').trim()) return;
    save({ gitlabToken: legacyToken });
  }, [save, settings.gitlabToken, stored.gitlabToken]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const latestRow = runResult?.totalsRows?.[runResult.totalsRows.length - 1] || null;
  const releaseCount = runResult?.releases.length || 0;
  const activePlatform = platformView === 'android' ? runResult?.android : runResult?.ios;
  const activePlatformCount = activePlatform ? Object.keys(activePlatform.counts || {}).length : 0;
  const streamOverviewRows = useMemo(() => (runResult ? buildStreamOverviewRows(runResult) : []), [runResult]);

  const busyLabel = useMemo(() => {
    if (busyAction === 'collect') return 'Сбор...';
    if (busyAction === 'composition') return 'Проверка...';
    if (busyAction === 'upload') return 'Выгрузка...';
    return '';
  }, [busyAction]);

  const compositionSummary = useMemo(() => {
    if (busyAction === 'composition') {
      return {
        color: 'purple' as const,
        title: 'Идёт проверка',
        text: 'Сверяю последний релиз диапазона между DeployLab и GitLab.',
      };
    }
    if (compositionError) {
      return {
        color: 'red' as const,
        title: 'Ошибка проверки',
        text: compositionError,
      };
    }
    if (composition) {
      return composition.hasDiff
        ? {
            color: 'yellow' as const,
            title: 'Есть расхождения',
            text: `GitLab-only ${composition.gitlabOnly.length}, Deploy-only ${composition.deployOnly.length}, без ключа ${composition.withoutKeys.length}.`,
          }
        : {
            color: 'green' as const,
            title: 'Состав совпал',
            text: `Совпало ${composition.matchedCount} ключей по ветке ${composition.branch}.`,
          };
    }
    return {
      color: 'gray' as const,
      title: 'Не запускалась',
      text: 'Проверка состава ещё не запускалась.',
    };
  }, [busyAction, composition, compositionError]);

  const docsSummary = useMemo(() => {
    if (busyAction === 'upload') {
      return {
        color: 'purple' as const,
        title: 'Идёт выгрузка',
        text: 'Создаю таблицу и отправляю totals в Google Docs.',
      };
    }
    if (driveUrl) {
      return {
        color: 'green' as const,
        title: 'Таблица готова',
        text: driveUrl,
      };
    }
    return {
      color: 'gray' as const,
      title: 'Нет выгрузки',
      text: 'После выгрузки здесь появится ссылка на созданную таблицу.',
    };
  }, [busyAction, driveUrl]);

  const createCfg = useCallback((signal?: AbortSignal) => ({
    proxyBase: settings.proxyBase,
    proxyMode: settings.proxyMode,
    useProxy: settings.useProxy,
    ytBase: settings.ytBase,
    ytToken: settings.ytToken,
    deployLabToken: settings.deployLabToken,
    signal,
  }), [settings.deployLabToken, settings.proxyBase, settings.proxyMode, settings.useProxy, settings.ytBase, settings.ytToken]);

  const beginAction = useCallback((action: Exclude<BusyAction, null>) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    const actionId = actionIdRef.current + 1;
    actionIdRef.current = actionId;
    abortRef.current = controller;
    setBusyAction(action);
    return { actionId, controller };
  }, []);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;
    actionIdRef.current += 1;
    abortRef.current = null;
    controller.abort();
    setBusyAction(null);
    setProgress(0);
    setStatus('Операция остановлена.');
    setStatusTone('warn');
    log('Операция остановлена вручную.', 'warn');
  }, [log]);

  const handleProxyCheck = useCallback(async () => {
    if (!String(settings.proxyBase || '').trim()) {
      setProxyState('error');
      setStatus('Proxy base не заполнен.');
      setStatusTone('error');
      log('Proxy base не заполнен.', 'error');
      return;
    }

    try {
      const ok = await checkProxy(settings.proxyBase);
      setProxyState(ok ? 'ok' : 'error');
      setStatus(ok ? 'Proxy доступен.' : 'Proxy не отвечает.');
      setStatusTone(ok ? 'ok' : 'error');
      log(ok ? `Proxy доступен: ${settings.proxyBase}` : `Proxy не отвечает: ${settings.proxyBase}`, ok ? 'ok' : 'error');
    } catch (error) {
      setProxyState('error');
      setStatus('Proxy не отвечает.');
      setStatusTone('error');
      log((error as Error)?.message || 'Proxy не отвечает.', 'error');
    }
  }, [log, settings.proxyBase]);

  const executeCompositionCheck = useCallback(async (
    targetRunResult: ChpRunResult,
    options?: { auto?: boolean }
  ) => {
    if (!targetRunResult) {
      setStatus('Сначала запусти сбор ЧП.');
      setStatusTone('error');
      return;
    }
    if (!String(settings.gitlabToken || '').trim()) {
      setStatus('Заполни GitLab token для проверки состава.');
      setStatusTone('error');
      return;
    }

    const { actionId, controller } = beginAction('composition');
    setComposition(null);
    setCompositionError(null);
    setProgress(0);
    setStatus(
      options?.auto
        ? `Сбор завершён. Автоматически проверяю состав ЧП для release/${targetRunResult.latestRelease}.`
        : `Проверяю состав ЧП для ветки release/${targetRunResult.latestRelease}.`
    );
    setStatusTone('neutral');
    log(
      options?.auto
        ? `Автопроверка состава для release/${targetRunResult.latestRelease}.`
        : `Старт проверки состава для release/${targetRunResult.latestRelease}.`
    );

    try {
      const result = await compareChpComposition(createCfg(controller.signal), settings.gitlabToken, targetRunResult, {
        onLog: log,
        onProgress: value => setProgress(value),
      });
      if (actionIdRef.current !== actionId) return;
      setComposition(result);
      setStatus(result.hasDiff ? 'Проверка состава завершена. Найдены расхождения.' : 'Проверка состава завершена. Расхождений нет.');
      setStatusTone(result.hasDiff ? 'warn' : 'ok');
      log(`Проверка состава: GitLab-only ${result.gitlabOnly.length}, Deploy-only ${result.deployOnly.length}, без ключа ${result.withoutKeys.length}.`, result.hasDiff ? 'warn' : 'ok');
      setProgress(100);
      requestAnimationFrame(() => compositionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (error) {
      if (actionIdRef.current !== actionId) return;
      if ((error as Error)?.name === 'AbortError') return;
      const message = (error as Error)?.message || 'Не удалось проверить состав ЧП.';
      setCompositionError(message);
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      log(message, 'error');
      requestAnimationFrame(() => compositionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } finally {
      if (actionIdRef.current !== actionId) return;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusyAction(null);
    }
  }, [beginAction, createCfg, log, settings.gitlabToken]);

  const runCollect = useCallback(async () => {
    if (!String(startRelease || '').trim() || !String(endRelease || '').trim()) {
      setStatus('Укажи начальный и конечный релиз.');
      setStatusTone('error');
      return;
    }
    if (!String(settings.deployLabToken || '').trim()) {
      setStatus('Заполни DeployLab token в настройках.');
      setStatusTone('error');
      return;
    }
    if (!String(settings.ytToken || '').trim()) {
      setStatus('Заполни YouTrack token в настройках.');
      setStatusTone('error');
      return;
    }

    const { actionId, controller } = beginAction('collect');
    setLogs([]);
    setRunResult(null);
    setComposition(null);
    setDriveUrl(null);
    setProgress(0);
    setStatus(`Собираю диапазон ${startRelease} → ${endRelease}.`);
    setStatusTone('neutral');
    log(`Старт сбора ЧП для диапазона ${startRelease} → ${endRelease}.`);

    try {
      const result = await collectChpRange(createCfg(controller.signal), startRelease, endRelease, {
        onLog: log,
        onProgress: value => setProgress(value),
      });

      if (actionIdRef.current !== actionId) return;
      setRunResult(result);
      setComposition(null);
      setCompositionError(null);
      setDriveUrl(null);
      setStatus(`Сбор завершён. Получено ${result.releases.length} релизов, последний ${result.latestRelease}.`);
      setStatusTone('ok');
      setProgress(100);
      log(`Сбор завершён: ${result.releases.length} релизов, последний ${result.latestRelease}.`, 'ok');

      if (String(settings.gitlabToken || '').trim()) {
        await executeCompositionCheck(result, { auto: true });
      } else {
        log('Автопроверка состава пропущена: не заполнен GitLab token.', 'warn');
      }
    } catch (error) {
      if (actionIdRef.current !== actionId) return;
      if ((error as Error)?.name === 'AbortError') return;
      const message = (error as Error)?.message || 'Не удалось собрать ЧП.';
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      log(message, 'error');
    } finally {
      if (actionIdRef.current !== actionId) return;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusyAction(null);
    }
  }, [beginAction, createCfg, endRelease, executeCompositionCheck, log, settings.deployLabToken, settings.gitlabToken, settings.ytToken, startRelease]);

  const runCompositionCheck = useCallback(async () => {
    if (!runResult) {
      setStatus('Сначала запусти сбор ЧП.');
      setStatusTone('error');
      return;
    }
    await executeCompositionCheck(runResult);
  }, [executeCompositionCheck, runResult]);

  const runUpload = useCallback(async () => {
    if (!runResult) {
      setStatus('Сначала собери диапазон релизов.');
      setStatusTone('error');
      return;
    }

    const { actionId, controller } = beginAction('upload');
    setProgress(0);
    setStatus('Выгружаю в Google Disk...');
    setStatusTone('neutral');
    log('Старт выгрузки в Google Disk.');

    try {
      const result = await uploadChpToGoogleDrive(createCfg(controller.signal), runResult.drivePayload, {
        onLog: log,
      });
      if (actionIdRef.current !== actionId) return;
      setDriveUrl(result.sheetUrl);
      setStatus('Выгружено в Google Docs.');
      setStatusTone('ok');
      setProgress(100);
      log(`Google Docs: ${result.sheetUrl}`, 'ok');
    } catch (error) {
      if (actionIdRef.current !== actionId) return;
      if ((error as Error)?.name === 'AbortError') return;
      const message = (error as Error)?.message || 'Не удалось выгрузить в Google Docs.';
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      log(message, 'error');
    } finally {
      if (actionIdRef.current !== actionId) return;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusyAction(null);
    }
  }, [beginAction, createCfg, log, runResult]);

  const openDrive = useCallback(() => {
    if (!driveUrl) {
      setStatus('Сначала выгрузи результат в Google Docs.');
      setStatusTone('warn');
      log('Google Docs: ссылка ещё не создана.', 'warn');
      return;
    }
    window.open(driveUrl, '_blank', 'noopener,noreferrer');
  }, [driveUrl, log]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!busyAction) void runCollect();
  }, [busyAction, runCollect]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{getChpTableStyles()}</style>

      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(155,92,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⚑</div>
        ЧП по стримам
      </div>

      <Card>
        <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <FieldLabel>Начальный релиз</FieldLabel>
              <Input value={startRelease} onChange={event => setStartRelease(event.target.value)} onKeyDown={handleKeyDown} placeholder="7.3.3000" />
            </div>
            <div>
              <FieldLabel>Конечный релиз</FieldLabel>
              <Input value={endRelease} onChange={event => setEndRelease(event.target.value)} onKeyDown={handleKeyDown} placeholder="7.3.4000" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {busyAction ? (
                <Button variant="danger" onClick={stop}>Остановить</Button>
              ) : (
                <Button variant="primary" onClick={() => void runCollect()}>Запустить сбор</Button>
              )}
              <Button variant="secondary" onClick={handleProxyCheck} disabled={Boolean(busyAction)}>Проверить proxy</Button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: statusTone === 'error' ? '#F87171' : statusTone === 'warn' ? '#FCD34D' : statusTone === 'ok' ? '#4ADE80' : 'var(--text-2)' }}>
                  {status}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{progress}%</div>
              </div>
              <Progress value={progress} color={progressColor(statusTone)} height={7} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Badge color={String(settings.deployLabToken || '').trim() ? 'green' : 'red'}>DeployLab {String(settings.deployLabToken || '').trim() ? 'ready' : 'missing'}</Badge>
              <Badge color={String(settings.ytToken || '').trim() ? 'green' : 'red'}>YT {String(settings.ytToken || '').trim() ? 'ready' : 'missing'}</Badge>
              <Badge color={String(settings.gitlabToken || '').trim() ? 'green' : 'gray'}>GitLab {String(settings.gitlabToken || '').trim() ? 'ready' : 'optional'}</Badge>
              <Badge color={settings.useProxy === false ? 'gray' : proxyState === 'ok' ? 'green' : proxyState === 'error' ? 'red' : 'gray'}>
                proxy {settings.useProxy === false ? 'off' : proxyState === 'ok' ? 'ok' : proxyState === 'error' ? 'down' : 'unknown'}
              </Badge>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            DeployLab, YouTrack и GitLab token берутся из общих настроек сервиса.
          </div>

          {logs.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>Логи</div>
              <LogView lines={logs} maxHeight={220} />
            </div>
          )}
        </CardBody>
      </Card>

      {runResult ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <MetricCard label="Диапазон" value={`${startRelease} → ${endRelease}`} hint="Фактически обработанный диапазон релизов." />
            <MetricCard label="Релизов" value={releaseCount} hint="Количество релизов, которые вошли в расчёт." />
            <MetricCard label="Последний релиз" value={runResult.latestRelease} hint="По нему строится проверка состава ЧП." />
            <MetricCard label="Черепики в хвосте" value={latestRow?.total ?? 0} hint="Итого по последнему релизу диапазона." valueColor={latestRow && latestRow.total >= 18 ? '#F87171' : latestRow && latestRow.total >= 10 ? '#FCD34D' : '#4ADE80'} />
          </div>

          <StreamOverviewCard rows={streamOverviewRows} />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Состав и Docs</CardTitle>
                <CardHint>Быстрые действия по последнему релизу диапазона и ссылка на итоговую таблицу.</CardHint>
              </div>
              <Badge color="purple">{runResult.latestRelease}</Badge>
            </CardHeader>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={() => void runCompositionCheck()} disabled={Boolean(busyAction) || !runResult}>
                  {busyAction === 'composition' ? busyLabel : 'Проверить состав ЧП'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void runUpload()} disabled={Boolean(busyAction) || !runResult}>
                  {busyAction === 'upload' ? busyLabel : 'Выгрузить в Google Docs'}
                </Button>
                <Button variant="ghost" size="sm" onClick={openDrive} disabled={!driveUrl}>Открыть Google Docs</Button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Проверка состава</div>
                    <Badge color={compositionSummary.color}>{compositionSummary.title}</Badge>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{compositionSummary.text}</div>
                </div>

                <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Google Docs</div>
                    <Badge color={docsSummary.color}>{docsSummary.title}</Badge>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, wordBreak: 'break-word' }}>
                    {driveUrl ? (
                      <a href={driveUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {docsSummary.text}
                      </a>
                    ) : (
                      docsSummary.text
                    )}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Итоги</CardTitle>
                <CardHint>Сводка по платформам и итоговая выгрузка по черепикам.</CardHint>
              </div>
            </CardHeader>
            <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <pre
                style={{
                  margin: 0,
                  padding: 14,
                  borderRadius: 14,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                  lineHeight: 1.55,
                  fontFamily: 'var(--mono)',
                }}
              >
                {runResult.totalsText}
              </pre>
            </CardBody>
          </Card>

          <TotalsTable rows={runResult.totalsRows} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Платформа</div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-2)' }}>Выбирай таблицу по вкладке, чтобы не держать iOS под Android.</div>
            </div>
            <SegmentControl
              items={[
                { label: 'Android', value: 'android' },
                { label: 'iOS', value: 'ios' },
              ]}
              value={platformView}
              onChange={value => setPlatformView(value as PlatformView)}
            />
          </div>

          <PlatformTableCard
            title={activePlatform?.title || (platformView === 'android' ? 'Android' : 'iOS')}
            html={activePlatform?.tableHtml || ''}
            count={activePlatformCount}
          />

          <div ref={compositionRef}>
            <CompositionPanel
              composition={composition}
              busy={busyAction === 'composition'}
              errorMessage={compositionError}
              ytBase={settings.ytBase}
              readyToRun={Boolean(runResult)}
              onRun={() => void runCompositionCheck()}
              disabled={Boolean(busyAction)}
            />
          </div>
        </>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Итоги</CardTitle>
              <CardHint>После запуска появятся totals, таблицы платформ и проверка состава.</CardHint>
            </div>
          </CardHeader>
          <CardBody>
            <EmptyState text="Диапазон ещё не собран." />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
