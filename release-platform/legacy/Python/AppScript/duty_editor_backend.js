const DUTY_EDITOR_DOC_ID = '1glaEFkdpAzGuRyQZYz1muBzVkFOnKyn85BW-CXLFSFU';
const DUTY_EDITOR_LEADS_FILE_ID = '1Arzm2ZEix5aVyp0lqAFeZxLnDnkfkkUb';
const DUTY_EDITOR_BUILD = 'duty-editor-2026-04-15-1';
const RELEASE_STREAMS_SPREADSHEET_ID = '1W7fNhN5BD-ItG03za-U2-uPotvDfiZbt_baiyZXgLpI';
const RELEASE_STREAMS_TEMPLATE_CODE = '759';
const RELEASE_STREAMS_SHEET_SUFFIX = 'iOS+Android';
const RELEASE_STREAMS_MONDAY_HEADER = 'ПОНЕДЕЛЬНИК';
const RELEASE_STREAMS_TUESDAY_HEADER = 'ВТОРНИК';
const RELEASE_STREAMS_SECTION_DATA_OFFSET = 3;
const RELEASE_STREAMS_TIME_COLUMNS_START = 3;
const RELEASE_STREAMS_TIME_COLUMNS_COUNT = 14;
const RELEASE_STREAMS_MAX_FORMAT_COLUMN = 27;

const STREAMS_JSON_START_MARKER = 'WB_STREAMS_JSON_START';
const STREAMS_JSON_END_MARKER = 'WB_STREAMS_JSON_END';

function doGet(e) {
  try {
    const op = normalizeOp_((e && e.parameter && e.parameter.op) || '');

    if (!op) {
      return jsonResponse_(readLeadsFile_());
    }

    if (isDutyEditorReadOp_(op)) {
      return jsonResponse_({
        ok: true,
        build: DUTY_EDITOR_BUILD,
        data: readDutyEditorSnapshot_()
      });
    }

    if (op === 'ping') {
      return jsonResponse_({
        ok: true,
        build: DUTY_EDITOR_BUILD,
        op: op
      });
    }

    return jsonError_('Unsupported op: ' + op);
  } catch (error) {
    return jsonError_(toErrorText_(error));
  }
}

function doPost(e) {
  try {
    const body = parseJsonBody_(e);
    const op = normalizeOp_(body.op || '');

    if (isReleaseStreamsSheetCheckOp_(op)) {
      return jsonResponse_({
        ok: true,
        build: DUTY_EDITOR_BUILD,
        data: checkReleaseStreamsSheet_(body)
      });
    }

    if (isReleaseStreamsSheetEnsureOp_(op)) {
      return jsonResponse_({
        ok: true,
        build: DUTY_EDITOR_BUILD,
        data: ensureReleaseStreamsSheet_(body)
      });
    }

    if (isDutyEditorSaveOp_(op)) {
      return jsonResponse_({
        ok: true,
        build: DUTY_EDITOR_BUILD,
        data: saveDutyEditorSnapshot_(body)
      });
    }

    return jsonError_('Unsupported op: ' + op);
  } catch (error) {
    return jsonError_(toErrorText_(error));
  }
}

function readDutyEditorSnapshot_() {
  const doc = DocumentApp.openById(DUTY_EDITOR_DOC_ID);
  const body = doc.getBody();

  return {
    leads: readLeadsFile_(),
    streamsTree: extractStreamsTreeFromBody_(body),
    tables: collectDocTables_(body),
    meta: {
      docId: DUTY_EDITOR_DOC_ID,
      leadsFileId: DUTY_EDITOR_LEADS_FILE_ID,
      loadedAt: new Date().toISOString()
    }
  };
}

function saveDutyEditorSnapshot_(payload) {
  const leads = normalizeLeads_(payload.leads);
  const streamsTree = normalizeStreamTree_(payload.streamsTree);
  const tables = normalizeTables_(payload.tables);

  writeLeadsFile_(leads);

  const doc = DocumentApp.openById(DUTY_EDITOR_DOC_ID);
  const body = doc.getBody();

  replaceStreamsTreeInBody_(body, streamsTree);
  if (tables.length) {
    writeDocTables_(body, tables);
  }
  const snapshot = {
    leads: leads,
    streamsTree: streamsTree,
    tables: collectDocTables_(body),
    meta: {
      docId: DUTY_EDITOR_DOC_ID,
      leadsFileId: DUTY_EDITOR_LEADS_FILE_ID,
      savedAt: new Date().toISOString()
    }
  };
  doc.saveAndClose();

  return snapshot;
}

