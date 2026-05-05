const RELEASE_CACHE_ROOT_FOLDER_ID = '1Gc22V-oNEnZTJ0H-3T9GJ6PDEm82pT3H'; // "Release cache"
const BUILD = '2025-12-24_uwu_hours_v12';

const TIMESHEET_SPREADSHEET_ID = '1Wbm8IVmtwODkVJdJmfRqgyEAVNGUB5YJj45x7FmqVaI';

// SWAT берём НАПРЯМУЮ из Google Doc
const SWAT_DOC_ID = '1AYHrg_w_aCdiunytlDVmbmyQAxiHRr51Z0Djju4GAnE';

const BASE_HOURS = 12;

// вычесть 33.3% из рассчитанных часов
const REDUCTION_PERCENT = 33.3;
const REDUCTION_FACTOR = 1 - (REDUCTION_PERCENT / 100);

function round2_(n) {
  const x = Number(n);
  if (!isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function applyReduction_(hours) {
  const h = Number(hours) || 0;
  if (h <= 0) return 0;
  return round2_(h * REDUCTION_FACTOR);
}

function normalizeLogin_(s) { return String(s || '').trim().toLowerCase(); }

function normRu_(s) {
  return String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function buildNameKeys_(fio) {
  const parts = normRu_(fio).split(' ').filter(Boolean);
  if (parts.length < 2) return [];

  const out = new Set();
  const pushPair = (a, b) => {
    if (!a || !b || a === b) return;
    out.add(`${a} ${b}`);
  };

  // Базовые варианты: первые два слова и их обратный порядок.
  pushPair(parts[0], parts[1]);
  pushPair(parts[1], parts[0]);

  // Фолбэк на случай "Имя Отчество Фамилия" или "Фамилия Имя Отчество".
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    pushPair(parts[0], last);
    pushPair(last, parts[0]);
  }

  return Array.from(out);
}

function safeJsonParse_(text) {
  try { return { ok: true, data: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}

function monthNameRu_(d) {
  const arr = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return arr[d.getMonth()];
}

function toIsoDate_(year, monthIndex0, day) {
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function buildReleaseCandidates_(release) {
  const r = String(release || '').trim();
  const out = [];
  const seen = new Set();
  const add = (x) => {
    const v = String(x || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v); out.push(v);
  };

  add(r);

  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(r);
  if (m) {
    const major = m[1], minor = m[2], patch = m[3];
    if (patch.length < 4) add(`${major}.${minor}.${patch.padStart(4, '0')}`);
    if (patch.length < 4) add(`${major}.${minor}.${patch.padEnd(4, '0')}`);
    if (patch.length === 4 && patch.endsWith('0')) {
      const trimmed = patch.replace(/0+$/, '');
      if (trimmed.length >= 1) add(`${major}.${minor}.${trimmed}`);
    }
  }
  return out;
}

function findFirstFolderByName_(rootFolder, names) {
  for (const n of names) {
    const it = rootFolder.getFoldersByName(n);
    if (it.hasNext()) return { folder: it.next(), matchedName: n };
  }
  return { folder: null, matchedName: null };
}

function findCacheFile_(folder, candReleases) {
  for (const rel of candReleases) {
    const exact = `cache_${rel}.json`;
    const it = folder.getFilesByName(exact);
    if (it.hasNext()) return { file: it.next(), matchedFile: exact, mode: 'exact' };
  }
  let best = null, bestName = null;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!/^cache_.*\.json$/i.test(name)) continue;
    const ok = candReleases.some(rel => name.indexOf(`cache_${rel}`) === 0);
    if (!ok) continue;
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) {
      best = f; bestName = name;
    }
  }
  if (best) return { file: best, matchedFile: bestName, mode: 'latest' };
  return { file: null, matchedFile: null, mode: null };
}

// читаем Google Doc через DocumentApp
function readSwatDocText_() {
  const doc = DocumentApp.openById(SWAT_DOC_ID);
  return doc.getBody().getText();
}

// full_name = только ФИО (до "-"), stream = ВСЁ после "-" (включая скобки)
function splitNameAndStream_(rest) {
  const s = String(rest || '');

  const m = /^(.*?)(?:\s*-\s*(.*))?$/.exec(s);
  const namePart = String(m && m[1] ? m[1] : '').trim();

  let streamPart = String(m && typeof m[2] !== 'undefined' ? m[2] : '');
  if (!streamPart || !String(streamPart).trim()) streamPart = '';
  else streamPart = streamPart.trim();

  return { full_name: namePart, stream: streamPart };
}

function extractSwatEntryTexts_(rawText) {
  const text = String(rawText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r?\n/g, '\n')
    .trim();
  if (!text) return [];

  // Ищем начало каждой записи по логину, чтобы переживать склейки строк в Google Doc.
  const starts = [];
  const re = /(^|[^a-z0-9._-])([a-z0-9_-]+\.[a-z0-9._-]+)\s+/g;
  let m;

  while ((m = re.exec(text)) !== null) {
    const start = m.index + String(m[1] || '').length;
    if (!starts.length || starts[starts.length - 1] !== start) starts.push(start);
  }

  if (!starts.length) {
    return text.split('\n').map(x => String(x || '').trim()).filter(Boolean);
  }

  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = (i + 1 < starts.length) ? starts[i + 1] : text.length;
    const chunk = String(text.slice(start, end) || '').trim();
    if (chunk) out.push(chunk);
  }

  return out;
}

/**
 * Вход (из дока):
 *   login ФИО - Stream
 * Выход:
 *   { login, full_name: "ФИО", stream: "Stream" }
 */
function parseSwatTextToRows_(rawText) {
  const rows = [];
  const lines = extractSwatEntryTexts_(rawText);
  if (!lines.length) return rows;

  lines.forEach(line => {
    const m = /^([a-z0-9._-]+)\s+([\s\S]+)$/.exec(line);
    if (!m) return;

    const login = normalizeLogin_(m[1]);
    const rest = String(m[2] || '').trim();
    if (!login) return;

    const ns = splitNameAndStream_(rest);
    rows.push({ login, full_name: ns.full_name, stream: ns.stream });
  });

  return rows;
}

function buildNameKeyMaps_(swatRows) {
  const keyToLogin = {};
  const loginToFull = {};
  const loginToStream = {};

  (swatRows || []).forEach(r => {
    const login = r.login;
    const full = String(r.full_name || '').trim(); // только ФИО
    const stream = String(r.stream || '').trim();
    if (!login) return;

    buildNameKeys_(full).forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(keyToLogin, key)) keyToLogin[key] = login;
    });

    loginToFull[login] = full || login;
    loginToStream[login] = stream || '';
  });

  return { keyToLogin, loginToFull, loginToStream };
}

