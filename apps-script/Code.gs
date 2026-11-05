/**
 * Durimage backend — Google Apps Script Web App.
 * Runs as YOUR Google account, so every photo is stored in YOUR Drive.
 *
 * Script Properties (Project Settings → Script Properties):
 *   TEAM_PASSWORD   password for people who take photos (change it any time, no redeploy needed)
 *   REVIEW_PASSWORD password for experts who review submitted photos
 *   ADMIN_PASSWORD  password for the admin: takes photos and sees every review
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
    const rootId = props.getProperty('ROOT_FOLDER_ID');
    if (!props.getProperty('TEAM_PASSWORD') || !rootId) return json({ ok: false, error: 'not_configured' });
    const role = roleOf_(req.key, props);
    if (!role) return json({ ok: false, error: 'bad_key' });
    const allowed_ = {
      session: ['team', 'admin'], upload: ['team', 'admin'], log: ['team', 'admin'],
      submit: ['team', 'admin'], myReviews: ['team', 'admin'],
      queue: ['reviewer', 'admin'], review: ['reviewer', 'admin'],
      addCategory: ['admin'],
    }[req.action];
    if (allowed_ && allowed_.indexOf(role) < 0) return json({ ok: false, error: 'forbidden' });

    const root = DriveApp.getFolderById(rootId);

    if (req.action === 'login') return json({ ok: true, role: role });
    if (req.action === 'categories') return json({ ok: true, categories: readCategories_(root, req.tz) });

    if (req.action === 'addCategory') {
      const zh = clip_(req.zh, 40);
      if (!zh) return json({ ok: false, error: 'bad_name' });
      return withLock_(function () {
        const sh = getTab_(root, req.tz, '类别', CAT_HEADERS);
        readCategories_(root, req.tz); // make sure defaults exist first
        const rows = sh.getDataRange().getValues().slice(1);
        if (!rows.some(function (r) { return String(r[0]).trim() === zh; })) {
          sh.appendRow([safe_(zh), safe_(clip_(req.en, 40)), safe_(clip_(req.ms, 40)), clip_(req.color, 9) || pickColor_(rows.length), '是']);
        }
        return json({ ok: true, categories: readCategories_(root, req.tz) });
      });
    }

    // Photos sent for expert review (one row per photo; sending again updates the judgement).
    if (req.action === 'submit') {
      const items = (req.items || []).slice(0, 200);
      return withLock_(function () {
        const sh = getTab_(root, req.tz, '送审', SUB_HEADERS);
        const data = sh.getDataRange().getValues();
        const rowOf = {};
        for (let i = 1; i < data.length; i++) rowOf[data[i][1]] = i + 1;
        items.forEach(function (it) {
          const id = clip_(it.id, 40); if (!id || !it.fileId) return;
          const labels = (it.labels || []).map(function (x) { return clip_(x, 40); }).slice(0, 20);
          const row = [
            new Date(), id, safe_(clip_(it.by, 40)), safe_(clip_(it.folder, 100)), safe_(clip_(it.orchard, 30)), safe_(clip_(it.tree, 30)),
            it.capturedAt ? new Date(it.capturedAt) : '', safe_(labels.join('、')), safe_(clip_(it.labelText, 300)),
            it.confident === false ? '不确定' : '确定', safe_(clip_(it.note, 1000)),
            '=HYPERLINK("https://drive.google.com/file/d/' + String(it.fileId).replace(/[^\w-]/g, '') + '/view","打开照片")',
            safe_(clip_(it.name, 200)), 0, String(it.fileId).replace(/[^\w-]/g, ''),
            JSON.stringify(labels),
          ];
          if (rowOf[id]) {
            const keep = sh.getRange(rowOf[id], 14).getValue(); // review count stays
            row[13] = keep;
            sh.getRange(rowOf[id], 1, 1, row.length).setValues([row]);
          } else {
            sh.appendRow(row);
            rowOf[id] = sh.getLastRow();
          }
          if (it.thumb && String(it.thumb).length < 45000) saveThumb_(root, req.tz, id, String(it.thumb));
        });
        return json({ ok: true });
      });
    }

    // Reviewer / admin: list of submitted photos with reviews.
    // A reviewer only ever receives their OWN reviews (reviewers cannot see each other).
    if (req.action === 'queue') {
      const subs = readSubs_(root, req.tz).slice(-1000).reverse(); // newest first
      const revs = readReviews_(root, req.tz);
      const me = String(req.reviewer || '').trim().toLowerCase();
      subs.forEach(function (s) {
        const all = revs[s.id] || [];
        s.reviews = role === 'admin' ? all : all.filter(function (r) { return r.reviewer.trim().toLowerCase() === me; });
        s.reviewCount = latestPerReviewer_(all).length;
      });
      return json({ ok: true, items: subs });
    }

    // Small thumbnails for the review list, fetched in batches.
    if (req.action === 'thumbs') {
      const sh = getTab_(root, req.tz, '缩图', ['ID', '缩图']), out = {};
      (req.ids || []).slice(0, 40).forEach(function (id) {
        const c = sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();
        if (c) out[id] = String(sh.getRange(c.getRow(), 2).getValue() || '');
      });
      return json({ ok: true, thumbs: out });
    }

    // Photographer / admin: reviews for their own submitted photos.
    if (req.action === 'myReviews') {
      const want = {}; (req.ids || []).slice(0, 1500).forEach(function (id) { want[id] = 1; });
      const revs = readReviews_(root, req.tz), out = {};
      Object.keys(revs).forEach(function (id) { if (want[id]) out[id] = revs[id]; });
      return json({ ok: true, reviews: out });
    }

    // Expert review (append-only: every save is kept as a new version → full audit trail).
    if (req.action === 'review') {
      const subId = clip_(req.subId, 40), reviewer = clip_(req.reviewer, 40);
      if (!subId || !reviewer) return json({ ok: false, error: 'bad_review' });
      const marks = req.marks ? JSON.stringify(req.marks) : '';
      if (marks.length > 45000) return json({ ok: false, error: 'marks_too_big' });
      let markLink = '';
      if (req.markPng) {
        try {
          const folder = marksFolder_(root);
          const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.markPng), 'image/jpeg',
            clip_(req.photoName, 120).replace(/\.[^.]+$/, '') + '_review_' + reviewer.replace(/[^\w-]/g, '') + '_' + Date.now() + '.jpg'));
          markLink = '=HYPERLINK("https://drive.google.com/file/d/' + f.getId() + '/view","标记图")';
        } catch (e) { /* the review itself still counts */ }
      }
      return withLock_(function () {
        const sh = getTab_(root, req.tz, '审核', REV_HEADERS);
        const labels = (req.labels || []).map(function (x) { return clip_(x, 40); }).slice(0, 20);
        const all = readReviews_(root, req.tz)[subId] || [];
        const version = all.filter(function (r) { return r.reviewer.trim().toLowerCase() === reviewer.toLowerCase(); }).length + 1;
        sh.appendRow([new Date(), subId, safe_(reviewer), req.verdict === 'agree' ? '同意' : '需要改正', safe_(labels.join('、')),
          safe_(clip_(req.labelText, 300)), safe_(clip_(req.comment, 2000)), (req.marks || []).length, markLink, marks, version, JSON.stringify(labels)]);
        // keep the "number of reviewers" column on the submission up to date
        const subs = getTab_(root, req.tz, '送审', SUB_HEADERS), data = subs.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) if (data[i][1] === subId) {
          subs.getRange(i + 1, 14).setValue(latestPerReviewer_(readReviews_(root, req.tz)[subId] || []).length);
          break;
        }
        return json({ ok: true, version: version });
      });
    }

    // Photo for review / zoom: a large preview from Drive (falls back to the original file).
    if (req.action === 'image') {
      const id = String(req.fileId || '').replace(/[^\w-]/g, '');
      const f = DriveApp.getFileById(id);
      if (!inAppFolders_(f, root)) return json({ ok: false, error: 'forbidden' });
      const size = Math.max(200, Math.min(4096, Number(req.size) || 2048));
      let blob = null;
      try {
        const auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
        const meta = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink', { headers: auth, muteHttpExceptions: true }).getContentText());
        if (meta.thumbnailLink) {
          const r = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+[^&]*$/, '=s' + size), { headers: auth, muteHttpExceptions: true });
          if (r.getResponseCode() === 200) blob = r.getBlob();
        }
      } catch (e) { /* use the original below */ }
      if (!blob || req.original) {
        if (f.getSize() > 20 * 1024 * 1024) return json({ ok: false, error: 'too_large' });
        blob = f.getBlob();
      }
      return json({ ok: true, mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) });
    }

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
    if (!f.isTrashed() && f.getName().charAt(0) !== '_') out.push({ id: f.getId(), name: f.getName() }); // "_…" = internal
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
  const ss = getBook_(root, tz);
  // Always the "注解" tab, even if the admin adds other tabs in front of it.
  const sh = ss.getSheetByName('注解') || ss.getSheets()[0];
  ensureHeaders_(sh);
  return sh;
}
let BOOK_ = null;
function getBook_(root, tz) {
  if (BOOK_) return BOOK_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LOG_SHEET_ID');
  if (id) {
    try {
      // A Sheet moved to the Drive trash can still be opened by ID, so check for that too.
      if (!DriveApp.getFileById(id).isTrashed()) return (BOOK_ = SpreadsheetApp.openById(id));
    } catch (e) { /* permanently deleted → create a new one */ }
  }
  return (BOOK_ = createBook_(root, tz));
}
function createBook_(root, tz) {
  const props = PropertiesService.getScriptProperties();
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
  return ss;
}

