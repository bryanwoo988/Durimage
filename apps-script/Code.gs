/**
 * Durimage backend — Google Apps Script Web App.
 * Runs as YOUR Google account, so every photo is stored in YOUR Drive.
 *
 * Script Properties (Project Settings → Script Properties):
 *   TEAM_PASSWORD   the password workers type in the app (change it any time, no redeploy needed)
 *   ROOT_FOLDER_ID  ID of the Drive folder whose sub-folders appear in the app
 *   LOG_SHEET_ID    (set automatically) the "Durimage 照片记录" Sheet for photos with notes
 *
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 */

const MAX_BYTES = 15 * 1024 * 1024;           // fallback (compressed) upload limit
const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024; // original photo size safety cap

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const password = props.getProperty('TEAM_PASSWORD');
    const rootId = props.getProperty('ROOT_FOLDER_ID');
    if (!password || !rootId) return json({ ok: false, error: 'not_configured' });
    if (String(req.key || '') !== password) return json({ ok: false, error: 'bad_key' });

    const root = DriveApp.getFolderById(rootId);

    if (req.action === 'folders') {
      return json({ ok: true, folders: listFolders(root) });
    }

    // Preferred: open a resumable upload session in YOUR Drive and hand the session URL to the phone.
    // The phone then PUTs the untouched original straight to Drive. No access token leaves this script;
    // the session URL can only write this one file.
    if (req.action === 'session') {
      const allowed = listFolders(root).some(function (f) { return f.id === req.folderId; });
      if (!allowed) return json({ ok: false, error: 'bad_folder' });
      if (!/^image\//.test(req.mimeType || '')) return json({ ok: false, error: 'bad_type' });
      const size = Number(req.size) || 0;
      if (size <= 0 || size > MAX_ORIGINAL_BYTES) return json({ ok: false, error: 'too_large' });

      // Same photo (same fingerprint) already uploaded before → don't store it again.
      const dupId = findByHash_(req.sha256);
      if (dupId) return json({ ok: true, id: dupId, duplicate: true, dupHash: true });

      const folder = DriveApp.getFolderById(req.folderId);
      const name = String(req.name || 'photo.jpg').slice(0, 200);
      const existing = folder.getFilesByName(name);
      if (existing.hasNext()) return json({ ok: true, id: existing.next().getId(), duplicate: true });

      const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'post',
        contentType: 'application/json; charset=UTF-8',
        headers: {
          Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
          'X-Upload-Content-Type': req.mimeType,
          'X-Upload-Content-Length': String(size),
          // Drive allows browser (CORS) uploads to the session only from this origin.
          Origin: String(req.origin || ''),
        },
        payload: JSON.stringify({
          name: name,
          parents: [req.folderId],
          mimeType: req.mimeType,
          description: String(req.description || '').slice(0, 4000),
          properties: cleanProps_(req.props),
        }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) {
        return json({ ok: false, error: 'session_failed', message: res.getContentText().slice(0, 300) });
      }
      const headers = res.getAllHeaders();
      const uploadUrl = headers.Location || headers.location;
      if (!uploadUrl) return json({ ok: false, error: 'session_failed' });
      return json({ ok: true, uploadUrl: uploadUrl });
    }

    // Photo with a note → one row in the "Durimage 照片记录" Google Sheet (newest on top).
    if (req.action === 'log') {
      const allowed = listFolders(root).some(function (f) { return f.id === req.folderId; });
      if (!allowed) return json({ ok: false, error: 'bad_folder' });
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        const sheet = getLogSheet_(root, req.tz);
        const name = String(req.name || '').slice(0, 200);
        // Already logged (retry after a dropped connection) → don't add it twice.
        const last = sheet.getLastRow();
        if (last > 1 && sheet.getRange(2, COL_FILE, last - 1, 1).createTextFinder(name).matchEntireCell(true).findNext()) {
          return json({ ok: true, duplicate: true });
        }
        const lat = Number(req.lat), lng = Number(req.lng);
        const hasGps = req.lat != null && isFinite(lat) && isFinite(lng);
        const row = [
          new Date(req.capturedAt || Date.now()),
          safe_(req.folderName),
          safe_(req.photographer),
          safe_(req.note).slice(0, 5000),
          req.fileId ? '=HYPERLINK("https://drive.google.com/file/d/' + String(req.fileId).replace(/[^\w-]/g, '') + '/view","打开照片")' : '',
          safe_(name),
          hasGps ? lat.toFixed(6) + ', ' + lng.toFixed(6) + (req.acc ? ' (±' + Math.round(req.acc) + ' m)' : '') : '',
          hasGps ? '=HYPERLINK("https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '","地图")' : '',
          req.quality === 'compressed' ? '压缩' : '原图',
          '', '',
          // new columns, always appended after the existing ones
          safe_(req.orchard || ''),
          safe_(req.tree || ''),
          ({ camera: '拍照', gallery: '相册', old: '相册（旧照片）' })[req.source] || '',
          req.meta ? (req.trainOnly ? '仅训练' : '训练+测试') : '',
        ];
        sheet.insertRowBefore(2);
        sheet.getRange(2, 1, 1, row.length).setValues([row]).setFontWeight('normal').setBackground(null).setFontColor('#000000');
        return json({ ok: true });
      } finally {
        lock.releaseLock();
      }
    }

    // Fallback: compressed photo sent as base64 through this script.
    if (req.action === 'upload') {
      // Only allow writing into direct sub-folders of the root folder.
      const allowed = listFolders(root).some(function (f) { return f.id === req.folderId; });
      if (!allowed) return json({ ok: false, error: 'bad_folder' });
      if (!/^image\//.test(req.mimeType || '')) return json({ ok: false, error: 'bad_type' });

      const bytes = Utilities.base64Decode(req.data);
      if (bytes.length > MAX_BYTES) return json({ ok: false, error: 'too_large' });
      const dupId = findByHash_(req.sha256);
      if (dupId) return json({ ok: true, id: dupId, duplicate: true, dupHash: true });

      const folder = DriveApp.getFolderById(req.folderId);
      const name = String(req.name || 'photo.jpg').slice(0, 200);
      // Retry after a dropped connection: the same file name already exists → don't save it twice.
      const existing = folder.getFilesByName(name);
      if (existing.hasNext()) return json({ ok: true, id: existing.next().getId(), duplicate: true });
      const file = folder.createFile(Utilities.newBlob(bytes, req.mimeType, name));
      file.setDescription(String(req.description || '').slice(0, 4000));
      setProps_(file.getId(), cleanProps_(req.props));
      return json({ ok: true, id: file.getId() });
    }

    return json({ ok: false, error: 'bad_action' });
  } catch (err) {
    return json({ ok: false, error: 'server', message: String(err) });
  }
}