function readLeadsFile_() {
  const file = DriveApp.getFileById(DUTY_EDITOR_LEADS_FILE_ID);
  const text = file.getBlob().getDataAsString('utf-8');
  const parsed = JSON.parse(stripBom_(text));
  return normalizeLeads_(parsed);
}

function writeLeadsFile_(leads) {
  const file = DriveApp.getFileById(DUTY_EDITOR_LEADS_FILE_ID);
  file.setContent(JSON.stringify(normalizeLeads_(leads), null, 2));
}

function collectDocTables_(body) {
  const out = [];
  let lastTitle = '';
  const totalChildren = body.getNumChildren();

  for (let i = 0; i < totalChildren; i += 1) {
    const child = body.getChild(i);
    const type = child.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      const text = String(readTextFromBodyChild_(child) || '').trim();
      if (text) lastTitle = text;
      continue;
    }

    if (type !== DocumentApp.ElementType.TABLE) continue;

    const table = child.asTable();
    const rows = [];
    for (let rowIndex = 0; rowIndex < table.getNumRows(); rowIndex += 1) {
      const row = table.getRow(rowIndex);
      const cells = [];
      for (let cellIndex = 0; cellIndex < row.getNumCells(); cellIndex += 1) {
        cells.push(String(row.getCell(cellIndex).getText() || ''));
      }
      rows.push(cells);
    }

    out.push({
      title: lastTitle || ('Table ' + (out.length + 1)),
      rows: rows
    });
  }

  return out;
}

function readTextFromBodyChild_(child) {
  const type = child.getType();
  if (type === DocumentApp.ElementType.PARAGRAPH) {
    return child.asParagraph().getText();
  }
  if (type === DocumentApp.ElementType.LIST_ITEM) {
    return child.asListItem().getText();
  }
  return '';
}

function writeDocTables_(body, tables) {
  const docTables = body.getTables();
  if (docTables.length !== tables.length) {
    throw new Error('Table count mismatch: doc=' + docTables.length + ', payload=' + tables.length);
  }

  for (let tableIndex = 0; tableIndex < docTables.length; tableIndex += 1) {
    const docTable = docTables[tableIndex];
    const payloadTable = tables[tableIndex];
    const rows = Array.isArray(payloadTable.rows) ? payloadTable.rows : [];

    if (docTable.getNumRows() !== rows.length) {
      throw new Error('Row count mismatch in table ' + (tableIndex + 1));
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const docRow = docTable.getRow(rowIndex);
      const payloadRow = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];

      if (docRow.getNumCells() !== payloadRow.length) {
        throw new Error('Cell count mismatch in table ' + (tableIndex + 1) + ', row ' + (rowIndex + 1));
      }

      for (let cellIndex = 0; cellIndex < payloadRow.length; cellIndex += 1) {
        docRow.getCell(cellIndex).editAsText().setText(String(payloadRow[cellIndex] == null ? '' : payloadRow[cellIndex]));
      }
    }
  }
}

function extractStreamsTreeFromBody_(body) {
  const text = String(body.getText() || '');
  const tagged = extractTaggedJsonBlock_(text);
  if (tagged) {
    return normalizeStreamTree_(JSON.parse(tagged));
  }

  const candidate = findBestJsonCandidate_(text);
  if (!candidate) {
    throw new Error('Streams JSON was not found in Google Doc');
  }
  return normalizeStreamTree_(JSON.parse(candidate.text));
}

