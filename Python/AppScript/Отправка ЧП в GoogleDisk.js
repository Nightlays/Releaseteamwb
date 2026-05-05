/**
 * CHП → Google Sheets writer (Web App) v1.0.6
 * Графики строим через Sheets API (HTTP). Если API выключен → не падаем, просто без графиков.
 *
 * v1.0.3: подсветка колонок ИТОГО месяца/квартала светло-серым.
 * v1.0.4: закрепление колонки A; заголовки платформ только в A (без merge на всю строку).
 * v1.0.5:
 *   - если у стрима ИТОГО по кварталу > 20 → ячейка красная, шрифт белый (conditional formatting)
 *   - группировка стримов по базовому имени до "|" (для отдельной таблицы)
 *   - адаптив: учитываем высоту правых таблиц/данных графика, чтобы Android/iOS не перемешивались при большом числе релизов
 *
 * v1.0.6:
 *   - основная (левая) таблица вернулась к "старому" виду (без группировки стримов), но с красным выделением ИТОГО Q
 *   - сгруппированная таблица теперь отдельная и рисуется правее таблицы значений для диаграммы
 *   - более адаптивно по высоте блока под любое количество релизов (правые таблицы не залезают на следующий блок)
 */

const SPREADSHEET_ID = '1ze1c0ysGgq3x0kYuTUVFOldf1i5BOYbjtYPx3JlRcnw';
const REPORT_BASE_NAME = 'черепики_2026';

const RU_MONTH_ABBR = {
  1:'янв.',2:'фев.',3:'мар.',4:'апр.',5:'май',6:'июн.',
  7:'июл.',8:'авг.',9:'сен.',10:'окт.',11:'ноя.',12:'дек.'
};

function authorize(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ss.getSheets();
  Logger.log('Authorized OK. Spreadsheet title: ' + ss.getName());
}

function authorizeExternalRequest(){
  const r = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('UrlFetch authorized. HTTP=' + r.getResponseCode());
}

function doGet(){
  return json_({ ok:true, service:'chp-writer', now:new Date().toISOString() });
}

function doPost(e){
  try{
    const req = parseBody_(e);
    const payload = req && req.payload ? req.payload : req;

    if(!payload || typeof payload !== 'object'){
      return json_({ ok:false, error:'payload is required' });
    }

    const res = writeReport_(payload);
    return json_({ ok:true, ...res });
  }catch(err){
    return json_({
      ok:false,
      error:String(err && err.message ? err.message : err),
      stack:String(err && err.stack ? err && err.stack : '')
    });
  }
}

/* ===================== CORE ===================== */

