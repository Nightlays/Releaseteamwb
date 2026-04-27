import { proxyFetch, type ProxyMode } from './proxy';

export type CreateRunMode = '1' | '2' | '3' | '4' | '5' | '6';

export interface CreateRunConfig {
  base: string;
  token: string;
  signal?: AbortSignal;
  proxyBase?: string;
  proxyMode?: ProxyMode;
  useProxy?: boolean;
}

export interface CreateRunLaunch {
  id: number;
  name: string;
  url: string;
  testPlanId: number;
  tagIds: number[];
}

export interface CreateRunResult {
  mode: CreateRunMode;
  modeLabel: string;
  release: string;
  launches: CreateRunLaunch[];
  messageTitle: string;
  messageText: string;
  createdTagNames: string[];
  syncedTestPlanIds: number[];
}

const TAG_ANDROID = 4115;
const TAG_IOS = 1711;

const TP_CP_ANDROID = 1998;
const TP_CP_IOS = 3258;
const TP_NAPI_BASE = 1036;
const TP_NAPI_IOS = 1869;
const TP_NAPI_ANDROID = 1871;
const TP_SMOKE_RUSTORE = 999;
const TP_SMOKE_APPGALLERY = 1000;

const MODE_LABELS: Record<CreateRunMode, string> = {
  '1': 'ХФ Android',
  '2': 'ХФ iOS',
  '3': 'NAPI',
  '4': 'Воскресные раны устройств',
  '5': 'RuStore / AppGallery (Крит-путь)',
  '6': 'RuStore / AppGallery (Smoke)',
};

function buildHeaders(token: string, extra?: Record<string, string>) {
  const rawToken = String(token || '').trim();
  const authValue = /^Api-Token\s+/i.test(rawToken) || /^Bearer\s+/i.test(rawToken)
    ? rawToken
    : `Api-Token ${rawToken}`;

  return {
    Accept: 'application/json',
    Authorization: authValue,
    ...(extra || {}),
  };
}

function buildTargetUrl(base: string, path: string) {
  const root = String(base || '').trim().replace(/\/+$/, '');
  return `${root}/api${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchJson<T>(
  cfg: CreateRunConfig,
  path: string,
  init?: RequestInit
): Promise<T> {
  const targetUrl = buildTargetUrl(cfg.base, path);
  const headers = buildHeaders(
    cfg.token,
    (init?.headers as Record<string, string> | undefined) ?? undefined
  );
  const requestInit: RequestInit = {
    ...init,
    headers,
    signal: cfg.signal,
  };

  let response: Response;
  try {
    if (cfg.useProxy !== false && String(cfg.proxyBase || '').trim()) {
      response = await proxyFetch(
        {
          base: String(cfg.proxyBase).trim(),
          mode: cfg.proxyMode,
          signal: cfg.signal,
        },
        targetUrl,
        requestInit
      );
    } else {
      response = await fetch(targetUrl, requestInit);
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    const tip = cfg.useProxy !== false && String(cfg.proxyBase || '').trim()
      ? 'Проверь proxy: /proxy должен прокидывать запросы в Allure /api.'
      : 'Похоже на CORS или сетевую ошибку. Включи proxy в общих настройках.';
    throw new Error(`HTTP ошибка при запросе ${targetUrl}: ${(error as Error)?.message || error}. ${tip}`);
  }

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text.trim() ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const body = text.trim() || response.statusText;
    throw new Error(`Запрос ${path} вернул ${response.status}: ${body}`);
  }

  return json as T;
}

async function createTag(cfg: CreateRunConfig, name: string) {
  const data = await fetchJson<{ id?: number }>(cfg, '/launch/tag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const id = Number(data?.id || 0);
  if (!id) {
    throw new Error(`Не удалось создать тег '${name}'.`);
  }
  return id;
}

async function syncTestPlan(cfg: CreateRunConfig, testPlanId: number) {
  await fetchJson(cfg, `/testplan/${testPlanId}/sync`, {
    method: 'POST',
  });
}

async function runTestPlan(
  cfg: CreateRunConfig,
  testPlanId: number,
  launchName: string,
  tagIds: number[]
) {
  const data = await fetchJson<{ id?: number; name?: string }>(
    cfg,
    `/testplan/${testPlanId}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        launchName,
        tags: tagIds.map(id => ({ id })),
      }),
    }
  );

  const id = Number(data?.id || 0);
  if (!id) {
    throw new Error(`Тест-план ${testPlanId} запустился не как ожидалось.`);
  }

  return {
    id,
    name: String(data?.name || launchName),
    url: `${String(cfg.base || '').trim().replace(/\/+$/, '')}/launch/${id}`,
    testPlanId,
    tagIds: [...tagIds],
  } satisfies CreateRunLaunch;
}