function fioToKeys_(fio) {
  return buildNameKeys_(fio);
}

function getCurrentMonthSheet_(ss) {
  const want = monthNameRu_(new Date());
  return ss.getSheetByName(want) || ss.getSheets()[0];
}

function detectHeaderRows_(sheet, lastCol) {
  const sampleRows = Math.min(20, sheet.getLastRow());
  const grid = sheet.getRange(1, 1, sampleRows, lastCol).getDisplayValues();
  let dayRow = null, weekdayRow = null;
  for (let r = 0; r < grid.length; r++) {
    let cnt = 0;
    for (let c = 0; c < grid[r].length; c++) {
      const n = Number(String(grid[r][c] || '').trim());
      if (isFinite(n) && n >= 1 && n <= 31) cnt++;
    }
    if (cnt >= 10) { dayRow = r + 1; weekdayRow = dayRow - 1; break; }
  }
  if (!dayRow || weekdayRow < 1) throw new Error('Не смог найти шапку с днями (строку 1..31).');
  return { dayRow, weekdayRow };
}

function detectDayColumns_(sheet, dayRow, lastCol) {
  const days = sheet.getRange(dayRow, 1, 1, lastCol).getDisplayValues()[0];
  let firstDayCol = null, lastDayCol = null;
  for (let c = 1; c <= lastCol; c++) {
    const n = Number(String(days[c - 1] || '').trim());
    if (isFinite(n) && n >= 1 && n <= 31) {
      if (!firstDayCol) firstDayCol = c;
      lastDayCol = c;
    }
  }
  if (!firstDayCol || !lastDayCol) throw new Error('Не смог определить колонки дней месяца.');
  return { firstDayCol, lastDayCol };
}