function writeReport_(payload){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tz = ss.getSpreadsheetTimeZone() || 'Etc/GMT';

  const ts = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HH-mm-ss');
  const tmpName = REPORT_BASE_NAME + '_tmp_' + ts;

  const tmp = ss.insertSheet(tmpName);
  ss.setActiveSheet(tmp);

  // удалить старые отчёты
  const sheets = ss.getSheets();
  for (const sh of sheets){
    if (sh.getSheetId() === tmp.getSheetId()) continue;
    const name = sh.getName();
    if (name === REPORT_BASE_NAME || name.indexOf(REPORT_BASE_NAME + '_') === 0){
      ss.deleteSheet(sh);
    }
  }
  tmp.setName(REPORT_BASE_NAME);

  const drivePayload = normalizePayload_(payload);

  // общий план по объединённым cutoffs, чтобы ширина/колонки совпадали у Android/iOS
  const globalCutoffs = mergeCutoffs_(drivePayload.releases, drivePayload.and_cutoffs, drivePayload.ios_cutoffs);

  // сгруппированные данные — ТОЛЬКО для отдельной таблицы справа
  const andGrouped = groupCountsByBase_(drivePayload.and_counts, drivePayload.releases);
  const iosGrouped = groupCountsByBase_(drivePayload.ios_counts, drivePayload.releases);

  // ---------- Android ----------
  let row = 1;
  const androidMeta = {};
  row = writePlatformBlock_(tmp, row, 'Android', drivePayload.releases, drivePayload.and_counts, globalCutoffs, androidMeta);

  // адаптивная высота: учитываем правые таблицы (значения диаграммы + grouped) и высоту графика
  row = Math.max(row + 1, estimatePlatformBlockEndRow_(androidMeta, drivePayload.releases, andGrouped) + 3);

  // ---------- iOS ----------
  const iosMeta = {};
  row = writePlatformBlock_(tmp, row, 'iOS', drivePayload.releases, drivePayload.ios_counts, globalCutoffs, iosMeta);

  SpreadsheetApp.flush();

  // чистим графики
  removeAllCharts_(tmp);
  SpreadsheetApp.flush();

  // графики (fallback если API выключен)
  let chartsStatus = { ok:true, note:'charts created' };
  try{
    const andTotals = computeTotalsByRelease_(drivePayload.releases, drivePayload.and_counts);
    const iosTotals = computeTotalsByRelease_(drivePayload.releases, drivePayload.ios_counts);

    insertPlatformChartViaHttpApi_(ss.getId(), tmp, androidMeta, 'Android', drivePayload.releases, andTotals, andGrouped);
    insertPlatformChartViaHttpApi_(ss.getId(), tmp, iosMeta, 'iOS', drivePayload.releases, iosTotals, iosGrouped);
    SpreadsheetApp.flush();
  }catch(err){
    const msg = String(err && err.message ? err.message : err);
    if (msg.indexOf('SERVICE_DISABLED') !== -1 || msg.indexOf('has not been used') !== -1){
      chartsStatus = { ok:false, note:'Google Sheets API disabled in Cloud project — report generated without charts', error: msg };
    } else {
      throw err;
    }
  }

  applyAlignment_(tmp);
  fitAllColumnsByContent_(tmp);

  // закрепляем колонку A
  try{ tmp.setFrozenColumns(1); }catch(_){}

  const sheetUrl = ss.getUrl() + '#gid=' + tmp.getSheetId();
  return {
    spreadsheetUrl: ss.getUrl(),
    sheetName: tmp.getName(),
    sheetId: tmp.getSheetId(),
    sheetUrl,
    charts: chartsStatus
  };
}

function removeAllCharts_(sheet){
  try{
    const charts = sheet.getCharts();
    for (const ch of charts){
      try{ sheet.removeChart(ch); }catch(_){}
    }
  }catch(_){}
}

function computeTotalsByRelease_(releases, counts){
  const totals = {};
  for (const rel of (releases||[])) totals[rel] = 0;

  for (const rowKey in (counts||{})){
    const row = counts[rowKey] || {};
    for (const rel of (releases||[])){
      totals[rel] = Number(totals[rel]||0) + Number(row[rel]||0);
    }
  }
  return totals;
}

/**
 * Гарантирует, что лист имеет минимум needRows строк и needCols колонок.
 */
function ensureGrid_(sh, needRows, needCols){
  if (!sh) return;

  const maxR = sh.getMaxRows();
  if (needRows > maxR){
    sh.insertRowsAfter(maxR, needRows - maxR);
  }

  const maxC = sh.getMaxColumns();
  if (needCols > maxC){
    sh.insertColumnsAfter(maxC, needCols - maxC);
  }
}

/**
 * Оценка нижней границы блока платформы, чтобы следующий блок (iOS) не "заезжал"
 * на правые таблицы Android при большом числе релизов.
 */
function estimatePlatformBlockEndRow_(meta, releases, groupedCounts){
  const blockStart = meta && meta.blockStartRow ? meta.blockStartRow : 1;
  const tableEnd = meta && meta.tableEndRow ? meta.tableEndRow : blockStart;

  const rightStartRow = blockStart + 1;

  const chartValuesRows = (releases||[]).length + 1; // header + N releases
  const chartValuesEnd = rightStartRow + chartValuesRows - 1;

  const gN = Object.keys(groupedCounts || {}).length;
  const groupedRows = gN + 4; // quarterRow + header + subheader + total + gN rows
  const groupedEnd = rightStartRow + groupedRows - 1;

  const chartOverlayEndEstimate = rightStartRow + 18; // ~260px + запас

  return Math.max(tableEnd, chartValuesEnd, groupedEnd, chartOverlayEndEstimate);
}