function buildMessage(title: string, launches: CreateRunLaunch[]) {
  const lines = [title, 'Сборка:', ...launches.map(launch => `${launch.name} — ${launch.url}`)];
  return lines.join('\n');
}

function totalOperations(mode: CreateRunMode) {
  switch (mode) {
    case '1':
    case '2':
      return 2;
    case '3':
      return 8;
    case '4':
      return 5;
    case '5':
    case '6':
      return 5;
    default:
      return 1;
  }
}

export async function executeCreateRunScenario(
  cfg: CreateRunConfig,
  mode: CreateRunMode,
  release: string,
  options?: {
    onLog?: (text: string, level?: 'info' | 'ok' | 'warn' | 'error') => void;
    onProgress?: (value: number) => void;
  }
): Promise<CreateRunResult> {
  const cleanRelease = String(release || '').trim();
  const cleanToken = String(cfg.token || '').trim();
  if (!cleanRelease) throw new Error('Номер релиза не должен быть пустым.');
  if (!cleanToken) throw new Error('Allure Api-Token не задан.');

  const launches: CreateRunLaunch[] = [];
  const createdTagNames: string[] = [];
  const syncedTestPlanIds: number[] = [];
  const total = totalOperations(mode);
  let done = 0;
  const tick = () => {
    done += 1;
    options?.onProgress?.(Math.min(100, Math.round((done / total) * 100)));
  };
  const log = (text: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info') => options?.onLog?.(text, level);

  log(`──────── Создание рана Allure TestOps ────────`);
  log(`Режим: ${MODE_LABELS[mode]} • Релиз: ${cleanRelease}`);

  log(`Создаю тег релиза ${cleanRelease}...`);
  const tagRelease = await createTag(cfg, cleanRelease);
  createdTagNames.push(cleanRelease);
  tick();
  log(`Тег релиза создан: id=${tagRelease}`, 'ok');

  let messageTitle = '';

  if (mode === '1') {
    const launchName = `[SWAT][Крит-путь][Android] ${cleanRelease}`;
    log(`Запускаю тест-план ${TP_CP_ANDROID} → ${launchName}`);
    launches.push(await runTestPlan(cfg, TP_CP_ANDROID, launchName, [TAG_ANDROID, tagRelease]));
    tick();
    messageTitle = `Привет, новый крит-путь для ХФ Android, релиз ${cleanRelease}`;
  } else if (mode === '2') {
    const launchName = `[SWAT][Крит-путь][iOS] ${cleanRelease}`;
    log(`Запускаю тест-план ${TP_CP_IOS} → ${launchName}`);
    launches.push(await runTestPlan(cfg, TP_CP_IOS, launchName, [tagRelease, TAG_IOS]));
    tick();
    messageTitle = `Привет, новый крит-путь для ХФ iOS, релиз ${cleanRelease}`;
  } else if (mode === '3') {
    log(`Синхронизирую тест-планы NAPI...`);
    for (const testPlanId of [TP_NAPI_BASE, TP_NAPI_IOS, TP_NAPI_ANDROID]) {
      log(`sync testplan ${testPlanId}...`);
      await syncTestPlan(cfg, testPlanId);
      syncedTestPlanIds.push(testPlanId);
      tick();
    }

    const tagNapi = await createTag(cfg, 'napi');
    createdTagNames.push('napi');
    tick();
    log(`Тег napi создан: id=${tagNapi}`, 'ok');

    const tasks: Array<{ tp: number; name: string; tags: number[] }> = [
      {
        tp: TP_NAPI_BASE,
        name: `[SWAT][Android и iOS] Релиз Napi ${cleanRelease}`,
        tags: [TAG_ANDROID, TAG_IOS, tagRelease, tagNapi],
      },
      {
        tp: TP_NAPI_IOS,
        name: `[SWAT][Финтех + Корзина][iOS] Релиз Napi ${cleanRelease}`,
        tags: [TAG_IOS, tagRelease, tagNapi],
      },
      {
        tp: TP_NAPI_ANDROID,
        name: `[SWAT][Финтех + Корзина][Android] Релиз Napi ${cleanRelease}`,
        tags: [tagRelease, TAG_ANDROID, tagNapi],
      },
    ];

    for (const task of tasks) {
      log(`Запускаю ${task.tp} → ${task.name}`);
      launches.push(await runTestPlan(cfg, task.tp, task.name, task.tags));
      tick();
    }
    messageTitle = `Привет, новый регресс для NAPI, релиз ${cleanRelease}`;
  } else if (mode === '4') {
    const tasks: Array<{ tp: number; name: string; tags: number[] }> = [
      {
        tp: TP_CP_ANDROID,
        name: `[SWAT][Крит-путь][Android] Тест UI Старых устройств ${cleanRelease}`,
        tags: [TAG_ANDROID, tagRelease],
      },
      {
        tp: TP_CP_ANDROID,
        name: `[SWAT][Крит-путь][Android] Раскладушки (FOLD) ${cleanRelease}`,
        tags: [TAG_ANDROID, tagRelease],
      },
      {
        tp: TP_CP_IOS,
        name: `[SWAT][Крит-путь][IOS] Тест UI Старых устройств ${cleanRelease}`,
        tags: [TAG_IOS, tagRelease],
      },
      {
        tp: TP_CP_IOS,
        name: `[SWAT][Крит-путь][IOS] iPAD ${cleanRelease}`,
        tags: [TAG_IOS, tagRelease],
      },
    ];

    for (const task of tasks) {
      log(`Запускаю ${task.tp} → ${task.name}`);
      launches.push(await runTestPlan(cfg, task.tp, task.name, task.tags));
      tick();
    }
    messageTitle = `Привет, новые воскресные раны устройств, релиз ${cleanRelease}`;
  } else if (mode === '5') {
    const tagAppGallery = await createTag(cfg, 'AppGallery');
    createdTagNames.push('AppGallery');
    tick();
    log(`Тег AppGallery создан: id=${tagAppGallery}`, 'ok');

    const tagRuStore = await createTag(cfg, 'RuStore');
    createdTagNames.push('RuStore');
    tick();
    log(`Тег RuStore создан: id=${tagRuStore}`, 'ok');

    const tasks: Array<{ tp: number; name: string; tags: number[] }> = [
      {
        tp: TP_CP_ANDROID,
        name: `[SWAT][Крит-путь] AppGallery ${cleanRelease}`,
        tags: [TAG_ANDROID, tagRelease, tagAppGallery],
      },
      {
        tp: TP_CP_ANDROID,
        name: `[SWAT][Крит-путь] RuStore ${cleanRelease}`,
        tags: [TAG_ANDROID, tagRelease, tagRuStore],
      },
    ];

    for (const task of tasks) {
      log(`Запускаю ${task.tp} → ${task.name}`);
      launches.push(await runTestPlan(cfg, task.tp, task.name, task.tags));
      tick();
    }
    messageTitle = `Привет, новый крит-путь для ХФ Android, релиз ${cleanRelease}`;
  } else if (mode === '6') {
    const tagAppGallery = await createTag(cfg, 'AppGallery');
    createdTagNames.push('AppGallery');
    tick();
    log(`Тег AppGallery создан: id=${tagAppGallery}`, 'ok');

    const tagRuStore = await createTag(cfg, 'RuStore');
    createdTagNames.push('RuStore');
    tick();
    log(`Тег RuStore создан: id=${tagRuStore}`, 'ok');

    const tasks: Array<{ tp: number; name: string; tags: number[] }> = [
      {
        tp: TP_SMOKE_RUSTORE,
        name: `[SWAT][Android][Smoke] RuStore ${cleanRelease}`,
        tags: [TAG_ANDROID, tagRelease, tagRuStore],
      },
      {
        tp: TP_SMOKE_APPGALLERY,
        name: `[SWAT][Android][Smoke] AppGallery ${cleanRelease}`,
        tags: [TAG_ANDROID, tagRelease, tagAppGallery],
      },
    ];

    for (const task of tasks) {
      log(`Запускаю ${task.tp} → ${task.name}`);
      launches.push(await runTestPlan(cfg, task.tp, task.name, task.tags));
      tick();
    }
    messageTitle = `Привет, новый Smoke для ХФ Android, релиз ${cleanRelease}`;
  }

  const messageText = buildMessage(messageTitle, launches);
  log(`Готово: создано ${launches.length} launch.`, 'ok');

  return {
    mode,
    modeLabel: MODE_LABELS[mode],
    release: cleanRelease,
    launches,
    messageTitle,
    messageText,
    createdTagNames,
    syncedTestPlanIds,
  };
}

export function createRunModeLabel(mode: CreateRunMode) {
  return MODE_LABELS[mode];
}
