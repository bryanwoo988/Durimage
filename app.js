(() => {
  'use strict';

  const CFG = window.DURIMAGE_CONFIG || {};
  const DEMO = !CFG.SCRIPT_URL;
  const MAX_EDGE = 2560;      // fallback only: longest side when original upload is impossible
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
    appearance: store.get('appearance', 'system'), // 'system' | 'light' | 'dark'
    lightTheme: store.get('lightTheme', 'paper'),
    darkTheme: store.get('darkTheme', 'midnight'),
    items: [],
    pending: [],
    reviewFolder: null,
    position: null,
    uploading: false,
    batch: null, // { total, done } while an upload run is going
    onboardMode: null, // 'pw' | 'name' | 'reenter' | 'editName' | 'pwChanged'
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
    // One button cycles 华文 → EN → BM → 华文
    const codes = Object.keys(I18N);
    $('onboardLangLabel').textContent = I18N[codes[(codes.indexOf(state.lang) + 1) % codes.length]]._name; // shows the language you'd switch TO
    $('langName').textContent = I18N[state.lang]._name;
    $('pwStep').textContent = t('step', { n: 1 }) + ' · ' + t('pwTitle');
    $('nameStep').textContent = t('step', { n: 2 }) + ' · ' + t('nameTitle');
    render();
  }
  function setLang(code) { state.lang = code; store.set('lang', code); applyI18n(); }
  function cycleLang() {
    const codes = Object.keys(I18N);
    setLang(codes[(codes.indexOf(state.lang) + 1) % codes.length]);
  }

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
  const openSheet = (id) => { clearTimeout(toastTimer); $('toast').className = 'toast'; $(id).hidden = false; };
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
    // No auto-focus on first launch: the keyboard would cover the intro. Focus only when re-entering.
    if (mode !== 'pw') setTimeout(() => (pwStep ? $('pwInput') : $('nameInput')).focus(), 50);
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

  // ---------- Date helpers ----------
  const LOCALE = () => ({ zh: 'zh-CN', en: 'en-GB', ms: 'ms-MY' }[state.lang] || 'en-GB');
  function dayLabel(d) {
    const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t('dToday');
    if (d.toDateString() === y.toDateString()) return t('dYesterday');
    return d.toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric', weekday: 'short' });
  }
  const timeLabel = (d) => d.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit', hour12: false });

  // ---------- Upload progress bar ----------
  function renderUploadBar(pending) {
    const bar = $('uploadBar');
    if (!pending.length && !state.batch) { bar.hidden = true; return; }
    bar.hidden = false;
    const b = state.batch;
    if (b) {
      $('uploadText').textContent = t('uploadingN', { d: Math.min(b.done + 1, b.total), n: b.total });
      $('uploadFill').style.width = Math.round((b.done / b.total) * 100) + '%';
    } else {
      $('uploadText').textContent = t('waitingN', { n: pending.length });
      $('uploadFill').style.width = '0%';
    }
    bar.classList.toggle('active', !!b);
    $('uploadAllBtn').hidden = !!b || !navigator.onLine || !state.password;
    $('uploadHint').hidden = !b;
  }

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

    const items = [...state.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
    $('emptyState').hidden = items.length > 0;
    let lastDay = '';
    $('recentGrid').innerHTML = items.map((i) => {
      const d = new Date(i.capturedAt || i.createdAt);
      const day = dayLabel(d);
      const head = day !== lastDay ? `<div class="grid-date">${esc(day)}</div>` : '';
      lastDay = day;
      const icon = i.status === 'done' ? '<svg><use href="#i-check"/></svg>' : i.status === 'error' ? '<svg><use href="#i-retry"/></svg>' : '';
      return `${head}<button class="tile" data-id="${esc(i.id)}">
        <img src="${i.thumb}" alt="" loading="lazy">
        <div class="tile-folder">${esc(i.folderName)}</div>
        ${i.note ? '<div class="tile-note"><svg><use href="#i-note"/></svg></div>' : ''}
        <div class="tile-badge b-${i.status}">${icon}<span>${t(i.status === 'error' ? 'retry' : i.status)}</span></div>
        <div class="tile-time">${esc(timeLabel(d))}</div>
      </button>`;
    }).join('');
    renderUploadBar(pending);

    $('gpsToggle').checked = state.gps;
    $('nameValue').textContent = state.name || '—';
    renderAppearance();
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

  const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#cfd8cf"/></svg>');

  // Draw an image scaled so its longest side is maxEdge (or shortest side is minEdge).
  async function drawScaled(file, { maxEdge, minEdge }) {
    const bmp = await createImageBitmap(file);
    const scale = maxEdge ? Math.min(1, maxEdge / Math.max(bmp.width, bmp.height)) : minEdge / Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return c;
  }
  async function makeThumb(file) {
    try { return (await drawScaled(file, { minEdge: 240 })).toDataURL('image/jpeg', 0.7); }
    catch { return PLACEHOLDER; }
  }
  async function makePreview(file) {
    try {
      const c = await drawScaled(file, { maxEdge: 1280 });
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    } catch { return null; }
  }
  // Only used as a fallback when sending the original straight to Drive is not possible.
  async function compress(file) {
    const c = await drawScaled(file, { maxEdge: MAX_EDGE });
    return new Promise((r) => c.toBlob(r, 'image/jpeg', JPEG_QUALITY));
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
      const f = files[i];
      const ext = ((f.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg').toLowerCase();
      const item = {
        id, createdAt: Date.now() + i, status: 'queued',
        folderId: folder.id, folderName: folder.name,
        name: fileName(new Date(now.getTime() + i * 1000), folder.name, ext, id),
        mime: f.type || 'image/jpeg', size: f.size, description, note, thumb: await makeThumb(f),
        capturedAt: now.toISOString(), pos: pos || null, by: state.name,
      };
      await putBlob(id, f); // the untouched original
      const preview = await makePreview(f);
      if (preview) await putBlob(id + '_p', preview); // kept after upload so the detail view still has a picture
      await putItem(item);
      state.items.push(item);
    }
    resetReview();
    render();
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
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

  // Original photo: Apps Script opens a Drive upload session, the phone sends the file
  // straight to Drive (no Google login, no size limit from Apps Script).
  // If this device cannot do that, fall back to a compressed copy sent through Apps Script.
  async function uploadOne(item) {
    const blob = await getBlob(item.id);
    if (!blob) throw new Error('missing blob');
    if (DEMO) return api({ action: 'upload' });

    const ses = await api({
      action: 'session', key: state.password, origin: location.origin,
      folderId: item.folderId, name: item.name, mimeType: item.mime, size: blob.size,
      description: item.description,
    });
    if (!ses.ok || ses.duplicate) return ses;

    try {
      const put = await fetch(ses.uploadUrl, { method: 'PUT', headers: { 'Content-Type': item.mime }, body: blob });
      if (!put.ok) throw new Error('put ' + put.status);
      const j = await put.json();
      store.set('directOk', true);
      return { ok: true, id: j.id };
    } catch (e) {
      // A device that has sent originals before → this is just a network problem, retry later.
      if (store.get('directOk', false) || !navigator.onLine) throw e;
      console.warn('direct upload not possible here, sending compressed copy', e);
      const small = await compress(blob);
      const name = item.name.replace(/\.[^.]+$/, '.jpg');
      const r = await api({
        action: 'upload', key: state.password,
        folderId: item.folderId, name, mimeType: 'image/jpeg',
        description: item.description + '\n(Compressed copy: original upload not supported on this device)',
        data: await toBase64(small),
      });
      return { ...r, compressed: true, name };
    }
  }

  // Only photos with a note get a row in the Google Sheet (newest row on top).
  const logRow = (item) => ({
    action: 'log', key: state.password,
    folderId: item.folderId, folderName: item.folderName,
    fileId: item.driveId, name: item.uploadedName || item.name,
    note: item.note, photographer: state.name,
    capturedAt: item.capturedAt || new Date(item.createdAt).toISOString(),
    lat: item.pos ? item.pos.lat : null, lng: item.pos ? item.pos.lng : null, acc: item.pos ? item.pos.acc : null,
    quality: item.compressed ? 'compressed' : 'original',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const CONCURRENCY = 3; // photos sent at the same time

  async function processOne(item, run) {
    item.status = 'uploading'; render();
    try {
      // Photo first (skipped if an earlier attempt already got it into Drive), then the Sheet row.
      let res = { ok: true, id: item.driveId };
      if (!item.driveId) {
        res = await uploadOne(item);
        if (res.ok) {
          item.driveId = res.id; item.compressed = !!res.compressed; if (res.name) item.uploadedName = res.name;
          await putItem(item); await delBlob(item.id);
        }
      }
      if (res.ok && item.note && !item.logged) {
        res = await api(logRow(item));
        if (res.ok) item.logged = true;
      }
      if (res.ok) {
        item.status = 'done'; item.error = null;
        run.doneByFolder[item.folderName] = (run.doneByFolder[item.folderName] || 0) + 1;
      } else if (res.error === 'bad_key') {
        item.status = 'queued'; run.rejected = true;
      } else {
        item.status = 'error'; item.error = res.error || 'unknown'; // e.g. bad_folder: removed by admin
      }
    } catch (e) {
      console.error(e);
      item.status = 'queued'; // network problem: keep it for the next attempt
      item.error = String(e.message || e);
      run.stop = true;
    }
    await putItem(item);
  }

  async function processQueue() {
    if (state.uploading || !navigator.onLine || !state.password) return;
    const todo = state.items.filter((i) => i.status === 'queued' || i.status === 'uploading')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!todo.length) { render(); return; }
    state.uploading = true;
    state.batch = { total: todo.length, done: 0 };
    const run = { doneByFolder: {}, rejected: false, stop: false };
    let next = 0;
    const worker = async () => {
      while (!run.stop && !run.rejected && navigator.onLine) {
        const item = todo[next++];
        if (!item) return;
        await processOne(item, run);
        state.batch.done++;
        render();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    } finally {
      state.uploading = false;
      state.batch = null;
      // Anything this run did not reach goes back to "queued" (e.g. stopped by a network drop).
      for (const i of todo) if (i.status === 'uploading') { i.status = 'queued'; await putItem(i); }
    }
    const entries = Object.entries(run.doneByFolder);
    if (entries.length) toast(entries.map(([f, n]) => t('uploadedOk', { n, f })).join(' · '));
    else if (state.items.some((i) => i.status === 'error')) toast(t('uploadFail'), true);
    await trimHistory();
    render();
    if (run.rejected) { passwordRejected(); return; }
    // Photos saved while this run was going → start another run.
    if (!run.stop && navigator.onLine && state.items.some((i) => i.status === 'queued')) processQueue();
  }

  async function trimHistory() {
    const done = state.items.filter((i) => i.status === 'done').sort((a, b) => b.createdAt - a.createdAt);
    const drop = done.slice(120);
    for (const old of drop) { await delItem(old.id); await delBlob(old.id + '_p'); }
    const ids = new Set(drop.map((i) => i.id));
    state.items = state.items.filter((i) => !ids.has(i.id));
  }

  // ---------- Photo detail ----------
  let detailUrl = null, detailId = null;
  function requeue(item) {
    // If the folder disappeared, send it to the currently selected folder instead.
    if (item.error === 'bad_folder' && state.currentFolder) {
      const f = state.folders.find((x) => x.id === state.currentFolder);
      if (f) { item.folderId = f.id; item.folderName = f.name; }
    }
    item.status = 'queued'; item.error = null;
    return putItem(item);
  }
  async function openDetail(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    detailId = id;
    if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; }
    const blob = (await getBlob(id + '_p')) || (await getBlob(id));
    if (blob) detailUrl = URL.createObjectURL(blob);
    $('detailImg').src = detailUrl || item.thumb;
    const badge = $('detailBadge');
    badge.className = 'tile-badge b-' + item.status;
    badge.textContent = t(item.status);
    $('detailErr').hidden = item.status !== 'error';
    $('detailErr').textContent = item.error === 'bad_folder' ? t('errFolder') : t('errGeneric');
    const d = new Date(item.capturedAt || item.createdAt);
    const pos = item.pos;
    const rows = [
      ['fFolder', esc(item.folderName)],
      ['fTime', esc(d.toLocaleString(LOCALE(), { dateStyle: 'medium', timeStyle: 'short' }))],
      ['fBy', esc(item.by || (item.description.match(/^Photographer: (.*)$/m) || [])[1] || '')],
      ['fNote', item.note ? esc(item.note).replace(/\n/g, '<br>') : `<span class="muted">${esc(t('noNote'))}</span>`],
      ['fGps', pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (±${pos.acc} m)<br><a href="https://maps.google.com/?q=${pos.lat},${pos.lng}" target="_blank" rel="noopener">${esc(t('openMap'))}</a>` : `<span class="muted">${esc(t('noGps'))}</span>`],
      ['fFile', `<span class="mono">${esc(item.uploadedName || item.name)}</span>`],
    ];
    if (item.status === 'done') rows.push(['fQuality', esc(t(item.compressed ? 'qCompressed' : 'qOriginal'))]);
    $('detailList').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>`).join('');
    const canAct = item.status !== 'done' && item.status !== 'uploading';
    $('detailFoot').hidden = !canAct;
    $('detailRetry').hidden = !(item.status === 'error' || (item.status === 'queued' && navigator.onLine));
    openSheet('detailSheet');
  }
  $('recentGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) openDetail(tile.dataset.id);
  });
  $('detailRetry').onclick = async () => {
    const item = state.items.find((i) => i.id === detailId);
    if (!item) return;
    await requeue(item);
    closeSheet('detailSheet'); render(); processQueue();
  };
  $('detailDelete').onclick = async () => {
    const item = state.items.find((i) => i.id === detailId);
    if (!item || !confirm(t('confirmDelete'))) return;
    await delItem(item.id); await delBlob(item.id); await delBlob(item.id + '_p');
    state.items = state.items.filter((i) => i.id !== item.id);
    closeSheet('detailSheet'); render(); toast(t('deleted'));
  };
  $('uploadAllBtn').onclick = async () => {
    for (const i of state.items) if (i.status === 'error') await requeue(i);
    render(); processQueue();
  };

  // ---------- Appearance: 4 light + 4 dark themes ----------
  // Swatch colours mirror the CSS variables in styles.css: [background, card, accent]
  const THEMES = {
    light: { classic: ['#f3f5f8', '#ffffff', '#2f9e6a'], paper: ['#f4f1e8', '#ffffff', '#1f7a43'],
             mint: ['#eef6f2', '#ffffff', '#2b7a64'], lavender: ['#f3f1fb', '#ffffff', '#5b3aa6'] },
    dark:  { midnight: ['#0b1220', '#131c2e', '#3fae7a'], oled: ['#000000', '#0e0e0e', '#3fae7a'],
             slate: ['#1c2027', '#262b34', '#5b93d6'], grape: ['#120d1e', '#1c1530', '#9b7be6'] },
  };
  const darkMql = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const dark = state.appearance === 'dark' || (state.appearance === 'system' && !!darkMql && darkMql.matches);
    document.documentElement.dataset.theme = dark ? state.darkTheme : state.lightTheme;
    document.documentElement.dataset.dark = dark ? '1' : '';
  }
  darkMql && darkMql.addEventListener && darkMql.addEventListener('change', () => { if (state.appearance === 'system') applyTheme(); });
  function renderAppearance() {
    $('modeSeg').innerHTML = ['system', 'light', 'dark'].map((m) =>
      `<button type="button" data-mode="${m}" class="${state.appearance === m ? 'on' : ''}">${esc(t('mode' + m[0].toUpperCase() + m.slice(1)))}</button>`).join('');
    $('appearValue').textContent = appearSummary();
    for (const kind of ['light', 'dark']) {
      const chosen = kind === 'light' ? state.lightTheme : state.darkTheme;
      $(kind + 'Swatches').innerHTML = Object.entries(THEMES[kind]).map(([id, [bg, card, accent]]) =>
        `<button type="button" class="swatch ${id === chosen ? 'on' : ''}" data-kind="${kind}" data-theme="${id}">
          <span class="swatch-prev" style="background:${bg};border-color:${kind === 'dark' ? '#333' : '#dcdcdc'}">
            <i style="background:${card}"></i><b style="background:${accent}"></b><u></u>
          </span>${esc(t('th_' + id))}</button>`).join('');
    }
  }
  function appearSummary() {
    const mode = t('mode' + state.appearance[0].toUpperCase() + state.appearance.slice(1));
    return `${mode} · ${t('th_' + state.lightTheme)} / ${t('th_' + state.darkTheme)}`;
  }
  $('appearRowBtn').onclick = () => { closeSheet('settingsSheet'); openSheet('appearSheet'); };
  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    state.appearance = b.dataset.mode; store.set('appearance', state.appearance);
    applyTheme(); renderAppearance();
  });
  ['lightSwatches', 'darkSwatches'].forEach((id) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.swatch'); if (!b) return;
    if (b.dataset.kind === 'light') { state.lightTheme = b.dataset.theme; store.set('lightTheme', state.lightTheme); }
    else { state.darkTheme = b.dataset.theme; store.set('darkTheme', state.darkTheme); }
    // Picking a theme of the other kind than what is showing switches to it, so you see the result.
    if (state.appearance !== 'system') { state.appearance = b.dataset.kind; store.set('appearance', state.appearance); }
    applyTheme(); renderAppearance();
  }));

  // ---------- Settings ----------
  $('settingsBtn').onclick = () => openSheet('settingsSheet');
  $('onboardLangBtn').onclick = cycleLang;
  $('langCycleBtn').onclick = cycleLang;

  // ---------- Share via QR ----------
  const shareUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
  function openShare() {
    const url = shareUrl();
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qrBox').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    $('shareUrl').textContent = url;
    $('nativeShareBtn').hidden = !navigator.share;
    $('nativeShareBtn').parentElement.classList.toggle('single', !navigator.share);
    closeSheet('settingsSheet');
    openSheet('shareSheet');
  }
  $('shareRowBtn').onclick = openShare;
  $('copyLinkBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(shareUrl()); toast(t('linkCopied')); }
    catch { prompt(t('copyLink'), shareUrl()); }
  };
  $('nativeShareBtn').onclick = () => {
    navigator.share({ title: 'Durimage', text: t('shareDesc'), url: shareUrl() }).catch(() => {});
  };
  $('gpsToggle').onchange = (e) => { state.gps = e.target.checked; store.set('gps', state.gps); };
  $('editNameBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('editName'); };
  $('reenterPwBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('reenter'); };
  $('clearHistoryBtn').onclick = async () => {
    for (const i of state.items.filter((x) => x.status === 'done')) { await delItem(i.id); await delBlob(i.id + '_p'); }
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
    applyTheme();
    applyI18n();
    if (!needsOnboard()) { refreshFolders(false); processQueue(); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
