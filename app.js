(() => {
  'use strict';

  const CFG = window.DURIMAGE_CONFIG || {};
  const DEMO = !CFG.SCRIPT_URL;
  const MAX_EDGE = 2560;      // longest side after compression (px)
  const JPEG_QUALITY = 0.85;
  const $ = (id) => document.getElementById(id);

  // ---------- Local storage (wrapped: storage can throw) ----------
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
  const DEMO_FOLDERS = [
    { id: 'demo1', name: '果腐病 Phytophthora' },
    { id: 'demo2', name: '蛀果虫 Fruit borer' },
    { id: 'demo3', name: '叶斑病 Leaf spot' },
  ];

  const state = {
    lang: store.get('lang', detectLang()),
    password: store.get('pw', null),
    name: store.get('name', ''),
    folders: store.get('folders', []),
    currentFolder: store.get('currentFolder', null),
    gps: store.get('gps', true),
    items: [],
    pending: [],
    reviewFolder: null,
    position: null,
    uploading: false,
    onboardMode: null, // 'pw' | 'name' | 'reenter' | 'editName' | 'pwChanged'
  };

  // ---------- i18n ----------
  const t = (key, vars = {}) => {
    let s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', v);
    return s;
  };
  function langButtons(container) {
    container.innerHTML = '';
    for (const code of Object.keys(I18N)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = I18N[code]._name;
      b.className = code === state.lang ? 'on' : '';
      b.onclick = () => setLang(code);
      container.appendChild(b);
    }
  }
  function applyI18n() {
    document.documentElement.lang = state.lang === 'zh' ? 'zh-Hans' : state.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $('langBtn').textContent = I18N[state.lang]._label;
    $('pwStep').textContent = t('step', { n: 1 });
    $('nameStep').textContent = t('step', { n: 2 });
    langButtons($('langSeg'));
    langButtons($('onboardLang'));
    render();
  }
  function setLang(code) { state.lang = code; store.set('lang', code); applyI18n(); }

  // ---------- IndexedDB (queue survives offline + app restarts) ----------
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

  // ---------- Backend (Apps Script) ----------
  // text/plain avoids a CORS preflight, which Apps Script cannot answer.
  async function api(body) {
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 600));
      if (body.action === 'folders') return { ok: true, folders: DEMO_FOLDERS };
      return { ok: true, id: 'demo' };
    }
    const r = await fetch(CFG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg, err = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
  }
  const openSheet = (id) => { $(id).hidden = false; };
  const closeSheet = (id) => { $(id).hidden = true; };
  document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd || e.target.closest('[data-close]')) {
        bd.hidden = true;
        if (bd.id === 'reviewSheet') resetReview();
      }
    });
  });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Onboarding ----------
  // Step 1 (password) must succeed before step 2 (name); both before the camera.
  function showOnboard(mode) {
    state.onboardMode = mode;
    clearTimeout(toastTimer); $('toast').className = 'toast';
    const pwStep = mode === 'pw' || mode === 'reenter' || mode === 'pwChanged';
    $('onboard').hidden = false;
    $('pwForm').hidden = !pwStep;
    $('nameForm').hidden = pwStep;
    $('pwNotice').hidden = mode !== 'pwChanged';
    $('pwCancel').hidden = mode !== 'reenter';
    $('nameCancel').hidden = mode !== 'editName';
    $('pwErr').textContent = '';
    $('pwInput').value = '';
    $('pwInput').classList.remove('bad');
    $('nameInput').value = state.name || '';
    setTimeout(() => (pwStep ? $('pwInput') : $('nameInput')).focus(), 50);
  }
  function hideOnboard() { $('onboard').hidden = true; state.onboardMode = null; }
  function needsOnboard() {
    if (!state.password) { showOnboard('pw'); return true; }
    if (!state.name) { showOnboard('name'); return true; }
    return false;
  }

  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('pwInput').value.trim();
    const err = (msg) => { $('pwErr').textContent = msg; $('pwInput').classList.remove('bad'); void $('pwInput').offsetWidth; $('pwInput').classList.add('bad'); };
    if (!pw) return err(t('wrongPw'));
    if (!navigator.onLine && !DEMO) return err(t('needNet'));
    const btn = $('pwSubmit');
    btn.disabled = true; btn.textContent = t('checking');
    try {
      const res = await api({ action: 'folders', key: pw });
      if (res.ok) {
        state.password = pw; store.set('pw', pw);
        setFolders(res.folders);
        if (state.name) { hideOnboard(); processQueue(); } else showOnboard('name');
        render();
      } else if (res.error === 'bad_key') err(t('wrongPw'));
      else err(t('serverErr'));
    } catch (ex) {
      console.error(ex); err(t('serverErr'));
    } finally {
      btn.disabled = false; btn.textContent = t('next');
    }
  });
  $('nameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim();
    if (!name) { $('nameInput').classList.remove('bad'); void $('nameInput').offsetWidth; $('nameInput').classList.add('bad'); return; }
    state.name = name; store.set('name', name);
    hideOnboard(); render(); processQueue();
  });
  $('pwCancel').onclick = hideOnboard;
  $('nameCancel').onclick = hideOnboard;

  // ---------- Render ----------
  function render() {
    $('demoBanner').hidden = !DEMO;
    $('offlineBanner').hidden = navigator.onLine;

    const cur = state.folders.find((f) => f.id === state.currentFolder);
    $('destName').textContent = cur ? cur.name : t('noFolder') + ' · ' + t('tapToChoose');
    $('destName').classList.toggle('muted', !cur);

    const pending = state.items.filter((i) => i.status !== 'done');
    const today = new Date().toDateString();
    $('statToday').textContent = state.items.filter((i) => new Date(i.createdAt).toDateString() === today).length;
    $('statPending').textContent = pending.length;
    $('statDone').textContent = state.items.filter((i) => i.status === 'done').length;

    const items = [...state.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    $('emptyState').hidden = items.length > 0;
    $('recentGrid').innerHTML = items.map((i) => {
      const icon = i.status === 'done' ? '<svg><use href="#i-check"/></svg>' : i.status === 'error' ? '<svg><use href="#i-retry"/></svg>' : '';
      return `<button class="tile" data-id="${esc(i.id)}">
        <img src="${i.thumb}" alt="" loading="lazy">
        <div class="tile-folder">${esc(i.folderName)}</div>
        <div class="tile-badge b-${i.status}">${icon}<span>${t(i.status === 'error' ? 'retry' : i.status)}</span></div>
      </button>`;
    }).join('');

    $('gpsToggle').checked = state.gps;
    $('nameValue').textContent = state.name || '—';
    renderFolderList();
  }

  const folderChip = (f, on) => `<svg><use href="#i-folder-fill"/></svg><span class="name">${esc(f.name)}</span>
      <span class="tick">${on ? '<svg><use href="#i-check"/></svg>' : ''}</span>`;

  function renderFolderList() {
    const ul = $('folderList');
    if (!state.folders.length) { ul.innerHTML = `<li class="none">${esc(t('noFolders'))}</li>`; return; }
    ul.innerHTML = state.folders.map((f) => `<li>
      <button class="chip ${f.id === state.currentFolder ? 'on' : ''}" data-pick="${esc(f.id)}">${folderChip(f, f.id === state.currentFolder)}</button>
    </li>`).join('');
  }

  function renderReviewFolders() {
    $('reviewFolders').innerHTML = state.folders.length
      ? state.folders.map((f) => `<button class="chip ${f.id === state.reviewFolder ? 'on' : ''}" data-rf="${esc(f.id)}">${folderChip(f, f.id === state.reviewFolder)}</button>`).join('')
      : `<div class="hint">${esc(t('noFolders'))}</div>`;
    $('saveBtn').textContent = t('saveBtn', { n: state.pending.length });
    $('saveBtn').disabled = !state.reviewFolder || !state.pending.length;
  }

  // ---------- Folders (come from sub-folders of the Drive root folder) ----------
  function setCurrentFolder(id) { state.currentFolder = id; store.set('currentFolder', id); }
  function setFolders(list) {
    state.folders = list || [];
    store.set('folders', state.folders);
    if (state.currentFolder && !state.folders.some((f) => f.id === state.currentFolder)) setCurrentFolder(null);
    if (!state.currentFolder && state.folders.length === 1) setCurrentFolder(state.folders[0].id);
  }
  async function refreshFolders(showToast) {
    if (!state.password || (!navigator.onLine && !DEMO)) { if (showToast) toast(t('offline'), true); return; }
    try {
      const res = await api({ action: 'folders', key: state.password });
      if (res.ok) { setFolders(res.folders); render(); if (showToast) toast(t('refreshed')); }
      else if (res.error === 'bad_key') passwordRejected();
      else if (showToast) toast(t('serverErr'), true);
    } catch (e) { console.error(e); if (showToast) toast(t('serverErr'), true); }
  }
  function passwordRejected() {
    state.password = null; store.del('pw');
    closeSheet('reviewSheet'); closeSheet('folderSheet'); closeSheet('settingsSheet');
    showOnboard('pwChanged');
  }

  $('folderList').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { setCurrentFolder(pick.dataset.pick); render(); closeSheet('folderSheet'); }
  });
  $('destCard').onclick = () => { openSheet('folderSheet'); refreshFolders(false); };
  $('foldersBtn').onclick = () => { openSheet('folderSheet'); refreshFolders(false); };
  $('refreshFoldersBtn').onclick = async () => {
    const b = $('refreshFoldersBtn'); b.disabled = true;
    await refreshFolders(true);
    b.disabled = false;
  };
  $('reviewFolders').addEventListener('click', (e) => {
    const rf = e.target.closest('[data-rf]');
    if (rf) { state.reviewFolder = rf.dataset.rf; renderReviewFolders(); }
  });

  // ---------- Capture flow ----------
  function onFiles(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    e.target.value = '';
    if (!files.length) return;
    if (needsOnboard()) return;
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

  // Resize to MAX_EDGE and re-encode as JPEG. Falls back to the original file if the
  // browser cannot decode it (e.g. HEIC outside Safari).
  async function compress(file) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const thumbC = document.createElement('canvas');
      const ts = 240 / Math.min(c.width, c.height);
      thumbC.width = Math.round(c.width * ts); thumbC.height = Math.round(c.height * ts);
      thumbC.getContext('2d').drawImage(c, 0, 0, thumbC.width, thumbC.height);
      bmp.close?.();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', JPEG_QUALITY));
      return { blob, mime: 'image/jpeg', ext: 'jpg', thumb: thumbC.toDataURL('image/jpeg', 0.7) };
    } catch (e) {
      console.warn('compress failed, using original', e);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      return { blob: file, mime: file.type || 'image/jpeg', ext,
        thumb: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#cfd8cf"/></svg>') };
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const clean = (s, n) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, n);
  function fileName(date, folderName, ext, id) {
    const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    // Short id makes every name unique, which the backend uses to skip duplicate retries.
    return `durian_${clean(folderName, 40)}_${d}_${clean(state.name, 20)}_${id.slice(0, 6)}.${ext}`;
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
    const description = [
      note,
      `Photographer: ${state.name}`,
      `Captured: ${now.toISOString()}`,
      pos ? `GPS: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (±${pos.acc} m)` : '',
      pos ? `Map: https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : '',
      'Source: Durimage',
    ].filter(Boolean).join('\n');

    for (let i = 0; i < files.length; i++) {
      const id = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      const c = await compress(files[i]);
      const item = {
        id, createdAt: Date.now() + i, status: 'queued',
        folderId: folder.id, folderName: folder.name,
        name: fileName(new Date(now.getTime() + i * 1000), folder.name, c.ext, id),
        mime: c.mime, description, thumb: c.thumb,
      };
      await putBlob(id, c.blob);
      await putItem(item);
      state.items.push(item);
    }
    resetReview();
    render();
    toast(t(navigator.onLine ? 'savedQueued' : 'savedOffline', { n: files.length }));
    processQueue();
  };

  // ---------- Upload queue ----------
  const toBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  async function uploadOne(item) {
    const blob = await getBlob(item.id);
    if (!blob) throw new Error('missing blob');
    return api({
      action: 'upload', key: state.password,
      folderId: item.folderId, name: item.name, mimeType: item.mime,
      description: item.description, data: await toBase64(blob),
    });
  }

  async function processQueue() {
    if (state.uploading || !navigator.onLine || !state.password) return;
    state.uploading = true;
    const doneByFolder = {};
    let rejected = false;
    try {
      for (const item of [...state.items].sort((a, b) => a.createdAt - b.createdAt)) {
        if (item.status === 'done' || item.status === 'error') continue;
        if (!navigator.onLine) break;
        item.status = 'uploading'; render();
        try {
          const res = await uploadOne(item);
          if (res.ok) {
            item.status = 'done'; item.driveId = res.id; item.error = null;
            await delBlob(item.id);
            doneByFolder[item.folderName] = (doneByFolder[item.folderName] || 0) + 1;
          } else if (res.error === 'bad_key') {
            item.status = 'queued'; rejected = true;
          } else if (res.error === 'bad_folder') {
            item.status = 'error'; item.error = res.error; // folder removed/renamed by admin
          } else {
            item.status = 'error'; item.error = res.error || 'unknown';
          }
        } catch (e) {
          console.error(e);
          item.status = 'queued'; // network problem: keep for the next attempt
          item.error = String(e.message || e);
          await putItem(item);
          break;
        }
        await putItem(item);
        render();
        if (rejected) break;
      }
    } finally {
      state.uploading = false;
    }
    const entries = Object.entries(doneByFolder);
    if (entries.length) toast(entries.map(([f, n]) => t('uploadedOk', { n, f })).join(' · '));
    else if (state.items.some((i) => i.status === 'error')) toast(t('uploadFail'), true);
    await trimHistory();
    render();
    if (rejected) passwordRejected();
  }

  async function trimHistory() {
    const done = state.items.filter((i) => i.status === 'done').sort((a, b) => b.createdAt - a.createdAt);
    const drop = done.slice(120);
    for (const old of drop) await delItem(old.id);
    const ids = new Set(drop.map((i) => i.id));
    state.items = state.items.filter((i) => !ids.has(i.id));
  }

  $('recentGrid').addEventListener('click', async (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const item = state.items.find((i) => i.id === tile.dataset.id);
    if (item && item.status === 'error') {
      // If the folder disappeared, send it to the currently selected folder instead.
      if (item.error === 'bad_folder' && state.currentFolder) {
        const f = state.folders.find((x) => x.id === state.currentFolder);
        if (f) { item.folderId = f.id; item.folderName = f.name; }
      }
      item.status = 'queued'; await putItem(item); render();
      processQueue();
    }
  });

  // ---------- Settings ----------
  $('settingsBtn').onclick = () => openSheet('settingsSheet');
  $('langBtn').onclick = () => {
    const codes = Object.keys(I18N);
    setLang(codes[(codes.indexOf(state.lang) + 1) % codes.length]);
  };
  $('gpsToggle').onchange = (e) => { state.gps = e.target.checked; store.set('gps', state.gps); };
  $('editNameBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('editName'); };
  $('reenterPwBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('reenter'); };
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
      for (const i of state.items) if (i.status === 'uploading') { i.status = 'queued'; await putItem(i); }
    } catch (e) { console.error(e); }
    applyI18n();
    if (!needsOnboard()) { refreshFolders(false); processQueue(); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