/* ===================== RIGHT SIDE: CHART + VALUES + GROUPED TABLE ===================== */

function insertPlatformChartViaHttpApi_(spreadsheetId, sh, meta, platformName, releases, totals, groupedCounts){
  if (!sh || !meta || !meta.blockStartRow || !meta.width) return;

  const sheetId = sh.getSheetId();

  const chartRow = meta.blockStartRow + 1;
  const chartCol = meta.width + 3;

  const dataRow  = meta.blockStartRow + 1;
  const dataCol  = chartCol + 12; // таблица значений для диаграммы (2 колонки)

  // --- таблица значений для диаграммы ---
  let maxV = 0;
  for (const rel of (releases||[])){
    const v = Number((totals||{})[rel] || 0);
    if (v > maxV) maxV = v;
  }
  const viewWindowMax = Math.max(1, Math.ceil(maxV * 1.25) + 2);

  const rows = [];
  rows.push(['Релиз', platformName]);
  for (const rel of (releases||[])){
    const v = Number((totals||{})[rel]||0);
    rows.push(["'" + String(rel), v]);
  }

  // --- сгруппированная таблица (ОТДЕЛЬНО) правее таблицы значений ---
  const groupedStartCol = dataCol + 3; // 1 пустая колонка между
  const groupedStartRow = dataRow;

  // заранее расширяем сетку под обе правые таблицы + место под график
  const rightNeedRows = Math.max(
    dataRow + rows.length + 2,
    groupedStartRow + (Object.keys(groupedCounts||{}).length + 4) + 2
  );
  const rightNeedCols = Math.max(chartCol + 2, dataCol + 2, groupedStartCol + 40) + 2;
  ensureGrid_(sh, rightNeedRows, rightNeedCols);

  const rng = sh.getRange(dataRow, dataCol, rows.length, 2);
  rng.clear({contentsOnly:true});
  rng.setValues(rows);

  sh.getRange(dataRow, dataCol, 1, 2).setFontWeight('bold');
  if (rows.length > 1){
    sh.getRange(dataRow+1, dataCol, rows.length-1, 1).setNumberFormat('@');
    sh.getRange(dataRow+1, dataCol+1, rows.length-1, 1).setNumberFormat('0');
  }

  // ✅ отдельная grouped-таблица справа (по первому слову до "|")
  try{
    writeGroupedRightTable_(
      sh,
      groupedStartRow,
      groupedStartCol,
      releases,
      groupedCounts || {},
      meta.cutoffs || {},
      20 // порог красного
    );
  }catch(_){}

  SpreadsheetApp.flush();

  // 0-based. Диапазоны без header.
  const startRowIndex = (dataRow - 1) + 1;
  const endRowIndex   = startRowIndex + (rows.length - 1);

  const startColIndex = dataCol - 1;

  const domainRange = {
    sources: [{
      sheetId,
      startRowIndex,
      endRowIndex,
      startColumnIndex: startColIndex,
      endColumnIndex: startColIndex + 1
    }]
  };

  const seriesRange = {
    sources: [{
      sheetId,
      startRowIndex,
      endRowIndex,
      startColumnIndex: startColIndex + 1,
      endColumnIndex: startColIndex + 2
    }]
  };

  const requests = [{
    addChart: {
      chart: {
        spec: {
          title: platformName,
          basicChart: {
            chartType: 'LINE',
            legendPosition: 'NO_LEGEND',
            headerCount: 0,
            lineSmoothing: true,
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Релиз' },
              {
                position: 'LEFT_AXIS',
                title: platformName,
                viewWindowOptions: { viewWindowMin: 0, viewWindowMax: viewWindowMax }
              }
            ],
            domains: [{ domain: { sourceRange: domainRange } }],
            series: [{
              series: { sourceRange: seriesRange },
              targetAxis: 'LEFT_AXIS',
              dataLabel: { type: 'DATA', placement: 'ABOVE' }
            }]
          }
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: chartRow - 1, columnIndex: chartCol - 1 },
            offsetXPixels: 0,
            offsetYPixels: 0,
            widthPixels: 720,
            heightPixels: 260
          }
        }
      }
    }
  }];

  batchUpdateSheetsHttp_(spreadsheetId, requests);
  SpreadsheetApp.flush();
}