function replaceStreamsTreeInBody_(body, streamsTree) {
  const formattedJson = JSON.stringify(normalizeStreamTree_(streamsTree), null, 2);
  const edit = body.editAsText();
  const text = String(edit.getText() || '');

  const markerRange = findTaggedJsonRange_(text);
  if (markerRange) {
    edit.deleteText(markerRange.contentStart, markerRange.contentEnd);
    edit.insertText(markerRange.contentStart, '\n' + formattedJson + '\n');
    return;
  }

  const candidate = findBestJsonCandidate_(text);
  if (!candidate) {
    throw new Error(
      'Streams JSON was not found in Google Doc. ' +
      'Add markers ' + STREAMS_JSON_START_MARKER + ' / ' + STREAMS_JSON_END_MARKER + ' around the JSON block.'
    );
  }

  edit.deleteText(candidate.start, candidate.end);
  edit.insertText(candidate.start, formattedJson);
}

function extractTaggedJsonBlock_(text) {
  const range = findTaggedJsonRange_(String(text || ''));
  if (!range) return '';
  return text.slice(range.contentStart, range.contentEnd + 1).trim();
}

function findTaggedJsonRange_(text) {
  const source = String(text || '');
  const startMarkerPos = source.indexOf(STREAMS_JSON_START_MARKER);
  const endMarkerPos = source.indexOf(STREAMS_JSON_END_MARKER);
  if (startMarkerPos === -1 || endMarkerPos === -1 || endMarkerPos <= startMarkerPos) {
    return null;
  }

  const contentStart = startMarkerPos + STREAMS_JSON_START_MARKER.length;
  const contentEnd = endMarkerPos - 1;
  return {
    contentStart: contentStart,
    contentEnd: contentEnd
  };
}

function findBestJsonCandidate_(text) {
  const candidates = scanJsonCandidates_(String(text || ''));
  let best = null;
  let bestScore = -1;

  candidates.forEach(function(candidate) {
    try {
      const parsed = JSON.parse(candidate.text);
      const score = scoreStreamTreeCandidate_(parsed);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    } catch (error) {
    }
  });

  return best;
}

function scanJsonCandidates_(text) {
  const out = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString && ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === '}') {
      if (depth <= 0) continue;
      depth -= 1;
      if (depth === 0 && start !== -1) {
        out.push({
          start: start,
          end: i,
          text: text.slice(start, i + 1)
        });
        start = -1;
      }
    }
  }

  return out;
}

function scoreStreamTreeCandidate_(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return -1;

  const keys = Object.keys(value);
  if (!keys.length) return -1;

  let score = 0;
  if (Object.prototype.hasOwnProperty.call(value, 'Excluded')) score += 50;

  keys.forEach(function(key) {
    if (!Array.isArray(value[key])) return;
    score += 5;
    if (value[key].every(function(item) { return typeof item === 'string'; })) {
      score += 10;
    }
  });

  return score;
}

function normalizeLeads_(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Leads JSON must be an object');
  }

  const out = {};
  Object.keys(raw).forEach(function(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;

    const value = raw[key];
    if (Array.isArray(value)) {
      out[normalizedKey] = value
        .map(function(item) { return String(item || '').trim(); })
        .filter(Boolean);
      return;
    }

    const single = String(value || '').trim();
    out[normalizedKey] = single ? [single] : [];
  });

  return out;
}

function normalizeStreamTree_(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Streams JSON must be an object');
  }

  const out = {};
  Object.keys(raw).forEach(function(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;

    const value = raw[key];
    if (!Array.isArray(value)) {
      throw new Error('Streams JSON values must be arrays. Broken key: ' + normalizedKey);
    }

    out[normalizedKey] = value
      .map(function(item) { return String(item || '').trim(); })
      .filter(Boolean);
  });

  return out;
}

function normalizeTables_(raw) {
  if (!Array.isArray(raw)) return [];

  return raw.map(function(table, tableIndex) {
    const rows = Array.isArray(table && table.rows) ? table.rows : [];
    return {
      title: String((table && table.title) || ('Table ' + (tableIndex + 1))).trim() || ('Table ' + (tableIndex + 1)),
      rows: rows.map(function(row) {
        return Array.isArray(row)
          ? row.map(function(cell) { return String(cell == null ? '' : cell); })
          : [];
      })
    };
  });
}

