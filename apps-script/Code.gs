/**
 * Durimage backend — Google Apps Script Web App.
 * Runs as YOUR Google account, so every photo is stored in YOUR Drive.
 *
 * Script Properties (Project Settings → Script Properties):
 *   TEAM_PASSWORD   the password workers type in the app (change it any time, no redeploy needed)
 *   ROOT_FOLDER_ID  ID of the Drive folder whose sub-folders appear in the app
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

    // Fallback: compressed photo sent as base64 through this script.
    if (req.action === 'upload') {
      // Only allow writing into direct sub-folders of the root folder.
      const allowed = listFolders(root).some(function (f) { return f.id === req.folderId; });
      if (!allowed) return json({ ok: false, error: 'bad_folder' });
      if (!/^image\//.test(req.mimeType || '')) return json({ ok: false, error: 'bad_type' });

      const bytes = Utilities.base64Decode(req.data);
      if (bytes.length > MAX_BYTES) return json({ ok: false, error: 'too_large' });

      const folder = DriveApp.getFolderById(req.folderId);
      const name = String(req.name || 'photo.jpg').slice(0, 200);
      // Retry after a dropped connection: the same file name already exists → don't save it twice.
      const existing = folder.getFilesByName(name);
      if (existing.hasNext()) return json({ ok: true, id: existing.next().getId(), duplicate: true });
      const file = folder.createFile(Utilities.newBlob(bytes, req.mimeType, name));
      file.setDescription(String(req.description || '').slice(0, 4000));
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
