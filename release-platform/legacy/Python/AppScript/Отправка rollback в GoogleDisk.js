const BUILD = '2026-04-06_band_rollout_disk_v1';

const TARGET_SPREADSHEET_ID = '1to6NsQ4bj7l266OobbK0yDH_ha0A1HFs-wsrr1pbvEQ';
const SHEET_NAMES = {
  android: 'Android 2026',
  ios: 'iOS 2026'
};

function jsonOut_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeJsonParse_(text) {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function normalizePlatform_(value) {
  return String(value || '').trim().toLowerCase() === 'ios' ? 'ios' : 'android';
}

function getSheetName_(payload, platform) {
  const expected = SHEET_NAMES[platform] || SHEET_NAMES.android;
  const explicit = String(payload && payload.sheetName || '').trim();
  if (!explicit) return expected;
  if (explicit !== expected) {
    throw new Error('Unexpected sheetName for platform.');
  }
  return explicit;
}

function getTargetSpreadsheetId_(payload) {
  const explicit = String(payload && payload.spreadsheetId || '').trim();
  if (!explicit) return TARGET_SPREADSHEET_ID;
  if (explicit !== TARGET_SPREADSHEET_ID) {
    throw new Error('Unexpected spreadsheetId.');
  }
  return explicit;
}

function buildMatrix_(payload) {
  const columns = Array.isArray(payload && payload.columns)
    ? payload.columns.map((value) => String(value == null ? '' : value))
    : [];
  if (!columns.length) {
    throw new Error('Payload.columns is required.');
  }

  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const values = rows.map((row) => {
    if (Array.isArray(row)) {
      return columns.map((_, index) => String(row[index] == null ? '' : row[index]));
    }
    if (row && typeof row === 'object') {
      return columns.map((column) => String(row[column] == null ? '' : row[column]));
    }
    return columns.map(() => '');
  });

  return [columns].concat(values);
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  const existing = spreadsheet.getSheetByName(sheetName);
  if (existing) return existing;
  return spreadsheet.insertSheet(sheetName);
}

function formatSheet_(sheet, rowCount, columnCount) {
  if (rowCount < 1 || columnCount < 1) return;

  const fullRange = sheet.getRange(1, 1, rowCount, columnCount);
  const headerRange = sheet.getRange(1, 1, 1, columnCount);
  const filter = sheet.getFilter();

  if (filter) filter.remove();

  sheet.setFrozenRows(1);
  fullRange.setWrap(false);
  try {
    fullRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  } catch (_) {}
  fullRange.setHorizontalAlignment('left');
  fullRange.setVerticalAlignment('top');
  sheet.setRowHeight(1, 24);
  if (rowCount > 1) {
    sheet.setRowHeights(2, rowCount - 1, 21);
  }

  headerRange
    .setFontWeight('bold')
    .setBackground('#eef2ff')
    .setFontColor('#1f2937')
    .setHorizontalAlignment('left');

  if (rowCount > 1) {
    fullRange.createFilter();
  }

  sheet.autoResizeColumns(1, columnCount);
}

function doGet() {
  const spreadsheet = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  return jsonOut_({
    ok: true,
    build: BUILD,
    spreadsheetId: TARGET_SPREADSHEET_ID,
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: SHEET_NAMES
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      throw new Error('POST body is required.');
    }

    const parsed = safeJsonParse_(e.postData.contents);
    if (!parsed.ok) {
      throw new Error('Invalid JSON: ' + parsed.error);
    }

    const body = parsed.data || {};
    const payload = body && typeof body === 'object' && body.payload && typeof body.payload === 'object'
      ? body.payload
      : body;

    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload object is required.');
    }

    const platform = normalizePlatform_(payload.platform);
    const spreadsheetId = getTargetSpreadsheetId_(payload);
    const sheetName = getSheetName_(payload, platform);
    const matrix = buildMatrix_(payload);
    const rowCount = matrix.length;
    const columnCount = matrix[0] ? matrix[0].length : 0;

    if (!rowCount || !columnCount) {
      throw new Error('Nothing to write.');
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = getOrCreateSheet_(spreadsheet, sheetName);

    sheet.clear();
    const targetRange = sheet.getRange(1, 1, rowCount, columnCount);
    targetRange.setNumberFormat('@');
    targetRange.setValues(matrix);
    formatSheet_(sheet, rowCount, columnCount);

    return jsonOut_({
      ok: true,
      build: BUILD,
      platform: platform,
      spreadsheetId: spreadsheetId,
      spreadsheetUrl: spreadsheet.getUrl(),
      sheetName: sheetName,
      sheetUrl: spreadsheet.getUrl() + '#gid=' + sheet.getSheetId(),
      rowsWritten: rowCount - 1,
      columnsWritten: columnCount,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return jsonOut_({
      ok: false,
      build: BUILD,
      error: String(error && error.message ? error.message : error)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function authorizeOnce() {
  const spreadsheet = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  Logger.log('Build: ' + BUILD);
  Logger.log('Spreadsheet: ' + spreadsheet.getName());
  Logger.log('Sheets: ' + spreadsheet.getSheets().map((sheet) => sheet.getName()).join(', '));
}