function checkReleaseStreamsSheet_(payload) {
  const releaseCode = releaseToStreamsSheetCode_(payload && payload.release);
  const spreadsheet = SpreadsheetApp.openById(RELEASE_STREAMS_SPREADSHEET_ID);
  const sheet = findReleaseStreamsSheetByCode_(spreadsheet, releaseCode);
  return buildReleaseStreamsSheetResponse_(spreadsheet, releaseCode, sheet, false);
}

function ensureReleaseStreamsSheet_(payload) {
  const releaseCode = releaseToStreamsSheetCode_(payload && payload.release);
  const expectedFinish = String(payload && payload.expectedFinish || '').trim();
  const streams = normalizeReleaseStreamsList_(payload && payload.streams);
  if (!streams.length) {
    throw new Error('Streams list is empty');
  }

  const spreadsheet = SpreadsheetApp.openById(RELEASE_STREAMS_SPREADSHEET_ID);
  const existingSheet = findReleaseStreamsSheetByCode_(spreadsheet, releaseCode);
  if (existingSheet) {
    return buildReleaseStreamsSheetResponse_(spreadsheet, releaseCode, existingSheet, false);
  }

  const templateSheet = findReleaseStreamsTemplateSheet_(spreadsheet);
  if (!templateSheet) {
    throw new Error('Template sheet ' + RELEASE_STREAMS_TEMPLATE_CODE + ' was not found');
  }

  const sheet = templateSheet.copyTo(spreadsheet);
  sheet.setName(makeReleaseStreamsSheetName_(releaseCode));
  spreadsheet.setActiveSheet(sheet);
  spreadsheet.moveActiveSheet(spreadsheet.getNumSheets());

  populateReleaseStreamsSheet_(sheet, releaseCode, expectedFinish, streams);
  SpreadsheetApp.flush();

  return buildReleaseStreamsSheetResponse_(spreadsheet, releaseCode, sheet, true);
}

function buildReleaseStreamsSheetResponse_(spreadsheet, releaseCode, sheet, created) {
  const hasSheet = !!sheet;
  return {
    releaseCode: releaseCode,
    exists: hasSheet,
    created: !!created,
    sheetName: hasSheet ? sheet.getName() : '',
    sheetId: hasSheet ? sheet.getSheetId() : null,
    sheetUrl: hasSheet ? buildReleaseStreamsSheetUrl_(spreadsheet, sheet) : ''
  };
}

function populateReleaseStreamsSheet_(sheet, releaseCode, expectedFinish, streams) {
  sheet.getRange('C1').setValue(releaseCode + ' (Данные по продуктовым командам)');
  setReleaseStreamsExpectedFinish_(sheet.getRange('E1'), expectedFinish);
  rebuildReleaseStreamsDaySection_(sheet, RELEASE_STREAMS_MONDAY_HEADER, streams, RELEASE_STREAMS_TUESDAY_HEADER);
  rebuildReleaseStreamsDaySection_(sheet, RELEASE_STREAMS_TUESDAY_HEADER, streams, '');
}

function setReleaseStreamsExpectedFinish_(cell, rawValue) {
  const parsed = parseReleaseStreamsExpectedFinish_(rawValue);
  if (parsed) {
    cell.setValue(parsed.value);
    if (parsed.hasTime) {
      cell.setNumberFormat('dd/MM HH:mm');
    } else {
      cell.setNumberFormat('dd/MM');
    }
    return;
  }
  cell.setNumberFormat('@');
  cell.setValue(String(rawValue || '').trim());
}

function parseReleaseStreamsExpectedFinish_(value) {
  const source = String(value || '').trim();
  if (!source) return null;

  const match = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = normalizeReleaseStreamsYear_(match[3]);
  const hours = match[4] == null ? 0 : Number(match[4]);
  const minutes = match[5] == null ? 0 : Number(match[5]);

  if (!isFinite(day) || !isFinite(month) || !isFinite(year) || !isFinite(hours) || !isFinite(minutes)) {
    return null;
  }

  return {
    value: new Date(year, month, day, hours, minutes, 0, 0),
    hasTime: match[4] != null
  };
}