function batchUpdateSheetsHttp_(spreadsheetId, requests){
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + ':batchUpdate';
  const token = ScriptApp.getOAuthToken();

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ requests }),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();

  if (code < 200 || code >= 300){
    throw new Error('Sheets API batchUpdate failed: HTTP ' + code + ' body=' + body);
  }
}

/* ===================== ALIGN + WIDTH ===================== */

function applyAlignment_(sheet){
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol) return;

  sheet.getRange(1, 1, lastRow, 1).setHorizontalAlignment('left');

  if (lastCol > 1){
    sheet.getRange(1, 2, lastRow, lastCol - 1).setHorizontalAlignment('center');
  }

  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('middle');
}

function fitAllColumnsByContent_(sheet){
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol) return;

  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const maxLen = new Array(lastCol).fill(0);

  for (let r = 0; r < values.length; r++){
    const row = values[r];
    for (let c = 0; c < lastCol; c++){
      const s = row[c];
      if (!s) continue;
      const len = String(s).length;
      if (len > maxLen[c]) maxLen[c] = len;
    }
  }

  for (let c = 0; c < lastCol; c++){
    let px = maxLen[c] > 0 ? Math.round(maxLen[c] * 7 + 34) : 70;
    px = Math.max(70, Math.min(px, 560));
    sheet.setColumnWidth(c + 1, px);
  }
}

/* ===================== TOTALS SHADING + THRESHOLD ===================== */

function shadeTotalsColumns_(sh, tableStartRow, numRows, colPlan){
  const lightGray = '#f2f2f2';
  if (!sh || !tableStartRow || !numRows || !Array.isArray(colPlan)) return;

  for (let i = 0; i < colPlan.length; i++){
    const cd = colPlan[i];
    if (!cd) continue;
    if (cd.kind !== 'month_total' && cd.kind !== 'quarter_total') continue;

    const sheetCol = 2 + i; // 1: "Стрим", дальше план
    try{
      sh.getRange(tableStartRow, sheetCol, numRows, 1).setBackground(lightGray);
    }catch(_){}
  }
}

function shadeTotalsColumnsAt_(sh, tableStartRow, startCol, numRows, colPlan){
  const lightGray = '#f2f2f2';
  if (!sh || !tableStartRow || !startCol || !numRows || !Array.isArray(colPlan)) return;

  for (let i = 0; i < colPlan.length; i++){
    const cd = colPlan[i];
    if (!cd) continue;
    if (cd.kind !== 'month_total' && cd.kind !== 'quarter_total') continue;

    const sheetCol = (startCol + 1) + i;
    try{
      sh.getRange(tableStartRow, sheetCol, numRows, 1).setBackground(lightGray);
    }catch(_){}
  }
}

function applyQuarterThresholdFormatting_(sh, firstDataRow, lastDataRow, colPlan, threshold){
  if (!sh || !Array.isArray(colPlan)) return;
  if (!firstDataRow || !lastDataRow || lastDataRow < firstDataRow) return;

  let rules = [];
  try{ rules = sh.getConditionalFormatRules() || []; }catch(_){ rules = []; }

  const red = '#e53935';
  const white = '#ffffff';
  const numRows = (lastDataRow - firstDataRow + 1);

  for (let i = 0; i < colPlan.length; i++){
    const cd = colPlan[i];
    if (!cd || cd.kind !== 'quarter_total') continue;

    const sheetCol = 2 + i;
    const range = sh.getRange(firstDataRow, sheetCol, numRows, 1);

    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(Number(threshold))
      .setBackground(red)
      .setFontColor(white)
      .setRanges([range])
      .build();

    rules.push(rule);
  }

  sh.setConditionalFormatRules(rules);
}