// ---------- Review data: tabs "送审", "审核", "类别" in the same Sheet ----------
const SUB_HEADERS = ['送审时间', 'ID', '拍摄者', '文件夹', '果园', '树号', '拍摄时间', '初步判断', '手写补充', '把握', '注解', '照片', '文件名', '审核人数', 'fileId', 'labelsJSON'];
const REV_HEADERS = ['审核时间', '送审ID', '审核员', '结论', '判断', '手写补充', '留言', '标记数', '标记图', 'marksJSON', '版本', 'labelsJSON'];
const CAT_HEADERS = ['中文', 'English', 'Melayu', '颜色', '启用'];
const DEFAULT_CATS = [
  ['烂叶病', 'Leaf blight', 'Hawar daun'], ['介壳虫', 'Scale insect', 'Serangga perisai'], ['青蚊', 'Leafhopper', 'Bena daun'],
  ['木虱', 'Psyllid', 'Psilid'], ['红蜘蛛', 'Red spider mite', 'Hama labah-labah merah'], ['粉介壳', 'Mealybug', 'Koya'],
  ['健康', 'Healthy', 'Sihat'], ['看不出来', 'Cannot tell', 'Tidak pasti'],
];
const PALETTE = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#00acc1', '#6d4c41', '#d81b60', '#7cb342', '#3949ab', '#f4511e'];
function pickColor_(i) { return PALETTE[i % PALETTE.length]; }

