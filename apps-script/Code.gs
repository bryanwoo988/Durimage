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

const MAX_BYTES = 15 * 1024 * 1024; // reject anything larger than 15 MB after decoding

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