function normalizeReleaseStreamsYear_(yearText) {
  const rawYear = Number(yearText);
  if (!isFinite(rawYear)) return rawYear;
  if (String(yearText).length === 2) {
    return rawYear >= 70 ? (1900 + rawYear) : (2000 + rawYear);
  }
  return rawYear;
}

function rebuildReleaseStreamsDaySection_(sheet, sectionHeader, streams, nextSectionHeader) {
  const sectionHeaderRow = findReleaseStreamsHeaderRow_(sheet, sectionHeader);
  if (!sectionHeaderRow) {
    throw new Error('Section header not found: ' + sectionHeader);
  }

  const dataStartRow = sectionHeaderRow + RELEASE_STREAMS_SECTION_DATA_OFFSET;
  const nextSectionRow = nextSectionHeader ? findReleaseStreamsHeaderRow_(sheet, nextSectionHeader) : 0;
  const existingRows = nextSectionRow
    ? Math.max(0, nextSectionRow - dataStartRow)
    : Math.max(0, findReleaseStreamsSectionEndRow_(sheet, dataStartRow) - dataStartRow + 1);
  const targetRows = streams.length * 2;

  if (existingRows < 2 || existingRows % 2 !== 0) {
    throw new Error('Broken template rows count in section ' + sectionHeader + ': ' + existingRows);
  }

  if (existingRows < targetRows) {
    const delta = targetRows - existingRows;
    if (nextSectionRow) {
      sheet.insertRowsBefore(nextSectionRow, delta);
    } else {
      sheet.insertRowsAfter(dataStartRow + existingRows - 1, delta);
    }
  } else if (existingRows > targetRows) {
    sheet.deleteRows(dataStartRow + targetRows, existingRows - targetRows);
  }

  applyReleaseStreamsSectionRows_(sheet, dataStartRow, streams);
}

function applyReleaseStreamsSectionRows_(sheet, dataStartRow, streams) {
  const targetRows = streams.length * 2;
  if (!targetRows) return;

  const formatRange = sheet.getRange(dataStartRow, 1, 2, RELEASE_STREAMS_MAX_FORMAT_COLUMN);
  const iosRowHeight = sheet.getRowHeight(dataStartRow);
  const androidRowHeight = sheet.getRowHeight(dataStartRow + 1);

  sheet.getRange(dataStartRow, 1, targetRows, 1).breakApart();
  sheet.getRange(dataStartRow, RELEASE_STREAMS_TIME_COLUMNS_START, targetRows, RELEASE_STREAMS_TIME_COLUMNS_COUNT).clearContent();

  streams.forEach(function(streamName, index) {
    const row = dataStartRow + (index * 2);
    formatRange.copyTo(
      sheet.getRange(row, 1, 2, RELEASE_STREAMS_MAX_FORMAT_COLUMN),
      SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
      false
    );
    sheet.setRowHeight(row, iosRowHeight);
    sheet.setRowHeight(row + 1, androidRowHeight);
    sheet.getRange(row, 1, 2, 1).breakApart();
    sheet.getRange(row, 2, 2, 1).setValues([['iOS'], ['Android']]);
    sheet.getRange(row, RELEASE_STREAMS_TIME_COLUMNS_START, 2, RELEASE_STREAMS_TIME_COLUMNS_COUNT).clearContent();
    sheet.getRange(row, 1, 2, 1).merge();
    sheet.getRange(row, 1).setValue(streamName);
  });
}

function normalizeReleaseStreamsList_(raw) {
  const out = [];
  const seen = {};

  (Array.isArray(raw) ? raw : []).forEach(function(item) {
    const value = String(item || '').trim();
    const key = value.toLowerCase();
    if (!value || seen[key]) return;
    seen[key] = true;
    out.push(value);
  });

  return out;
}

function releaseToStreamsSheetCode_(release) {
  const source = String(release || '').trim();
  const match = source.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error('Invalid release version: ' + source);
  }

  const major = String(Number(match[1]));
  const minor = String(Number(match[2]));
  const patch = Number(match[3]);
  if (!isFinite(patch)) {
    throw new Error('Invalid release patch: ' + source);
  }

  return major + minor + String(Math.floor(patch / 1000));
}

function makeReleaseStreamsSheetName_(releaseCode) {
  return String(releaseCode || '').trim() + RELEASE_STREAMS_SHEET_SUFFIX;
}

