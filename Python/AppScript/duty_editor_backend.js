const DUTY_EDITOR_DOC_ID = '1glaEFkdpAzGuRyQZYz1muBzVkFOnKyn85BW-CXLFSFU';
const DUTY_EDITOR_LEADS_FILE_ID = '1Arzm2ZEix5aVyp0lqAFeZxLnDnkfkkUb';
const DUTY_EDITOR_BUILD = 'duty-editor-2026-04-08-2';

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