function doGet() {
  return json({ ok: true, app: 'durimage' });
}

function listFolders(root) {
  const out = [];
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) out.push({ id: f.getId(), name: f.getName() });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

const LOG_HEADERS = ['拍摄时间', '文件夹', '拍摄者', '注解', '照片', '文件名', 'GPS', '地图', '原图/压缩', '核实结果', '管理员备注',
                     '果园', '树号', '来源', '用途']; // new columns only ever go at the end
const BASE_COLS = 11;
const COL_FILE = 6;

// Finds the log Sheet (ID kept in Script Property LOG_SHEET_ID) or creates it inside the root folder.
function getLogSheet_(root, tz) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LOG_SHEET_ID');
  if (id) {
    try {
      // A Sheet moved to the Drive trash can still be opened by ID, so check for that too.
      if (!DriveApp.getFileById(id).isTrashed()) {
        const ss = SpreadsheetApp.openById(id);
        // Always the "注解" tab, even if the admin adds other tabs in front of it.
        const sh = ss.getSheetByName('注解') || ss.getSheets()[0];
        ensureHeaders_(sh);
        return sh;
      }
    } catch (e) { /* permanently deleted → create a new one */ }
  }
  const ss = SpreadsheetApp.create('Durimage 照片记录');
  if (tz) { try { ss.setSpreadsheetTimeZone(tz); } catch (e) {} }
  DriveApp.getFileById(ss.getId()).moveTo(root);
  const sh = ss.getSheets()[0];
  sh.setName('注解');
  sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setFontWeight('bold').setBackground('#2e1a63').setFontColor('#ffffff');
  sh.getRange(1, 10, 1, 2).setBackground('#f2b52c').setFontColor('#2b1a00'); // columns the admin fills in
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange('D:D').setWrap(true);
  [140, 120, 90, 320, 90, 260, 190, 60, 80, 160, 200, 110, 110, 110, 90].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1, sh.getMaxRows(), LOG_HEADERS.length).createFilter();
  props.setProperty('LOG_SHEET_ID', ss.getId());
  return sh;
}

// Sheets created before the orchard/tree columns existed: add the missing headers at the end
// and widen the filter so the new columns can be filtered too.
function ensureHeaders_(sh) {
  const n = LOG_HEADERS.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, n).getValues()[0];
  if (head[n - 1] === LOG_HEADERS[n - 1]) return;
  sh.getRange(1, BASE_COLS + 1, 1, n - BASE_COLS).setValues([LOG_HEADERS.slice(BASE_COLS)])
    .setFontWeight('bold').setBackground('#2e1a63').setFontColor('#ffffff');
  const f = sh.getFilter();
  if (f) { f.remove(); sh.getRange(1, 1, sh.getMaxRows(), n).createFilter(); }
}

// Drive file properties (key/value), e.g. orchard, tree, source, use, sha256.
const PROP_KEYS = ['sha256', 'orchard', 'tree', 'source', 'use'];
function cleanProps_(p) {
  const out = {};
  if (!p) return out;
  PROP_KEYS.forEach(function (k) {
    if (p[k] != null && p[k] !== '') out[k] = String(p[k]).replace(/[^A-Za-z0-9+\-]/g, '').slice(0, k === 'sha256' ? 64 : 40);
  });
  return out;
}
function setProps_(fileId, props) {
  if (!Object.keys(props).length) return;
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=id', {
      method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ properties: props }),
    });
  } catch (e) { /* properties are extra info; the photo is already saved */ }
}
// Finds an existing (not trashed) photo with the same fingerprint. Any problem → treat as "not found",
// so a search failure can never block an upload.
function findByHash_(hash) {
  if (!/^[0-9a-f]{64}$/.test(String(hash || ''))) return null;
  try {
    const q = "properties has { key='sha256' and value='" + hash + "' } and trashed = false";
    const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&q=' + encodeURIComponent(q), {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) return null;
    const files = JSON.parse(r.getContentText()).files || [];
    return files.length ? files[0].id : null;
  } catch (e) { return null; }
}

// Text typed by workers must never be treated as a formula.
function safe_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