function hexToRgb_(hex) {
  const h = String(hex || '').trim().toLowerCase();
  if (!h || h[0] !== '#') return null;
  const x = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
  if (x.length !== 7) return null;
  const r = parseInt(x.slice(1, 3), 16);
  const g = parseInt(x.slice(3, 5), 16);
  const b = parseInt(x.slice(5, 7), 16);
  if (![r, g, b].every(v => isFinite(v))) return null;
  return { r, g, b };
}

function isGreenBg_(hex) {
  const rgb = hexToRgb_(hex);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  if (g < 180) return false;
  if (hex === '#ffffff' || hex === '#fff') return false;
  return (g >= r && g >= b && (g - r >= 10 || g - b >= 10));
}

/**
 * Правила (только зелёные клетки):
 *  - пусто => 12
 *  - L => 12
 *  - Д => 12
 *  - П-2 => 12 - 2
 *  - L-5 => 5
 * + потом -33.3% и округление до 2 знаков
 */
function hoursFromGreenCell_(text) {
  const s = String(text || '').trim();
  let hours;

  if (!s) {
    hours = BASE_HOURS;
    return applyReduction_(hours);
  }

  const mL = /L-(\d+)/i.exec(s);
  if (mL) {
    hours = Math.max(0, Number(mL[1]) || 0);
    return applyReduction_(hours);
  }

  const mP = /П-(\d+)/i.exec(s);
  if (mP) {
    hours = Math.max(0, BASE_HOURS - (Number(mP[1]) || 0));
    return applyReduction_(hours);
  }

  if (/^Д$/i.test(s)) {
    hours = BASE_HOURS;
    return applyReduction_(hours);
  }

  if (/^L$/i.test(s) || /\bL\b/i.test(s)) {
    hours = BASE_HOURS;
    return applyReduction_(hours);
  }

  hours = BASE_HOURS;
  return applyReduction_(hours);
}

function buildHoursMapFromTimesheet_(sheet, keyToLogin, year, monthIndex0) {
  const lastCol = sheet.getLastColumn();
  const { dayRow } = detectHeaderRows_(sheet, lastCol);
  const { firstDayCol, lastDayCol } = detectDayColumns_(sheet, dayRow, lastCol);

  const dayNums = sheet.getRange(dayRow, 1, 1, lastCol).getDisplayValues()[0];

  const dataStartRow = dayRow + 1;
  const maxRows = sheet.getLastRow() - dataStartRow + 1;
  const width = lastDayCol;

  const values = sheet.getRange(dataStartRow, 1, maxRows, width).getDisplayValues();
  const bgs = sheet.getRange(dataStartRow, firstDayCol, maxRows, lastDayCol - firstDayCol + 1).getBackgrounds();

  const hoursByLoginByDay = {};

  for (let i = 0; i < values.length; i++) {
    const fio = String(values[i][0] || '').trim();
    if (!fio) continue;

    const keys = fioToKeys_(fio);
    const matchedKey = keys.find(key => Object.prototype.hasOwnProperty.call(keyToLogin, key));
    const login = matchedKey ? keyToLogin[matchedKey] : null;
    if (!login) continue;

    for (let c = firstDayCol; c <= lastDayCol; c++) {
      const dayNum = Number(String(dayNums[c - 1] || '').trim());
      if (!isFinite(dayNum) || dayNum < 1 || dayNum > 31) continue;

      const bg = bgs[i][c - firstDayCol];
      if (!isGreenBg_(bg)) continue;

      const cellText = values[i][c - 1];
      const hours = hoursFromGreenCell_(cellText);
      if (hours <= 0) continue;

      const iso = toIsoDate_(year, monthIndex0, dayNum);
      if (!hoursByLoginByDay[login]) hoursByLoginByDay[login] = {};
      hoursByLoginByDay[login][iso] = hours;
    }
  }

  return hoursByLoginByDay;
}

// достаём уникальные (year, monthIndex0) из day_counts ключей "YYYY-MM-DD"
function extractYearMonthsFromDayCounts_(dc) {
  const seen = new Set();
  const out = [];

  Object.keys(dc || {}).forEach(day => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '').trim());
    if (!m) return;
    const y = Number(m[1]);
    const mo = Number(m[2]); // 1..12
    if (!isFinite(y) || !isFinite(mo) || mo < 1 || mo > 12) return;
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ year: y, monthIndex0: mo - 1, key });
  });

  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// получаем лист по месяцу (по имени "Январь", "Февраль", ...)