function findReleaseStreamsTemplateSheet_(spreadsheet) {
  return findReleaseStreamsSheetByCode_(spreadsheet, RELEASE_STREAMS_TEMPLATE_CODE);
}

function findReleaseStreamsSheetByCode_(spreadsheet, releaseCode) {
  const normalizedCode = String(releaseCode || '').trim();
  if (!normalizedCode) return null;

  const targetKey = normalizeReleaseStreamsSheetName_(normalizedCode + RELEASE_STREAMS_SHEET_SUFFIX);
  const sheets = spreadsheet.getSheets();
  for (var index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    const name = String(sheet.getName() || '');
    const normalizedName = normalizeReleaseStreamsSheetName_(name);
    if (normalizedName === targetKey || normalizedName.indexOf(targetKey) === 0) {
      return sheet;
    }
  }
  return null;
}

function normalizeReleaseStreamsSheetName_(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function buildReleaseStreamsSheetUrl_(spreadsheet, sheet) {
  return spreadsheet.getUrl().replace(/#gid=\d+$/, '') + '#gid=' + sheet.getSheetId();
}

function findReleaseStreamsHeaderRow_(sheet, headerText) {
  const maxRows = Math.min(sheet.getMaxRows(), 200);
  const values = sheet.getRange(1, 1, maxRows, 1).getDisplayValues();
  const target = String(headerText || '').trim().toLowerCase();

  for (var index = 0; index < values.length; index += 1) {
    const cellValue = String(values[index][0] || '').trim().toLowerCase();
    if (cellValue === target) {
      return index + 1;
    }
  }
  return 0;
}

function findReleaseStreamsSectionEndRow_(sheet, startRow) {
  const maxRows = Math.min(sheet.getMaxRows(), startRow + 400);
  const values = sheet.getRange(startRow, 1, Math.max(1, maxRows - startRow + 1), 2).getDisplayValues();
  let lastNonEmptyRow = startRow - 1;
  let blankRun = 0;

  for (var index = 0; index < values.length; index += 1) {
    const row = values[index];
    const hasValue = String(row[0] || '').trim() || String(row[1] || '').trim();
    if (hasValue) {
      lastNonEmptyRow = startRow + index;
      blankRun = 0;
      continue;
    }

    blankRun += 1;
    if (blankRun >= 4 && lastNonEmptyRow >= startRow) {
      break;
    }
  }

  return lastNonEmptyRow;
}

function parseJsonBody_(e) {
  const text = String(e && e.postData && e.postData.contents || '').trim();
  if (!text) throw new Error('POST body is empty');
  return JSON.parse(stripBom_(text));
}

function normalizeOp_(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isDutyEditorReadOp_(op) {
  return op === 'dutieditorread' || op === 'editorread' || op === 'read';
}

function isDutyEditorSaveOp_(op) {
  return op === 'dutieditorsave' || op === 'editorsave' || op === 'save';
}

function isReleaseStreamsSheetCheckOp_(op) {
  return op === 'releasestreamssheetcheck' || op === 'streamssheetcheck';
}

function isReleaseStreamsSheetEnsureOp_(op) {
  return op === 'releasestreamssheetensure' || op === 'streamssheetensure';
}

function authorizeDutyEditorGoogleScopes_() {
  const doc = DocumentApp.openById(DUTY_EDITOR_DOC_ID);
  const leadsFile = DriveApp.getFileById(DUTY_EDITOR_LEADS_FILE_ID);
  const spreadsheet = SpreadsheetApp.openById(RELEASE_STREAMS_SPREADSHEET_ID);

  return {
    ok: true,
    docId: doc.getId(),
    leadsFileId: leadsFile.getId(),
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

function authorizeDutyEditorGoogleScopes() {
  return authorizeDutyEditorGoogleScopes_();
}

function stripBom_(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function toErrorText_(error) {
  return String(error && error.message ? error.message : error || 'Unknown error');
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(message) {
  return jsonResponse_({
    ok: false,
    build: DUTY_EDITOR_BUILD,
    error: String(message || 'Unknown error')
  });
}
