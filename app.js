(() => {
  'use strict';

  const CFG = window.DURIMAGE_CONFIG || {};
  const DEMO = !CFG.CLIENT_ID;
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const $ = (id) => document.getElementById(id);

  // ---------- Local storage helpers (all wrapped: storage can throw) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('dm_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('dm_' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('dm_' + k); } catch {} },
  };

  const detectLang = () => {
    const n = (navigator.language || 'en').toLowerCase();
    if (n.startsWith('zh')) return 'zh';
    if (n.startsWith('ms') || n.startsWith('id')) return 'ms';
    return 'en';
  };

  const state = {
    lang: store.get('lang', detectLang()),
    folders: store.get('folders', DEMO ? [
      { id: 'demo1', name: '果腐病 Phytophthora' },
      { id: 'demo2', name: '蛀果虫 Fruit borer' },
      { id: 'demo3', name: '叶斑病 Leaf spot' },
    ] : []),
    currentFolder: store.get('currentFolder', null),
    gps: store.get('gps', true),
    token: store.get('token', null),     // { access_token, expires_at }
    user: store.get('user', null),       // { name, email }
    items: [],                           // queue/history records (without blobs)
    pending: [],                         // Files waiting in review sheet
    reviewFolder: null,
    position: null,
    uploading: false,
  };

  // ---------- i18n ----------
  const t = (key, vars = {}) => {
    let s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', v);
    return s;
  };
  function applyI18n() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-Hans' : state.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $('langBtn').textContent = I18N[state.lang]._label;
    $('langSeg').innerHTML = '';
    for (const code of Object.keys(I18N)) {
      const b = document.createElement('button');
      b.textContent = I18N[code]._label === 'EN' ? 'English' : I18N[code]._label === 'BM' ? 'Melayu' : '中文';
      b.className = code === state.lang ? 'on' : '';
      b.onclick = () => setLang(code);
      $('langSeg').appendChild(b);
    }
    render();
  }
  function setLang(code) { state.lang = code; store.set('lang', code); applyI18n(); }

  // ---------- IndexedDB (photo queue survives offline + app restarts) ----------
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('durimage', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('items', { keyPath: 'id' });
        r.result.createObjectStore('blobs');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(storeName, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const x = d.transaction(storeName, mode);
      const out = fn(x.objectStore(storeName));
      x.oncomplete = () => res(out && 'result' in out ? out.result : out);
      x.onerror = () => rej(x.error);
    });
  }
  const putItem = (it) => tx('items', 'readwrite', (s) => s.put(it));
  const putBlob = (id, b) => tx('blobs', 'readwrite', (s) => s.put(b, id));
  const getBlob = (id) => tx('blobs', 'readonly', (s) => s.get(id));
  const delBlob = (id) => tx('blobs', 'readwrite', (s) => s.delete(id));
  const delItem = (id) => tx('items', 'readwrite', (s) => s.delete(id));
  const allItems = () => tx('items', 'readonly', (s) => s.getAll());

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg, err = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
  }
  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }
  document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd || e.target.closest('[data-close]')) {
        bd.hidden = true;
        if (bd.id === 'reviewSheet') resetReview();
      }
    });
  });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const tokenValid = () => DEMO || (state.token && state.token.expires_at > Date.now() + 60_000);
  const signedIn = () => DEMO || !!state.user || tokenValid();

  // ---------- Render ----------
  function render() {
    $('demoBanner').hidden = !DEMO;
    $('offlineBanner').hidden = navigator.onLine;
    $('connectCard').hidden = signedIn();

    const pending = state.items.filter((i) => i.status !== 'done');
    const needsAuth = !DEMO && pending.length > 0 && !tokenValid() && navigator.onLine;
    $('reconnectBanner').hidden = !needsAuth;
    $('reconnectText').textContent = t('reconnect', { n: pending.length });

    const cur = state.folders.find((f) => f.id === state.currentFolder);
    $('destName').textContent = cur ? cur.name : t('noFolder') + ' · ' + t('tapToChoose');
    $('destName').classList.toggle('muted', !cur);

    const today = new Date().toDateString();
    $('statToday').textContent = state.items.filter((i) => new Date(i.createdAt).toDateString() === today).length;
    $('statPending').textContent = pending.length;
    $('statDone').textContent = state.items.filter((i) => i.status === 'done').length;

    const grid = $('recentGrid');
    const items = [...state.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    $('emptyState').hidden = items.length > 0;
    grid.innerHTML = items.map((i) => {
      const icon = i.status === 'done' ? '<svg><use href="#i-check"/></svg>' : i.status === 'error' ? '<svg><use href="#i-retry"/></svg>' : '';
      return `<button class="tile" data-id="${i.id}">
        <img src="${i.thumb}" alt="" loading="lazy">
        <div class="tile-folder">${esc(i.folderName)}</div>
        <div class="tile-badge b-${i.status}">${icon}<span>${t(i.status === 'error' ? 'retry' : i.status)}</span></div>
      </button>`;
    }).join('');

    // Settings
    $('gpsToggle').checked = state.gps;
    $('accountName').textContent = DEMO ? 'Demo' : state.user ? (state.user.email || state.user.name) : t('notSignedIn');
    $('accountBtn').textContent = (!DEMO && signedIn()) ? t('signOut') : t('signIn');
    $('accountBtn').hidden = DEMO;

    renderFolderList();
  }

  function folderChip(f, on) {
    return `<svg><use href="#i-folder-fill"/></svg><span class="name">${esc(f.name)}</span>
      <span class="tick">${on ? '<svg><use href="#i-check"/></svg>' : ''}</span>`;
  }

  function renderFolderList() {
    const ul = $('folderList');
    if (!state.folders.length) { ul.innerHTML = `<li class="none">${t('noFolders')}</li>`; return; }
    ul.innerHTML = state.folders.map((f) => `<li>
      <button class="chip ${f.id === state.currentFolder ? 'on' : ''}" data-pick="${f.id}">${folderChip(f, f.id === state.currentFolder)}</button>
      <button class="rm" data-rm="${f.id}" aria-label="${t('remove')}"><svg><use href="#i-x"/></svg></button>
    </li>`).join('');
  }

  function renderReviewFolders() {
    const box = $('reviewFolders');
    box.innerHTML = state.folders.map((f) => `<button class="chip ${f.id === state.reviewFolder ? 'on' : ''}" data-rf="${f.id}">${folderChip(f, f.id === state.reviewFolder)}</button>`).join('')
      + `<button class="chip chip-add" data-addfolder><svg><use href="#i-plus"/></svg><span>${t('addFolder')}</span></button>`;
    $('saveBtn').textContent = t('saveBtn', { n: state.pending.length });
    $('saveBtn').disabled = !state.reviewFolder || !state.pending.length;
  }

  // ---------- Folder management ----------
  function setCurrentFolder(id) { state.currentFolder = id; store.set('currentFolder', id); }
  function saveFolders() { store.set('folders', state.folders); }

  $('folderList').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    const rm = e.target.closest('[data-rm]');
    if (pick) { setCurrentFolder(pick.dataset.pick); render(); closeSheet('folderSheet'); }
    if (rm) {
      const f = state.folders.find((x) => x.id === rm.dataset.rm);
      if (f && confirm(t('confirmRemove', { f: f.name }))) {
        state.folders = state.folders.filter((x) => x.id !== f.id);
        if (state.currentFolder === f.id) setCurrentFolder(state.folders[0]?.id || null);
        saveFolders(); render();
      }
    }
  });
  $('destCard').onclick = () => openSheet('folderSheet');
  $('foldersBtn').onclick = () => openSheet('folderSheet');
  $('addFolderBtn').onclick = () => addFoldersFromDrive();
  $('reviewFolders').addEventListener('click', (e) => {
    const rf = e.target.closest('[data-rf]');
    if (rf) { state.reviewFolder = rf.dataset.rf; renderReviewFolders(); }
    if (e.target.closest('[data-addfolder]')) addFoldersFromDrive().then(() => {
      if (!state.reviewFolder && state.folders.length) state.reviewFolder = state.folders[state.folders.length - 1].id;
      renderReviewFolders();
    });
  });

  async function addFoldersFromDrive() {
    if (DEMO) {
      const name = prompt('Folder name (demo)');
      if (name) {
        const f = { id: 'demo' + Date.now(), name };
        state.folders.push(f); saveFolders();
        if (!state.currentFolder) setCurrentFolder(f.id);
        render(); toast(t('folderAdded', { n: 1 }));
      }
      return;
    }
    if (!navigator.onLine) { toast(t('offline'), true); return; }
    const token = await ensureToken(true);
    if (!token) return;
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((r) => gapi.load('picker', r));
    return new Promise((resolve) => {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder')
        .setMode(google.picker.DocsViewMode.LIST);
      const builder = new google.picker.PickerBuilder()
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .setOAuthToken(token)
        .setTitle(t('pickerTitle'))
        .setLocale({ zh: 'zh-CN', en: 'en', ms: 'ms' }[state.lang])
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            let added = 0;
            for (const d of data.docs) {
              if (!state.folders.some((f) => f.id === d.id)) { state.folders.push({ id: d.id, name: d.name }); added++; }
            }
            saveFolders();
            if (!state.currentFolder && state.folders.length) setCurrentFolder(state.folders[0].id);
            render(); toast(t('folderAdded', { n: added }));
            resolve();
          } else if (data.action === google.picker.Action.CANCEL) resolve();
        });
      if (CFG.API_KEY) builder.setDeveloperKey(CFG.API_KEY);
      if (CFG.APP_ID) builder.setAppId(CFG.APP_ID);
      builder.build().setVisible(true);
    });
  }

  // ---------- Google auth (Google Identity Services token model) ----------
  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }

  let tokenClient;
  async function getTokenClient() {
    await loadScript('https://accounts.google.com/gsi/client');
    if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CFG.CLIENT_ID, scope: SCOPE, callback: () => {} });
    return tokenClient;
  }

  // interactive=true must be called from a user tap (popup blockers).
  async function ensureToken(interactive) {
    if (DEMO) return 'demo';
    if (tokenValid()) return state.token.access_token;
    if (!interactive) return null;
    try {
      const client = await getTokenClient();
      const resp = await new Promise((res) => {
        client.callback = res;
        client.error_callback = (err) => res({ error: err.type || 'popup' });
        client.requestAccessToken({ prompt: state.user ? '' : 'consent', hint: state.user?.email });
      });
      if (resp.error) { toast(t('signInFirst'), true); return null; }
      state.token = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in - 30) * 1000 };
      store.set('token', state.token);
      if (!state.user) await loadUser();
      render();
      processQueue();
      return state.token.access_token;
    } catch (e) {
      console.error(e); toast(t('signInFirst'), true); return null;
    }
  }
  async function loadUser() {
    try {
      const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', { headers: { Authorization: 'Bearer ' + state.token.access_token } });
      const j = await r.json();
      state.user = { name: j.user.displayName, email: j.user.emailAddress };
      store.set('user', state.user);
    } catch {}
  }
  function signOut() {
    if (state.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(state.token.access_token, () => {});
    state.token = null; state.user = null;
    store.del('token'); store.del('user');
    render();
  }
  $('signInBtn').onclick = () => ensureToken(true);
  $('reconnectBanner').onclick = () => ensureToken(true);
  $('accountBtn').onclick = () => (signedIn() ? signOut() : ensureToken(true));

  // ---------- Capture flow ----------
  function onFiles(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    e.target.value = '';
    if (!files.length) return;
    state.pending = files;
    state.reviewFolder = state.currentFolder;
    const strip = $('reviewStrip');
    strip.innerHTML = '';
    for (const f of files) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      strip.appendChild(img);
    }
    $('reviewCount').textContent = t('photosCount', { n: files.length });
    $('noteInput').value = '';
    renderReviewFolders();
    openSheet('reviewSheet');
    captureGps();
  }
  $('cameraInput').addEventListener('change', onFiles);
  $('galleryInput').addEventListener('change', onFiles);

  function resetReview() {
    $('reviewStrip').querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src));
    state.pending = [];
  }

  function captureGps() {
    state.position = null;
    $('gpsLine').hidden = true;
    if (!state.gps || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => {
      state.position = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
      $('gpsText').textContent = `${state.position.lat.toFixed(5)}, ${state.position.lng.toFixed(5)} (±${state.position.acc} m)`;
      $('gpsLine').hidden = false;
    }, () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  async function makeThumb(file) {
    try {
      const bmp = await createImageBitmap(file);
      const s = 240 / Math.min(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#cfd8cf"/></svg>');
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  function fileName(date, folderName, idx, ext) {
    const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const safe = folderName.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 40);
    return `durian_${safe}_${d}${idx ? '_' + idx : ''}.${ext}`;
  }

  $('saveBtn').onclick = async () => {
    const folder = state.folders.find((f) => f.id === state.reviewFolder);
    if (!folder) { toast(t('pickFolderFirst'), true); return; }
    const files = state.pending;
    const note = $('noteInput').value.trim();
    const pos = state.position;
    setCurrentFolder(folder.id);
    closeSheet('reviewSheet');

    const now = new Date();
    const descLines = [
      note,
      `Captured: ${now.toISOString()}`,
      pos ? `GPS: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (±${pos.acc} m)` : '',
      pos ? `Map: https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : '',
      'Source: Durimage',
    ].filter(Boolean);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
      const item = {
        id, createdAt: Date.now() + i, status: 'queued',
        folderId: folder.id, folderName: folder.name,
        name: fileName(now, folder.name, files.length > 1 ? i + 1 : 0, ext),
        mime: f.type || 'image/jpeg',
        description: descLines.join('\n'),
        thumb: await makeThumb(f),
      };
      await putBlob(id, f);
      await putItem(item);
      state.items.push(item);
    }
    resetReview();
    render();
    toast(t('savedQueued', { n: files.length }));
    // The save tap is a user gesture, so we may open the Google popup here if needed.
    if (navigator.onLine) { await ensureToken(true); processQueue(); }
  };

  // ---------- Upload queue ----------
  async function uploadOne(item, token) {
    const blob = await getBlob(item.id);
    if (!blob) throw new Error('missing blob');
    if (DEMO) { await new Promise((r) => setTimeout(r, 900)); return { id: 'demo' }; }

    // Resumable upload: works for any size (multipart is only for <=5 MB).
    const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': item.mime,
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify({ name: item.name, parents: [item.folderId], description: item.description, mimeType: item.mime }),
    });
    if (init.status === 401) throw Object.assign(new Error('auth'), { auth: true });
    if (!init.ok) throw new Error('init ' + init.status + ' ' + (await init.text()));
    const url = init.headers.get('Location');
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': item.mime }, body: blob });
    if (put.status === 401) throw Object.assign(new Error('auth'), { auth: true });
    if (!put.ok) throw new Error('put ' + put.status);
    return put.json();
  }

  async function processQueue() {
    if (state.uploading || !navigator.onLine) return;
    state.uploading = true;
    const doneByFolder = {};
    try {
      const token = await ensureToken(false);
      if (!token) return;
      for (const item of [...state.items].sort((a, b) => a.createdAt - b.createdAt)) {
        if (item.status === 'done') continue;
        if (!navigator.onLine) break;
        item.status = 'uploading'; render();
        try {
          const res = await uploadOne(item, token);
          item.status = 'done'; item.driveId = res.id; item.error = null;
          await delBlob(item.id);
          doneByFolder[item.folderName] = (doneByFolder[item.folderName] || 0) + 1;
        } catch (e) {
          console.error(e);
          item.status = e.auth ? 'queued' : 'error';
          item.error = String(e.message || e);
          if (e.auth) { state.token = null; store.del('token'); await putItem(item); break; }
        }
        await putItem(item);
        render();
      }
    } finally {
      state.uploading = false;
    }
    const entries = Object.entries(doneByFolder);
    if (entries.length) toast(entries.map(([f, n]) => t('uploadedOk', { n, f })).join(' · '));
    else if (state.items.some((i) => i.status === 'error')) toast(t('uploadFail'), true);
    await trimHistory();
    render();
  }

  async function trimHistory() {
    const done = state.items.filter((i) => i.status === 'done').sort((a, b) => b.createdAt - a.createdAt);
    for (const old of done.slice(120)) { await delItem(old.id); }
    const keep = new Set(done.slice(120).map((i) => i.id));
    state.items = state.items.filter((i) => !keep.has(i.id));
  }

  $('recentGrid').addEventListener('click', async (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const item = state.items.find((i) => i.id === tile.dataset.id);
    if (!item) return;
    if (item.status === 'error') {
      item.status = 'queued'; await putItem(item); render();
      await ensureToken(true); processQueue();
    } else if (item.status === 'done' && item.driveId && !DEMO) {
      window.open('https://drive.google.com/file/d/' + item.driveId + '/view', '_blank');
    }
  });

  // ---------- Settings ----------
  $('settingsBtn').onclick = () => openSheet('settingsSheet');
  $('langBtn').onclick = () => {
    const codes = Object.keys(I18N);
    setLang(codes[(codes.indexOf(state.lang) + 1) % codes.length]);
  };
  $('gpsToggle').onchange = (e) => { state.gps = e.target.checked; store.set('gps', state.gps); };
  $('clearHistoryBtn').onclick = async () => {
    for (const i of state.items.filter((x) => x.status === 'done')) await delItem(i.id);
    state.items = state.items.filter((x) => x.status !== 'done');
    render(); toast(t('historyCleared'));
  };

  window.addEventListener('online', () => { render(); processQueue(); });
  window.addEventListener('offline', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) processQueue(); });

  // ---------- Boot ----------
  (async () => {
    try {
      state.items = await allItems();
      // Anything stuck "uploading" from a closed app goes back to the queue.
      for (const i of state.items) if (i.status === 'uploading') { i.status = 'queued'; await putItem(i); }
    } catch (e) { console.error(e); }
    applyI18n();
    processQueue();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