function getSheetByMonthIndex_(ss, year, monthIndex0) {
  const name = monthNameRu_(new Date(year, monthIndex0, 1));
  return ss.getSheetByName(name) || ss.getSheets()[0];
}

function getDayCountsForLogin_(dc, login) {
  const target = normalizeLogin_(String(login || '').replace(/^@/, ''));
  if (!target) return [];

  const out = [];
  Object.keys(dc || {}).sort().forEach(day => {
    const perLogin = dc[day];
    if (!perLogin || typeof perLogin !== 'object') return;

    let cases = 0;
    Object.keys(perLogin).forEach(loginRaw => {
      const normalized = normalizeLogin_(String(loginRaw || '').replace(/^@/, ''));
      if (normalized !== target) return;
      cases += Number(perLogin[loginRaw]) || 0;
    });

    if (cases > 0) out.push({ day, cases });
  });

  return out;
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const release = String(params.release || '').trim();
  const debug = String(params.debug || '').trim() === '1' || String(params.debug || '').trim().toLowerCase() === 'true';
  const inspectLogin = normalizeLogin_(String(params.inspect_login || params.inspect || '').replace(/^@/, ''));

  const out = { release: release || '', worked_SWAT: { login: [], total: 0 }, worked_days: {} };

  if (!release) {
    out.error = "Query param 'release' is required.";
    out.error_code = 422;
    return ContentService.createTextOutput(JSON.stringify(out, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const cand = buildReleaseCandidates_(release);
  let folderMatched = null, fileMatched = null, fileMode = null;

  try {
    const root = DriveApp.getFolderById(RELEASE_CACHE_ROOT_FOLDER_ID);
    const foundFolder = findFirstFolderByName_(root, cand);
    folderMatched = foundFolder.matchedName;
    if (!foundFolder.folder) throw new Error(`Release folder not found under root. Tried: ${cand.join(', ')}`);

    const foundFile = findCacheFile_(foundFolder.folder, cand);
    fileMatched = foundFile.matchedFile;
    fileMode = foundFile.mode;
    if (!foundFile.file) throw new Error(`Cache file not found in folder '${folderMatched}'.`);

    const cacheText = foundFile.file.getBlob().getDataAsString('UTF-8');
    const parsed = safeJsonParse_(cacheText);
    if (!parsed.ok) throw new Error(`JSON parse error: ${parsed.error}`);

    const cacheObj = parsed.data;
    const dc = cacheObj && cacheObj.day_counts ? cacheObj.day_counts : null;
    if (!dc || typeof dc !== 'object') throw new Error('Cache has no day_counts.');

    // SWAT из Google Doc
    const swatText = readSwatDocText_();
    const swatRows = parseSwatTextToRows_(swatText);
    const maps = buildNameKeyMaps_(swatRows);

    const ss = SpreadsheetApp.openById(TIMESHEET_SPREADSHEET_ID);

    // собираем часы из всех месяцев, которые реально встречаются в day_counts
    const ymList = extractYearMonthsFromDayCounts_(dc);
    const hoursByLoginByDay = {};
    const sheetsUsed = [];

    ymList.forEach(({ year, monthIndex0 }) => {
      const sheet = getSheetByMonthIndex_(ss, year, monthIndex0);
      sheetsUsed.push(sheet.getName());

      const part = buildHoursMapFromTimesheet_(sheet, maps.keyToLogin, year, monthIndex0);
      Object.keys(part).forEach(login => {
        if (!hoursByLoginByDay[login]) hoursByLoginByDay[login] = {};
        Object.keys(part[login]).forEach(day => {
          hoursByLoginByDay[login][day] = part[login][day];
        });
      });
    });

    // ИЗМЕНЕНО: берём ВСЕ логины из кеша (в рамках cases>0), даже если hours не найдены -> null
    const workedSet = new Set();
    const workedDaysOut = {};

    Object.keys(dc).sort().forEach(day => {
      const perLogin = dc[day];
      if (!perLogin || typeof perLogin !== 'object') return;

      const loginObj = {};
      Object.keys(perLogin).sort().forEach(loginRaw => {
        const cases = Number(perLogin[loginRaw]) || 0;
        if (cases <= 0) return;

        const login = normalizeLogin_(String(loginRaw).replace(/^@/, ''));
        if (!login) return;

        const hours = (hoursByLoginByDay[login] && (day in hoursByLoginByDay[login]))
          ? Number(hoursByLoginByDay[login][day]) || 0
          : 0;

        loginObj[login] = (hours > 0) ? hours : null;
        workedSet.add(login);
      });

      workedDaysOut[day] = { login: loginObj, total: Object.keys(loginObj).length };
    });

    const workedLogins = Array.from(workedSet).sort();

    // ИЗМЕНЕНО: если по логину не нашли ни одного часа -> full_name=null, stream=null
    const workedLoginObjs = workedLogins.map(l => ({
      login: l,
      full_name: Object.prototype.hasOwnProperty.call(maps.loginToFull, l) ? maps.loginToFull[l] : null,
      stream: Object.prototype.hasOwnProperty.call(maps.loginToStream, l) ? maps.loginToStream[l] : null
    }));


    out.worked_SWAT = { login: workedLoginObjs, total: workedLoginObjs.length };
    out.worked_days = workedDaysOut;

    if (debug) {
      const inspectSwatRow = inspectLogin
        ? ((swatRows || []).find(r => normalizeLogin_(r && r.login) === inspectLogin) || null)
        : null;
      const inspectCacheDays = inspectLogin ? getDayCountsForLogin_(dc, inspectLogin) : [];
      const inspectHoursByDay = inspectLogin && hoursByLoginByDay[inspectLogin]
        ? hoursByLoginByDay[inspectLogin]
        : {};

      out._debug = {
        build: BUILD,
        month_sheet_used: sheetsUsed.join(', '),
        month_sheet_used_list: sheetsUsed,
        year_months_from_day_counts: ymList.map(x => x.key),
        timesheet_spreadsheet_id: TIMESHEET_SPREADSHEET_ID,
        swat_doc_id: SWAT_DOC_ID,
        swat_rows: swatRows.length,
        base_hours: BASE_HOURS,
        reduction_percent: REDUCTION_PERCENT,
        release_in: release,
        release_candidates: cand,
        folder_found: folderMatched,
        file_found: fileMatched,
        file_mode: fileMode,
        inspect: inspectLogin ? {
          login: inspectLogin,
          in_swat_maps: Object.prototype.hasOwnProperty.call(maps.loginToFull, inspectLogin),
          swat_row: inspectSwatRow,
          in_worked_swat: workedLogins.indexOf(inspectLogin) >= 0,
          cache_days_total: inspectCacheDays.length,
          cache_days: inspectCacheDays,
          hours_days_total: Object.keys(inspectHoursByDay).length,
          hours_by_day: inspectHoursByDay,
          has_any_hours: !!(hoursByLoginByDay[inspectLogin] && Object.keys(hoursByLoginByDay[inspectLogin]).length > 0)
        } : null
      };
    }

    return ContentService.createTextOutput(JSON.stringify(out, null, 2))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    out.error = String(err && err.message ? err.message : err);
    if (debug) {
      out._debug = {
        build: BUILD,
        release_in: release,
        release_candidates: cand,
        folder_found: folderMatched,
        file_found: fileMatched,
        file_mode: fileMode,
        inspect_login: inspectLogin || null
      };
    }
    return ContentService.createTextOutput(JSON.stringify(out, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function authorizeOnce() {
  Logger.log('Build: ' + BUILD);

  Logger.log('Release cache folder: ' + DriveApp.getFolderById(RELEASE_CACHE_ROOT_FOLDER_ID).getName());

  Logger.log('SWAT doc name: ' + DocumentApp.openById(SWAT_DOC_ID).getName());

  const swatText = readSwatDocText_();
  const swatRows = parseSwatTextToRows_(swatText);
  Logger.log('SWAT rows parsed: ' + swatRows.length);
  Logger.log('SWAT sample: ' + JSON.stringify(swatRows.slice(0, 3)));

  const ss = SpreadsheetApp.openById(TIMESHEET_SPREADSHEET_ID);
  const sh = getCurrentMonthSheet_(ss);
  Logger.log('Timesheet sheet: ' + sh.getName());
  Logger.log('Timesheet sample A1:B5 = ' + JSON.stringify(sh.getRange('A1:B5').getDisplayValues()));
}