function applyQuarterThresholdFormattingAt_(sh, firstDataRow, lastDataRow, startCol, colPlan, threshold){
  if (!sh || !Array.isArray(colPlan)) return;
  if (!firstDataRow || !lastDataRow || lastDataRow < firstDataRow) return;

  let rules = [];
  try{ rules = sh.getConditionalFormatRules() || []; }catch(_){ rules = []; }

  const red = '#e53935';
  const white = '#ffffff';
  const numRows = (lastDataRow - firstDataRow + 1);

  for (let i = 0; i < colPlan.length; i++){
    const cd = colPlan[i];
    if (!cd || cd.kind !== 'quarter_total') continue;

    const sheetCol = (startCol + 1) + i;
    const range = sh.getRange(firstDataRow, sheetCol, numRows, 1);

    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(Number(threshold))
      .setBackground(red)
      .setFontColor(white)
      .setRanges([range])
      .build();

    rules.push(rule);
  }

  sh.setConditionalFormatRules(rules);
}

/* ===================== PLATFORM TABLE (LEFT / OLD) ===================== */

function writePlatformBlock_(sh, startRow, title, releases, counts, cutoffs, meta){
  const planObj = buildColumnPlan_(releases, cutoffs);
  const colPlan = planObj.plan;
  const qSpans  = planObj.qSpans;

  const width = 1 + colPlan.length;

  const rowKeys = Object.keys(counts || {});
  rowKeys.sort((a,b)=>{
    const baseA = (a.split(' | ')[0]||'').trim().toLowerCase();
    const baseB = (b.split(' | ')[0]||'').trim().toLowerCase();
    return baseA.localeCompare(baseB) || a.toLowerCase().localeCompare(b.toLowerCase());
  });

  const approxRows = (startRow + 2) + (3 + rowKeys.length + 1) + 2;
  ensureGrid_(sh, approxRows, width + 2);

  // заголовок платформы только в A
  sh.getRange(startRow, 1).setValue(title).setFontWeight('bold').setFontSize(14);

  const matrix = [];

  const quarterRow = new Array(width).fill('');
  quarterRow[0] = '';
  for (const [c1, _c2, qnum] of qSpans){
    quarterRow[c1] = 'Q' + qnum;
  }
  matrix.push(quarterRow);

  const header = ['Стрим'].concat(colPlan.map(cd => cd.kind === 'release' ? ("'" + cd.label) : cd.label));
  matrix.push(header);

  const subheader = [''].concat(colPlan.map((cd,i)=> i===0 ? 'количество черепиков' : ''));
  matrix.push(subheader);

  for (const rk of rowKeys){
    const row = [rk];
    for (const cd of colPlan){
      if(cd.kind === 'release'){
        row.push(Number((counts[rk]||{})[cd.label]||0) || '');
      }else{
        row.push('');
      }
    }
    matrix.push(row);
  }

  const totalRowArr = ['ИТОГО'].concat(colPlan.map(_=>''));
  matrix.push(totalRowArr);

  const tableStartRow = startRow + 2;

  ensureGrid_(sh, tableStartRow + matrix.length + 2, width + 2);

  sh.getRange(tableStartRow, 1, matrix.length, width).setValues(matrix);

  const qRow = tableStartRow;
  for (const [c1,c2,_qnum] of qSpans){
    const fromCol = 1 + c1;
    const span = (c2 - c1 + 1);
    if(span > 1){
      sh.getRange(qRow, fromCol, 1, span).merge();
    }
  }

  sh.getRange(tableStartRow, 1, 1, width).setFontWeight('bold');
  sh.getRange(tableStartRow + 1, 1, 1, width).setFontWeight('bold');
  sh.getRange(tableStartRow + 2, 1, 1, width).setFontWeight('bold');

  const firstDataRow = tableStartRow + 3;
  const totalRow = firstDataRow + rowKeys.length;
  const lastDataRow = totalRow - 1;

  const planToSheetCol = (i)=> 2 + i;
  const monthRangeForCol = buildMonthRanges_(colPlan);
  const quarterRangesForCol = buildQuarterRanges_(colPlan);

  for (let r = firstDataRow; r <= lastDataRow; r++){
    for (let i=0;i<colPlan.length;i++){
      const cd = colPlan[i];
      const c = planToSheetCol(i);

      if(cd.kind === 'month_total'){
        const ranges = monthRangeForCol[i] || [];
        if(ranges.length){
          const [a,b] = ranges[0];
          const a1 = a1range_(r,a,r,b);
          sh.getRange(r,c).setFormula('=SUM(' + a1 + ')');
        }
      }else if(cd.kind === 'quarter_total'){
        const ranges = quarterRangesForCol[i] || [];
        if(ranges.length){
          const expr = ranges.map(([a,b])=>'SUM(' + a1range_(r,a,r,b) + ')').join('+');
          sh.getRange(r,c).setFormula('=' + expr);
        }
      }
    }
  }

  for (let i=0;i<colPlan.length;i++){
    const c = planToSheetCol(i);
    const colA1 = a1range_(firstDataRow, c, lastDataRow, c);
    sh.getRange(totalRow, c).setFormula('=SUM(' + colA1 + ')');
  }
  sh.getRange(totalRow, 1).setFontWeight('bold');

  sh.getRange(tableStartRow, 1, matrix.length, width).setBorder(true,true,true,true,true,true);

  // подсветка колонок ИТОГО
  shadeTotalsColumns_(sh, tableStartRow, matrix.length, colPlan);

  // правило “квартал > 20” (только строки стримов)
  applyQuarterThresholdFormatting_(sh, firstDataRow, lastDataRow, colPlan, 20);

  if(meta && typeof meta === 'object'){
    meta.blockStartRow = startRow;
    meta.width = width;
    meta.cutoffs = cutoffs || {};
    meta.tableStartRow = tableStartRow;
    meta.tableEndRow = tableStartRow + matrix.length - 1;
  }

  return tableStartRow + matrix.length;
}