function getTab_(root, tz, name, headers) {
  const ss = getBook_(root, tz);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#2e1a63').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  }
  return sh;
}
function readCategories_(root, tz) {
  const sh = getTab_(root, tz, '类别', CAT_HEADERS);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, DEFAULT_CATS.length, 5).setValues(DEFAULT_CATS.map(function (c, i) {
      return [c[0], c[1], c[2], c[0] === '健康' ? '#2e7d32' : c[0] === '看不出来' ? '#757575' : pickColor_(i), '是'];
    }));
  }
  return sh.getDataRange().getValues().slice(1)
    .filter(function (r) { return String(r[0]).trim() && String(r[4]).trim() !== '否'; })
    .map(function (r) { return { zh: String(r[0]).trim(), en: String(r[1]).trim(), ms: String(r[2]).trim(), color: String(r[3]).trim() || '#888888' }; });
}
function readSubs_(root, tz) {
  const v = getTab_(root, tz, '送审', SUB_HEADERS).getDataRange().getValues().slice(1);
  return v.filter(function (r) { return r[1]; }).map(function (r) {
    let labels = []; try { labels = JSON.parse(r[15] || '[]'); } catch (e) {}
    return {
      id: String(r[1]), submittedAt: iso_(r[0]), by: String(r[2]), folder: String(r[3]), orchard: String(r[4]), tree: String(r[5]),
      capturedAt: iso_(r[6]), labels: labels, labelText: String(r[8]), confident: String(r[9]) !== '不确定', note: String(r[10]),
      name: String(r[12]), fileId: String(r[14]),
    };
  });
}
function readReviews_(root, tz) {
  const v = getTab_(root, tz, '审核', REV_HEADERS).getDataRange().getValues().slice(1), out = {};
  v.forEach(function (r) {
    if (!r[1]) return;
    let labels = [], marks = [];
    try { labels = JSON.parse(r[11] || '[]'); } catch (e) {}
    try { marks = r[9] ? JSON.parse(r[9]) : []; } catch (e) {}
    (out[r[1]] = out[r[1]] || []).push({
      at: iso_(r[0]), reviewer: String(r[2]), verdict: String(r[3]) === '同意' ? 'agree' : 'correct', labels: labels,
      labelText: String(r[5]), comment: String(r[6]), marks: marks, version: Number(r[10]) || 1,
    });
  });
  return out;
}
// Thumbnails live in their own (hidden) tab so the review list stays fast.
function saveThumb_(root, tz, id, thumb) {
  const sh = getTab_(root, tz, '缩图', ['ID', '缩图']);
  if (!sh.isSheetHidden()) sh.hideSheet();
  const c = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  if (c) sh.getRange(c.getRow(), 2).setValue(thumb); else sh.appendRow([id, thumb]);
}
function latestPerReviewer_(list) {
  const m = {};
  list.forEach(function (r) { const k = r.reviewer.trim().toLowerCase(); if (!m[k] || r.version >= m[k].version) m[k] = r; });
  return Object.keys(m).map(function (k) { return m[k]; });
}
function marksFolder_(root) {
  const it = root.getFoldersByName('_审核标记');
  return it.hasNext() ? it.next() : root.createFolder('_审核标记');
}
// Only photos inside the app's folders (or review marks) may be sent to the app.
function inAppFolders_(file, root) {
  const ok = {}; listFolders(root).forEach(function (f) { ok[f.id] = 1; });
  const ps = file.getParents();
  while (ps.hasNext()) { const p = ps.next(); if (ok[p.getId()] || p.getName() === '_审核标记') return true; }
  return false;
}
function roleOf_(key, props) {
  const k = String(key || '');
  if (!k) return null;
  if (k === props.getProperty('ADMIN_PASSWORD')) return 'admin';
  if (k === props.getProperty('TEAM_PASSWORD')) return 'team';
  if (k === props.getProperty('REVIEW_PASSWORD')) return 'reviewer';
  return null;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function clip_(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function iso_(v) { return v instanceof Date ? v.toISOString() : (v ? String(v) : ''); }

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