/* ===================== GROUPED TABLE (RIGHT) ===================== */

function writeGroupedRightTable_(sh, startRow, startCol, releases, groupedCounts, cutoffs, threshold){
  const planObj = buildColumnPlan_(releases, cutoffs);
  const colPlan = planObj.plan;
  const qSpans  = planObj.qSpans;

  const width = 1 + colPlan.length;

  const rowKeys = Object.keys(groupedCounts || {});
  rowKeys.sort((a,b)=>{
    const baseA = (a.split(' | ')[0]||'').trim().toLowerCase();
    const baseB = (b.split(' | ')[0]||'').trim().toLowerCase();
    return baseA.localeCompare(baseB) || a.toLowerCase().localeCompare(b.toLowerCase());
  });

  const matrix = [];

  const quarterRow = new Array(width).fill('');
  quarterRow[0] = '';
  for (const [c1, _c2, qnum] of qSpans){
    quarterRow[c1] = 'Q' + qnum;
  }
  matrix.push(quarterRow);

  const header = ['Стрим'].concat(colPlan.map(cd => cd.kind === 'release' ? ("'" + cd.label) : cd.label));
  matrix.push(header);

  const subheader = [''].concat(colPlan.map((cd,i)=> i===0 ? 'количество черепиков' : ''));
  matrix.push(subheader);

  for (const rk of rowKeys){
    const row = [rk];
    for (const cd of colPlan){
      if(cd.kind === 'release'){
        row.push(Number((groupedCounts[rk]||{})[cd.label]||0) || '');
      }else{
        row.push('');
      }
    }
    matrix.push(row);
  }

  const totalRowArr = ['ИТОГО'].concat(colPlan.map(_=>''));
  matrix.push(totalRowArr);

  ensureGrid_(sh, startRow + matrix.length + 2, startCol + width + 2);

  sh.getRange(startRow, startCol, matrix.length, width).setValues(matrix);

  // merge quarter spans
  const qRow = startRow;
  for (const [c1,c2,_qnum] of qSpans){
    const fromCol = startCol + (c1 - 1);
    const span = (c2 - c1 + 1);
    if (span > 1){
      sh.getRange(qRow, fromCol, 1, span).merge();
    }
  }

  sh.getRange(startRow, startCol, 1, width).setFontWeight('bold');
  sh.getRange(startRow + 1, startCol, 1, width).setFontWeight('bold');
  sh.getRange(startRow + 2, startCol, 1, width).setFontWeight('bold');

  const firstDataRow = startRow + 3;
  const totalRow = firstDataRow + rowKeys.length;
  const lastDataRow = totalRow - 1;

  // ranges maps built for startCol=1 → offset columns
  const offset = startCol - 1;
  const monthRangeForColBase = buildMonthRanges_(colPlan);
  const quarterRangesForColBase = buildQuarterRanges_(colPlan);

  for (let r = firstDataRow; r <= lastDataRow; r++){
    for (let i=0;i<colPlan.length;i++){
      const cd = colPlan[i];
      const c = (startCol + 1) + i;

      if(cd.kind === 'month_total'){
        const ranges = (monthRangeForColBase[i] || []).map(([a,b])=>[a+offset,b+offset]);
        if(ranges.length){
          const [a,b] = ranges[0];
          const a1 = a1range_(r,a,r,b);
          sh.getRange(r,c).setFormula('=SUM(' + a1 + ')');
        }
      }else if(cd.kind === 'quarter_total'){
        const ranges = (quarterRangesForColBase[i] || []).map(([a,b])=>[a+offset,b+offset]);
        if(ranges.length){
          const expr = ranges.map(([a,b])=>'SUM(' + a1range_(r,a,r,b) + ')').join('+');
          sh.getRange(r,c).setFormula('=' + expr);
        }
      }
    }
  }

  for (let i=0;i<colPlan.length;i++){
    const c = (startCol + 1) + i;
    const colA1 = a1range_(firstDataRow, c, lastDataRow, c);
    sh.getRange(totalRow, c).setFormula('=SUM(' + colA1 + ')');
  }
  sh.getRange(totalRow, startCol).setFontWeight('bold');

  sh.getRange(startRow, startCol, matrix.length, width).setBorder(true,true,true,true,true,true);

  shadeTotalsColumnsAt_(sh, startRow, startCol, matrix.length, colPlan);
  applyQuarterThresholdFormattingAt_(sh, firstDataRow, lastDataRow, startCol, colPlan, Number(threshold || 20));
}

/* ===================== PLAN / RANGES ===================== */

function buildColumnPlan_(releases, cutoffs){
  const plan = [];
  const qSpans = [];

  let currentQ=null;
  let qStart=null;
  let curMonth=null;
  let planColIdx=1;

  const closeMonth=(qnum,mnum)=>{
    if(mnum!=null){
      plan.push({kind:'month_total', label:'ИТОГО ' + (RU_MONTH_ABBR[mnum]||''), q:qnum, m:mnum});
    }
  };
  const closeQuarter=(qnum)=>{
    plan.push({kind:'quarter_total', label:'ИТОГО Q'+qnum, q:qnum});
  };

  for(const rel of releases){
    const iso = (cutoffs||{})[rel];
    const mnum = monthFromIso_(iso) ?? (curMonth ?? 10);
    const qnum = quarterFromMonth_(mnum);

    if(currentQ===null){
      currentQ=qnum; qStart=planColIdx; curMonth=mnum;
    }else if(qnum!==currentQ){
      closeMonth(currentQ,curMonth); planColIdx++;
      closeQuarter(currentQ); planColIdx++;
      qSpans.push([qStart, planColIdx-1, currentQ]);
      currentQ=qnum; qStart=planColIdx; curMonth=mnum;
    }

    if(mnum!==curMonth){
      closeMonth(currentQ,curMonth); planColIdx++;
      curMonth=mnum;
    }

    plan.push({kind:'release', label:rel, q:currentQ, m:curMonth});
    planColIdx++;
  }

  if(currentQ!==null){
    closeMonth(currentQ,curMonth); planColIdx++;
    closeQuarter(currentQ); planColIdx++;
    qSpans.push([qStart, planColIdx-1, currentQ]);
  }

  return { plan, qSpans };
}

function buildMonthRanges_(plan){
  const out = {};
  const toSheetCol = (i)=>2+i;

  for(let i=0;i<plan.length;i++){
    const cd=plan[i];
    if(cd.kind!=='month_total') continue;

    let left=null;
    for(let j=i-1;j>=0;j--){
      const p=plan[j];
      if(p.kind==='release' && p.q===cd.q && p.m===cd.m){
        left = (left===null) ? toSheetCol(j) : Math.min(left,toSheetCol(j));
      }else if(p.kind==='month_total' || p.kind==='quarter_total'){
        break;
      }
    }
    if(left===null) continue;
    const right = toSheetCol(i-1);
    out[i] = [[left,right]];
  }
  return out;
}

function buildQuarterRanges_(plan){
  const out = {};
  const toSheetCol = (i)=>2+i;

  for(let i=0;i<plan.length;i++){
    const cd=plan[i];
    if(cd.kind!=='quarter_total') continue;

    const q=cd.q;
    const ranges=[];
    let runStart=null;
    let prev=null;

    for(let j=0;j<i;j++){
      const p=plan[j];
      if(p.kind==='release' && p.q===q){
        const col=toSheetCol(j);
        if(runStart===null){ runStart=col; prev=col; }
        else if(col===prev+1){ prev=col; }
        else { ranges.push([runStart,prev]); runStart=col; prev=col; }
      }else{
        if(runStart!==null){ ranges.push([runStart,prev]); runStart=null; prev=null; }
      }
    }
    if(runStart!==null) ranges.push([runStart,prev]);
    if(ranges.length) out[i]=ranges;
  }
  return out;
}

/* ===================== GROUPING / CUTOFFS ===================== */

function baseStreamName_(name){
  const s = String(name || '').trim();
  if (!s) return s;
  const parts = s.split('|');
  return String(parts[0] || '').trim() || s;
}

function groupCountsByBase_(counts, releases){
  const out = {};
  const rels = Array.isArray(releases) ? releases.map(String) : [];

  for (const k in (counts || {})){
    const base = baseStreamName_(k);
    if (!out[base]) out[base] = {};
    const row = counts[k] || {};
    for (const rel of rels){
      out[base][rel] = Number(out[base][rel] || 0) + Number(row[rel] || 0);
    }
  }
  return out;
}

function mergeCutoffs_(releases, andCutoffs, iosCutoffs){
  const out = {};
  const rels = Array.isArray(releases) ? releases.map(String) : [];
  const a = andCutoffs || {};
  const b = iosCutoffs || {};
  for (const rel of rels){
    out[rel] = a[rel] || b[rel] || null;
  }
  return out;
}

/* ===================== HELPERS ===================== */

function monthFromIso_(iso){
  if(!iso) return null;
  const d = new Date(iso);
  if(isNaN(d)) return null;
  return d.getMonth()+1;
}
function quarterFromMonth_(m){
  if(!m) return 1;
  if(m<=3) return 1;
  if(m<=6) return 2;
  if(m<=9) return 3;
  return 4;
}
function a1range_(r1,c1,r2,c2){
  return toA1_(r1,c1) + ':' + toA1_(r2,c2);
}
function toA1_(r,c){
  const col = columnToLetter_(c);
  return col + r;
}
function columnToLetter_(column){
  let temp, letter = '';
  while (column > 0){
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

function normalizePayload_(payload){
  const relsRaw = Array.isArray(payload.releases) ? payload.releases : [];
  const releases = relsRaw.map(String);

  return {
    releases,
    and_counts: payload.and_counts || {},
    ios_counts: payload.ios_counts || {},
    and_cutoffs: payload.and_cutoffs || {},
    ios_cutoffs: payload.ios_cutoffs || {}
  };
}

function parseBody_(e){
  if(!e || !e.postData) return {};
  const ctype = (e.postData.type || '').toLowerCase();
  const txt = e.postData.contents || '';
  if(ctype.indexOf('application/json')>=0){
    return JSON.parse(txt || '{}');
  }
  try{ return JSON.parse(txt || '{}'); }catch(_){}
  return { raw: txt };
}

function json_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
