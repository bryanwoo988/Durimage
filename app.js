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
    track: store.get('track', true),             // record orchard + tree
    orchard: store.get('orchard', ''),
    recentOrchards: store.get('recentOrchards', []),
    trees: store.get('trees', {}),               // { ORCHARD: { mode: 'seq'|'tag', seq, tag, day } }
    pcount: store.get('pcount', {}),             // photos per tree per day → the -pNN number
    reviewSource: 'camera', reviewSnap: null,
    role: store.get('role', 'team'),             // 'team' | 'reviewer' | 'admin'
    revName: store.get('revName', ''),           // reviewer's display name (any language)
    cats: store.get('cats', null),               // pest/disease list from the backend
    filter: { q: '', orchard: '', tree: '', cats: [], date: 'all', flags: [], folder: '' },
    selecting: false, selected: new Set(),
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
  function setLang(code) { state.lang = code; store.set('lang', code); applyI18n(); if ($('myMarkBtn')) renderMyMarkBtn(); }
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
      await new Promise((r) => setTimeout(r, 300));
      return demoApi(body);
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
  const closeSheet = (id) => { $(id).hidden = true; if (id === 'detailSheet' || id === 'reviewSheet') { const v = $('viewer'); if (v && !v.hidden) closeViewer(); } };
  document.querySelectorAll('.sheet-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      const outside = e.target === bd;
      if (outside && bd.id === 'reviewSheet') return; // never discard just-taken photos by a stray tap
      if (outside || e.target.closest('[data-close]')) {
        bd.hidden = true;
        if (bd.id === 'reviewSheet') { resetReview(); maybeReload(); }
        if (bd.id === 'orchardSheet' || bd.id === 'treeSheet') pendingCamera = false;
      }
    });
  });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Onboarding ----------
  // Step 1 (password) must succeed before step 2 (name); both before the camera.
  function showOnboard(mode) {
    state.onboardMode = mode;
    document.body.classList.add('ob-mode'); document.documentElement.classList.add('ob-mode'); window.scrollTo(0, 0);
    setPwVisible(false);
    clearTimeout(toastTimer); $('toast').className = 'toast';
    const pwStep = mode === 'pw' || mode === 'reenter' || mode === 'pwChanged';
    $('onboard').hidden = false;
    $('pwForm').hidden = !pwStep;
    $('nameForm').hidden = pwStep;
    $('pwNotice').hidden = mode !== 'pwChanged';
    $('pwCancel').hidden = mode !== 'reenter';
    $('nameCancel').hidden = mode !== 'editName';
    $('nameNotice').hidden = mode !== 'nameAscii';
    const rev = state.role === 'reviewer';
    $('nameStep').textContent = t('step', { n: 2 }) + ' · ' + t(rev ? 'reviewerNameTitle' : 'nameTitle');
    $('nameForm').querySelector('.ob-help').textContent = t(rev ? 'reviewerNameDesc' : 'nameDesc');
    $('pwErr').textContent = '';
    $('pwInput').value = '';
    $('pwInput').classList.remove('bad');
    $('nameInput').value = state.role === 'reviewer' ? (state.revName || '') : nonAscii(state.name) ? '' : (state.name || '');
    // No auto-focus on first launch: the keyboard would cover the intro. Focus only when re-entering.
    if (mode !== 'pw') setTimeout(() => (pwStep ? $('pwInput') : $('nameInput')).focus(), 50);
  }
  function hideOnboard() {
    $('onboard').hidden = true; state.onboardMode = null;
    document.body.classList.remove('ob-mode'); document.documentElement.classList.remove('ob-mode');
    maybeShowWhatsNew();
    applyRole();
    if (state.password && state.name && state.role !== 'reviewer') gpsStart(); // location permission is asked now, not when the camera opens
  }
  function setPwVisible(on) {
    $('pwInput').type = on ? 'text' : 'password';
    $('pwEye').querySelector('use').setAttribute('href', on ? '#i-eye-off' : '#i-eye');
    $('pwEye').setAttribute('aria-label', t(on ? 'hidePw' : 'showPw'));
    $('pwEye').setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('pwEye').onclick = () => { setPwVisible($('pwInput').type === 'password'); $('pwInput').focus(); };
  function needsOnboard() {
    if (!state.password) { showOnboard('pw'); return true; }
    if (state.role === 'reviewer') { if (!state.revName) { showOnboard('revName'); return true; } return false; }
    if (!state.name) { showOnboard('name'); return true; }
    if (nonAscii(state.name)) { showOnboard('nameAscii'); return true; } // file names are English-only
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
      let res = await api({ action: 'login', key: pw });
      let role = res.role;
      if (!res.ok && res.error === 'bad_action') { role = 'team'; res = { ok: true }; } // backend not updated yet
      if (res.ok) {
        state.password = pw; store.set('pw', pw);
        state.role = role || 'team'; store.set('role', state.role);
        if (state.role !== 'reviewer') { const f = await api({ action: 'folders', key: pw }); if (f.ok) setFolders(f.folders); }
        loadCats();
        applyRole();
        if (!needsOnboard()) { hideOnboard(); processQueue(); }
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
    if (state.role === 'reviewer') { // reviewers: name only shown to the admin, any language is fine
      const rn = $('nameInput').value.trim().replace(/\s+/g, ' ').slice(0, 30);
      if (!rn) { $('nameInput').classList.remove('bad'); void $('nameInput').offsetWidth; $('nameInput').classList.add('bad'); return; }
      state.revName = rn; store.set('revName', rn);
      hideOnboard(); applyRole(); render(); return;
    }
    const name = $('nameInput').value.replace(/[^A-Za-z0-9 \-]/g, '').trim().replace(/\s+/g, ' ');
    if (!name) { $('nameInput').classList.remove('bad'); void $('nameInput').offsetWidth; $('nameInput').classList.add('bad'); return; }
    state.name = name; store.set('name', name);
    hideOnboard(); render(); processQueue();
  });
  $('pwCancel').onclick = hideOnboard;
  asciiField($('nameInput'), null, false, () => state.role !== 'reviewer');
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

    const filtering = filterActive();
    const matched = [...state.items].filter((i) => passesFilter(i)).sort((a, b) => b.createdAt - a.createdAt);
    const items = matched.slice(0, filtering ? 400 : 60);
    state.visibleIds = items.map((i) => i.id);
    $('emptyState').hidden = items.length > 0 || filtering;
    renderActiveFilters(matched.length);
    let lastDay = '';
    $('recentGrid').innerHTML = items.map((i) => {
      const d = new Date(i.capturedAt || i.createdAt);
      const day = dayLabel(d);
      const head = day !== lastDay ? `<div class="grid-date">${esc(day)}</div>` : '';
      lastDay = day;
      const icon = i.status === 'done' ? '<svg><use href="#i-check"/></svg>' : i.status === 'error' ? '<svg><use href="#i-retry"/></svg>' : '';
      const sel = state.selecting ? ` sel-mode${state.selected.has(i.id) ? ' selected' : ''}` : '';
      const nRev = latestPer(i.reviews || []).length;
      const revTag = !i.sub ? '' : !i.sub.done ? `<div class="tile-rev">${esc(t('subQueued'))}</div>`
        : nRev ? `<div class="tile-rev done">${esc(t('reviewedN', { n: nRev }))}</div>` : `<div class="tile-rev">${esc(t('awaitReview'))}</div>`;
      return `${head}<button class="tile${sel}" data-id="${esc(i.id)}">${revTag}
        <img src="${i.thumb}" alt="" loading="lazy">
        <div class="tile-folder">${esc(i.folderName)}</div>
        ${i.note ? '<div class="tile-note"><svg><use href="#i-note"/></svg></div>' : ''}
        ${i.meta && i.meta.trainOnly ? `<div class="tile-train">${esc(t('trainOnlyShort'))}</div>` : ''}
        <div class="tile-badge b-${i.status}" title="${esc(t(i.status))}">${icon}${i.status === 'done' ? '' : `<span>${t(i.status === 'error' ? 'retry' : i.status)}</span>`}</div>
        <div class="tile-time">${esc(timeLabel(d))}</div>
      </button>`;
    }).join('');
    renderUploadBar(pending);

    $('gpsToggle').checked = state.gps;
    $('nameValue').textContent = state.name || '—';
    renderAppearance();
    renderFolderList();
    renderHistory();
    renderTree();
    renderSelectBar();
    renderRoleBits();
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

  // ---------- Orchard & tree ----------
  // Everything that goes into a file name is plain English letters, digits and '-' ('_' separates fields).
  const asciiClean = (v, max) => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/\\.,:;|]+/g, '-').replace(/[^A-Za-z0-9 \-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max);
  const cleanOrchard = (v) => asciiClean(v, 20).toUpperCase();
  const cleanTag = (v) => asciiClean(v, 12).toUpperCase();
  const cleanNameToken = (v) => asciiClean(v, 20);
  const nonAscii = (v) => /[^\x20-\x7e]/.test(String(v || ''));
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const treeToken = (mode, seq, tag) => (mode === 'tag' ? (tag ? 'tag' + tag : 'tNA') : (seq ? 't' + pad2(seq) : 'tNA'));

  function treeOf(o) {
    if (!state.trees[o]) state.trees[o] = { mode: 'seq', seq: 1, tag: '', day: dayKey() };
    return state.trees[o];
  }
  const saveTrees = () => store.set('trees', state.trees);
  function setOrchard(o) {
    state.orchard = o; store.set('orchard', o);
    state.recentOrchards = [o, ...state.recentOrchards.filter((x) => x !== o)].slice(0, 10);
    store.set('recentOrchards', state.recentOrchards);
    const tr = treeOf(o);
    // A new visit (another day) starts counting from tree 1 again; coming back the same day continues.
    if (tr.mode === 'seq' && tr.day !== dayKey()) { tr.seq = 1; tr.day = dayKey(); }
    saveTrees(); render();
  }
  // Next -pNN for this tree on this day (counted on this phone only).
  function nextPhotoNo(orchard, token, day) {
    const k = `${orchard || 'NA'}|${token}|${day}`;
    const n = (state.pcount[k] || 0) + 1;
    state.pcount[k] = n;
    const keys = Object.keys(state.pcount);
    if (keys.length > 600) keys.sort((a, b) => a.split('|')[2].localeCompare(b.split('|')[2])).slice(0, 200).forEach((x) => delete state.pcount[x]);
    store.set('pcount', state.pcount);
    return n;
  }
  // "B-12" → "B-13", "A-09" → "A-10"; no number at the end → unchanged
  function nextTagGuess(tag) {
    const m = String(tag || '').match(/^(.*?)(\d+)$/);
    if (!m) return tag || '';
    return cleanTag(m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0'));
  }
  function treeDisplay(o) {
    const tr = treeOf(o);
    return tr.mode === 'tag' ? (tr.tag || '') : t('treeN', { n: tr.seq });
  }

  // Live filter for typed fields: drops anything that is not a letter, digit, space or '-'.
  function asciiField(input, warn, upper, active) {
    const run = (e) => {
      if (active && !active()) return;
      if (e && e.isComposing) return; // wait until a Chinese/IME word is finished, then strip it
      const v = input.value;
      let f = v.replace(/[_/\\.,:;|]/g, '-').replace(/[^A-Za-z0-9 \-]/g, '');
      if (upper) f = f.toUpperCase();
      if (f !== v) { input.value = f; }
      if (warn) warn.hidden = !(nonAscii(v) || /[^A-Za-z0-9 \-_/\\.,:;|]/.test(v));
    };
    input.addEventListener('input', run);
    input.addEventListener('compositionend', run);
  }

  function renderTree() {
    const on = state.track;
    $('treeCard').hidden = !on;
    $('nextTreeBtn').hidden = !on;
    $('foldersBtn').hidden = on; // the folder card above still opens the folder list
    $('trackToggle').checked = on;
    $('treeModeGroup').hidden = !on;
    if (!on) return;
    const o = state.orchard;
    $('orchardValue').textContent = o || t('noOrchard');
    $('orchardValue').classList.toggle('muted', !o);
    const tr = o ? treeOf(o) : { mode: 'seq' };
    $('treeLabel').textContent = t(tr.mode === 'tag' ? 'treeTagLabel' : 'treeSeq');
    const tv = o ? treeDisplay(o) : '';
    const missingTag = !!o && tr.mode === 'tag' && !tr.tag;
    $('treeValue').textContent = missingTag ? t('tagMissing') : (tv || '—');
    $('treeValue').classList.toggle('muted', !tv && !missingTag);
    $('treeValue').classList.toggle('warn', missingTag);
    $('treeModeLabel').textContent = t('treeModeLabel', { o: o || '—' });
    $('treeModeSeg').innerHTML = ['seq', 'tag'].map((m) =>
      `<button type="button" data-tm="${m}" class="${o && tr.mode === m ? 'on' : ''}" ${o ? '' : 'disabled'}>${esc(t(m === 'seq' ? 'modeSeq' : 'modeTag'))}</button>`).join('');
    $('treeModeDesc').textContent = !o ? t('modeNeedOrchard') : t(tr.mode === 'tag' ? 'modeTagDesc' : 'modeSeqDesc');
  }

  // Orchard sheet
  let pendingCamera = false;
  function openOrchardSheet() {
    $('orchardInput').value = state.orchard || '';
    $('orchardWarn').hidden = true;
    const rec = state.recentOrchards;
    $('recentTitle').hidden = !rec.length;
    $('recentOrchards').innerHTML = rec.map((o) => `<button type="button" data-o="${esc(o)}" class="${o === state.orchard ? 'on' : ''}">${esc(o)}</button>`).join('');
    openSheet('orchardSheet');
  }
  asciiField($('orchardInput'), $('orchardWarn'), true);
  $('recentOrchards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    $('orchardInput').value = b.dataset.o;
    $('orchardForm').requestSubmit ? $('orchardForm').requestSubmit() : $('orchardForm').dispatchEvent(new Event('submit', { cancelable: true }));
  });
  $('orchardForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = cleanOrchard($('orchardInput').value);
    if (!v) { $('orchardInput').classList.remove('bad'); void $('orchardInput').offsetWidth; $('orchardInput').classList.add('bad'); return; }
    setOrchard(v);
    closeSheet('orchardSheet');
    maybeAskNewDay();
    if (pendingCamera) {
      const tr = treeOf(v);
      if (tr.mode === 'tag' && !tr.tag) { openTreeSheet('tag', ''); $('treeHint').textContent = t('needTagFirst'); return; }
      pendingCamera = false; $('cameraInput').click(); // same tap → camera opens
    }
  });
  $('orchardBtn').onclick = () => openOrchardSheet();

  // Tree number / tag sheet
  let treeSheetMode = 'seq';
  function openTreeSheet(mode, value) {
    treeSheetMode = mode;
    const inp = $('treeInput');
    inp.value = value == null ? '' : String(value);
    inp.inputMode = mode === 'seq' ? 'numeric' : 'text';
    inp.setAttribute('autocapitalize', mode === 'seq' ? 'off' : 'characters');
    inp.maxLength = mode === 'seq' ? 4 : 14;
    $('treeSheetTitle').textContent = t(mode === 'seq' ? 'editTreeTitle' : 'tagTitle');
    $('treeHint').textContent = t(mode === 'seq' ? 'editTreeHint' : 'tagHint');
    $('treeWarn').hidden = true;
    openSheet('treeSheet');
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
  }
  $('treeInput').addEventListener('input', (e) => {
    if (e.isComposing) return;
    const inp = $('treeInput'), v = inp.value;
    const f = treeSheetMode === 'seq' ? v.replace(/\D/g, '') : v.replace(/[_/\\.,:;|]/g, '-').replace(/[^A-Za-z0-9 \-]/g, '').toUpperCase();
    if (f !== v) inp.value = f;
    $('treeWarn').hidden = treeSheetMode === 'seq' || !(nonAscii(v) || /[^A-Za-z0-9 \-_]/.test(v));
  });
  $('treeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const tr = treeOf(state.orchard), inp = $('treeInput');
    const bad = () => { inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad'); };
    if (treeSheetMode === 'seq') {
      const n = parseInt(inp.value, 10);
      if (!(n >= 1 && n <= 9999)) return bad();
      tr.seq = n;
      toast(t('nowTree', { n }));
    } else {
      const v = cleanTag(inp.value);
      if (!v) return bad();
      tr.tag = v;
      toast(t('nowTag', { t: v }));
    }
    tr.day = dayKey(); saveTrees();
    closeSheet('treeSheet'); render();
    if (pendingCamera) { pendingCamera = false; $('cameraInput').click(); } // same tap → camera opens
  });
  $('treeBtn').onclick = () => {
    if (!state.orchard) return openOrchardSheet();
    const tr = treeOf(state.orchard);
    openTreeSheet(tr.mode, tr.mode === 'seq' ? tr.seq : tr.tag);
  };
  $('nextTreeBtn').onclick = () => {
    if (!state.orchard) { toast(t('needOrchard'), true); return openOrchardSheet(); }
    const tr = treeOf(state.orchard);
    if (tr.mode === 'seq') {
      tr.seq += 1; tr.day = dayKey(); saveTrees(); render();
      toast(t('nowTree', { n: tr.seq }));
    } else {
      openTreeSheet('tag', nextTagGuess(tr.tag));
    }
  };

  // Settings: tracking switch + numbering mode for the current orchard
  $('trackToggle').onchange = (e) => { state.track = e.target.checked; store.set('track', state.track); render(); };
  $('treeModeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tm]'); if (!b || !state.orchard) return;
    const tr = treeOf(state.orchard); tr.mode = b.dataset.tm; saveTrees(); render();
  });

  // New day: continue the running number or start again from tree 1
  function maybeAskNewDay() {
    if (!state.track || !state.orchard || state.onboardMode) return;
    if ([...document.querySelectorAll('.sheet-backdrop')].some((x) => !x.hidden)) return; // e.g. saving a photo
    const tr = treeOf(state.orchard);
    if (tr.mode !== 'seq' || tr.day === dayKey()) return;
    if (tr.seq <= 1) { tr.day = dayKey(); saveTrees(); return; }
    $('dayText').textContent = t('dayText', { o: state.orchard, n: tr.seq });
    $('dayContinue').textContent = t('continueN', { n: tr.seq });
    openSheet('daySheet');
  }
  $('dayContinue').onclick = () => { const tr = treeOf(state.orchard); tr.day = dayKey(); saveTrees(); closeSheet('daySheet'); render(); };
  $('dayRestart').onclick = () => { const tr = treeOf(state.orchard); tr.seq = 1; tr.day = dayKey(); saveTrees(); closeSheet('daySheet'); render(); };

  // Shutter: an orchard must be set first (gallery uploads may leave it empty)
  $('cameraInput').closest('label').addEventListener('click', (e) => {
    if (e.target.id === 'cameraInput') return;
    if (store.get('geoAsked', false)) gpsStart(); // warm up the GPS while the camera is open (permission already asked)
    if (state.track && !state.orchard) { e.preventDefault(); pendingCamera = true; toast(t('needOrchard')); openOrchardSheet(); return; }
    const tr = state.track && state.orchard ? treeOf(state.orchard) : null;
    if (tr && tr.mode === 'tag' && !tr.tag) { e.preventDefault(); pendingCamera = true; openTreeSheet('tag', ''); $('treeHint').textContent = t('needTagFirst'); }
  });

  // Review sheet: orchard / tree part
  asciiField($('rmOrchard'), null, true);
  asciiField($('rmTree'), null, true);
  function reviewMeta() {
    if (!state.track) return null;
    if (state.reviewSource === 'camera') return { ...state.reviewSnap, source: 'camera' };
    if ($('oldToggle').checked) return { orchard: '', mode: 'seq', token: 'tNA', source: 'old' };
    const o = cleanOrchard($('rmOrchard').value);
    const tv = cleanTag($('rmTree').value);
    const token = !tv ? 'tNA' : /^\d+$/.test(tv) ? 't' + pad2(parseInt(tv, 10)) : 'tag' + tv;
    return { orchard: o, mode: /^tag/.test(token) ? 'tag' : 'seq', token, source: 'gallery' };
  }
  const isTrainOnly = (m) => !!m && (!m.orchard || m.token === 'tNA');
  function renderReviewMeta() {
    const on = state.track, cam = state.reviewSource === 'camera';
    $('reviewMeta').hidden = !on;
    if (!on) return;
    $('rmCamera').hidden = !cam;
    $('rmGallery').hidden = cam;
    if (cam && state.reviewSnap) {
      const sn = state.reviewSnap;
      $('rmCameraText').textContent = `${sn.orchard} · ${sn.mode === 'tag' ? t('treeTagLabel') + ' ' + sn.token.slice(3) : t('treeN', { n: Number(sn.token.slice(1)) })}`;
    }
    $('rmFields').hidden = !cam && $('oldToggle').checked;
    const m = reviewMeta();
    $('trainOnlyNote').hidden = !isTrainOnly(m);
    if (m && isTrainOnly(m)) {
      const key = m.source === 'old' ? 'trainOnlyHint'
        : !m.orchard && m.token === 'tNA' ? 'missBoth' : !m.orchard ? 'missOrchard' : 'missTree';
      $('trainOnlyNote').querySelector('span').textContent = t(key);
    }
  }
  ['oldToggle', 'rmOrchard', 'rmTree'].forEach((id) => $(id).addEventListener(id === 'oldToggle' ? 'change' : 'input', renderReviewMeta));

  // Photo's own capture time (EXIF DateTimeOriginal) for gallery uploads; JPEG only.
  async function exifDate(file) {
    try {
      const v = new DataView(await file.slice(0, 262144).arrayBuffer());
      if (v.getUint16(0) !== 0xFFD8) return null;
      let o = 2;
      while (o + 10 < v.byteLength) {
        const marker = v.getUint16(o), len = v.getUint16(o + 2);
        if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
          const b = o + 10, le = v.getUint16(b) === 0x4949;
          const u16 = (q) => v.getUint16(b + q, le), u32 = (q) => v.getUint32(b + q, le);
          const ifd = (off) => { const n = u16(off), out = {}; for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; out[u16(e)] = { count: u32(e + 4), at: e + 8 }; } return out; };
          const str = (en) => { if (!en) return null; const off = en.count > 4 ? u32(en.at) : en.at; let r = ''; for (let i = 0; i < en.count - 1; i++) r += String.fromCharCode(v.getUint8(b + off + i)); return r; };
          const i0 = ifd(u32(4));
          let txt = null;
          if (i0[0x8769]) { const ex = ifd(u32(i0[0x8769].at)); txt = str(ex[0x9003]) || str(ex[0x9004]); }
          txt = txt || str(i0[0x0132]);
          const m = txt && txt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (!m || m[1] === '0000') return null;
          const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
          return isNaN(d) ? null : d;
        }
        if ((marker & 0xFF00) !== 0xFF00) break;
        o += 2 + len;
      }
    } catch {}
    return null;
  }
  async function captureTime(file, source) {
    if (source === 'camera') return { date: new Date(), src: 'camera' };
    const ex = await exifDate(file);
    if (ex) return { date: ex, src: 'exif' };
    if (file.lastModified && Math.abs(Date.now() - file.lastModified) > 10 * 60 * 1000) return { date: new Date(file.lastModified), src: 'file' };
    return { date: new Date(), src: 'upload' };
  }
  // Fingerprint of the original, used to skip photos that were already uploaded.
  async function sha256(blob) {
    try {
      const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  // ---------- Capture flow ----------
  function onFiles(e) {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    e.target.value = '';
    if (!files.length) return;
    pickerOpenUntil = 0;
    if (needsOnboard()) return;
    state.pending = files;
    state.reviewFolder = state.currentFolder;
    // Orchard + tree are fixed at the moment the photo comes back from the camera.
    state.reviewSource = e.target.id === 'cameraInput' ? 'camera' : 'gallery';
    state.reviewSnap = state.track && state.orchard ? (() => { const tr = treeOf(state.orchard); return { orchard: state.orchard, mode: tr.mode, token: treeToken(tr.mode, tr.seq, tr.tag) }; })() : null;
    if (state.reviewSource === 'camera' && state.track && !state.orchard) { state.reviewSource = 'gallery'; } // safety: never label a camera photo with no orchard
    $('oldToggle').checked = false; $('rmOrchard').value = ''; $('rmTree').value = '';
    saveJudge.set(null);
    state.pendingMarks = [];
    renderMyMarkBtn();
    $('sendToggle').checked = store.get('sendDefault', false);
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
    renderReviewMeta();
    openSheet('reviewSheet');
    captureGps();
  }
  $('cameraInput').addEventListener('change', onFiles);
  $('galleryInput').addEventListener('change', onFiles);
  // While the camera or gallery is open (and for a while after), an update must not reload the page.
  ['cameraInput', 'galleryInput'].forEach((id) => $(id).closest('label').addEventListener('click', () => { pickerOpenUntil = Date.now() + 10 * 60 * 1000; }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pickerOpenUntil > Date.now()) pickerOpenUntil = Date.now() + 8000; });

  function resetReview(files) {
    // files given → only reset if the review still shows that same batch (a new photo may have
    // been taken while the previous batch was being saved).
    if (files && state.pending !== files) return;
    $('reviewStrip').querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src));
    state.pending = [];
  }

  // ---------- GPS ----------
  // The first position a phone reports is often a rough Wi-Fi/cell estimate (hundreds of metres to
  // kilometres off). Keep listening and keep the best *recent* fix; start as soon as the shutter is
  // tapped so the GPS has warmed up by the time the photo comes back from the camera.
  const geo = { best: null, watch: null, stopTimer: null, error: null };
  function gpsStart() {
    if (!state.gps || !navigator.geolocation) return;
    store.set('geoAsked', true);
    clearTimeout(geo.stopTimer);
    geo.stopTimer = setTimeout(gpsStop, 3 * 60 * 1000); // save battery: stop 3 min after last use
    if (geo.watch != null) return;
    geo.error = null;
    geo.watch = navigator.geolocation.watchPosition((p) => {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: Date.now() };
      const b = geo.best;
      // A newer fix wins unless it is clearly worse; an old fix (>20 s) is replaced anyway (the worker moves between trees).
      if (!b || fix.acc <= Math.max(b.acc * 1.5, b.acc + 15) || fix.at - b.at > 20000) geo.best = fix;
      renderGps();
    }, (err) => { geo.error = err.code; renderGps(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  function gpsStop() { if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch); geo.watch = null; }
  const gpsFix = () => (geo.best && Date.now() - geo.best.at < 2 * 60 * 1000 ? geo.best : null);
  function renderGps() {
    const line = $('gpsLine');
    const show = !$('reviewSheet').hidden && state.reviewSource === 'camera' && state.gps;
    line.hidden = !show; $('gpsWarn').hidden = true;
    if (!show) return;
    const f = gpsFix();
    if (!f) { $('gpsText').textContent = t(geo.error === 1 ? 'gpsDenied' : 'gpsSearching'); line.className = 'gps-line'; return; }
    $('gpsText').textContent = `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} (±${f.acc} m)${f.acc > 30 ? ' · ' + t('gpsImproving') : ''}`;
    line.className = 'gps-line ' + (f.acc <= 30 ? 'good' : f.acc <= 200 ? 'meh' : 'bad');
    $('gpsWarn').hidden = f.acc <= 500;
  }
  function captureGps() { gpsStart(); renderGps(); }

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
  // Thumbnail (grid) + preview (detail view) from a single decode of the original.
  async function makeImages(file) {
    try {
      const c = await drawScaled(file, { maxEdge: 2048 }); // detail/zoom preview kept on the phone
      const k = 240 / Math.min(c.width, c.height);
      const tc = document.createElement('canvas');
      tc.width = Math.round(c.width * k); tc.height = Math.round(c.height * k);
      tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
      const preview = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      return { thumb: tc.toDataURL('image/jpeg', 0.7), preview };
    } catch { return { thumb: PLACEHOLDER, preview: null }; }
  }
  // Only used as a fallback when sending the original straight to Drive is not possible.
  async function compress(file) {
    const c = await drawScaled(file, { maxEdge: MAX_EDGE });
    return new Promise((r) => c.toBlob(r, 'image/jpeg', JPEG_QUALITY));
  }

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  // English-only file name. With orchard/tree:  durian_<folder>_<ORCHARD>_<t03|tagB-12|tNA>-p02_<date_time>_<name>_<id>.jpg
  // Without (setting off):                       durian_<folder>_<date_time>_<name>_<id>.jpg
  // The 6-character id makes every name unique; the backend uses that to skip duplicate retries.
  function fileName(date, folder, ext, id, meta, photoNo) {
    const folderTok = asciiClean(folder.name, 20) || 'F' + String(folder.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
    const parts = ['durian', folderTok];
    if (meta) parts.push(meta.orchard || 'NA', `${meta.token}-p${pad(photoNo)}`);
    parts.push(stamp(date), cleanNameToken(state.name) || 'NA', id.slice(0, 6));
    return parts.join('_') + '.' + (/^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg');
  }

  $('saveBtn').onclick = async () => {
    const folder = state.folders.find((f) => f.id === state.reviewFolder);
    if (!folder) { toast(t('pickFolderFirst'), true); return; }
    const files = state.pending;
    const note = $('noteInput').value.trim();
    const pos = gpsFix(); // best recent fix at the moment of saving
    let judge = saveJudge.isEmpty() ? null : saveJudge.get();
    const myMarks = files.length === 1 ? (state.pendingMarks || []) : [];
    if (myMarks.length) judge = { ...(judge || { labels: [], text: '', confident: true }), marks: myMarks };
    const send = $('sendToggle').checked;
    store.set('sendDefault', send);
    setCurrentFolder(folder.id);
    closeSheet('reviewSheet');

    const now = new Date();
    const baseMeta = reviewMeta();
    const source = state.reviewSource;
    if (source === 'camera' && baseMeta && baseMeta.orchard) { const tr = treeOf(baseMeta.orchard); tr.day = dayKey(); saveTrees(); }
    const describe = (cap, meta, tree) => [
      note,
      `Photographer: ${state.name}`,
      `Captured: ${cap.date.toISOString()}${cap.src === 'upload' ? ' (unknown, this is the upload time)' : cap.src === 'file' ? ' (file time)' : ''}`,
      meta ? `Orchard: ${meta.orchard || 'NA'}` : '',
      meta ? `Tree: ${tree}` : '',
      meta ? `Source: ${meta.source === 'old' ? 'gallery-old' : meta.source}` : '',
      meta ? `Use: ${isTrainOnly(meta) ? 'train-only' : 'train+test'}` : '',
      pos && source === 'camera' ? `GPS: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (±${pos.acc} m)` : '',
      pos && source === 'camera' ? `Map: https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : '',
      'App: Durimage',
    ].filter(Boolean).join('\n');
    let skipped = 0;
    const seenHashes = new Set(state.items.map((x) => x.sha256).filter(Boolean));

    let saved = 0;
    try {
    for (let i = 0; i < files.length; i++) {
      const id = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      const f = files[i];
      const ext = ((f.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg').toLowerCase();
      const hash = await sha256(f);
      if (hash && seenHashes.has(hash)) { skipped++; continue; } // same photo already on this phone
      if (hash) seenHashes.add(hash);
      const cap = await captureTime(f, source);
      if (source !== 'camera' && files.length > 1 && cap.src === 'upload') cap.date = new Date(now.getTime() + i * 1000);
      const meta = baseMeta ? { ...baseMeta } : null;
      let tree = '', photoNo = 0;
      if (meta) {
        photoNo = nextPhotoNo(meta.orchard, meta.token, dayKey(cap.date));
        tree = `${meta.token}-p${pad(photoNo)}`;
        meta.tree = tree; meta.trainOnly = isTrainOnly(meta);
      }
      const imgs = await makeImages(f);
      const item = {
        id, createdAt: Date.now() + i, status: 'queued',
        folderId: folder.id, folderName: folder.name,
        name: fileName(cap.date, folder, ext, id, meta, photoNo),
        mime: f.type || 'image/jpeg', size: f.size, description: describe(cap, meta, tree), note, thumb: imgs.thumb,
        capturedAt: cap.date.toISOString(), capSrc: cap.src, pos: source === 'camera' ? (pos || null) : null, by: state.name,
        meta, sha256: hash,
        judge, sub: send ? { want: true, done: false } : null,
      };
      await putBlob(id, f); // the untouched original
      if (imgs.preview) await putBlob(id + '_p', imgs.preview); // kept after upload so the detail view still has a picture
      await putItem(item);
      state.items.push(item);
      saved++;
    }
    } catch (e) {
      // #7 e.g. phone storage full: say so instead of failing silently
      console.error(e);
      resetReview(files); render();
      toast(t('saveFailed', { n: saved, total: files.length }), true);
      processQueue();
      return;
    }
    resetReview(files);
    render();
    if (skipped) toast(t('dupSkipped', { n: skipped }));
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    if (!skipped) toast(t(navigator.onLine ? 'savedQueued' : 'savedOffline', { n: files.length }));
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
    if (!blob) return { ok: false, error: 'missing' };
    if (DEMO) return api({ action: 'upload' });

    const ses = await api({
      action: 'session', key: state.password, origin: location.origin,
      folderId: item.folderId, name: item.name, mimeType: item.mime, size: blob.size,
      description: item.description, sha256: item.sha256 || '', props: driveProps(item),
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
      // Otherwise give the original a second chance before falling back (a one-off signal drop
      // must not turn a photo into a compressed copy for good).
      if (store.get('directOk', false) || !navigator.onLine) throw e;
      item.directFails = (item.directFails || 0) + 1;
      if (item.directFails < 2) throw e;
      console.warn('direct upload not possible here, sending compressed copy', e);
      const small = await compress(blob);
      const name = item.name.replace(/\.[^.]+$/, '.jpg');
      const r = await api({
        action: 'upload', key: state.password,
        folderId: item.folderId, name, mimeType: 'image/jpeg',
        description: item.description + '\n(Compressed copy: original upload not supported on this device)',
        data: await toBase64(small), sha256: item.sha256 || '', props: driveProps(item),
      });
      return { ...r, compressed: true, name };
    }
  }

  // Machine-readable fields stored on the Drive file (searchable later without parsing file names).
  const driveProps = (item) => {
    const m = item.meta;
    return Object.assign({}, item.sha256 ? { sha256: item.sha256 } : {},
      m ? { orchard: m.orchard || 'NA', tree: m.tree, source: m.source, use: m.trainOnly ? 'train-only' : 'train+test' } : {});
  };
  // Photos with a note, and photos that can only be used for training, get a row in the Sheet (newest on top).
  const needsSheetRow = (item) => !!item.note || !!(item.meta && item.meta.trainOnly);
  const logRow = (item) => ({
    action: 'log', key: state.password,
    folderId: item.folderId, folderName: item.folderName,
    fileId: item.driveId, name: item.uploadedName || item.name,
    note: item.note, photographer: state.name,
    capturedAt: item.capturedAt || new Date(item.createdAt).toISOString(),
    lat: item.pos ? item.pos.lat : null, lng: item.pos ? item.pos.lng : null, acc: item.pos ? item.pos.acc : null,
    quality: item.compressed ? 'compressed' : 'original',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    orchard: item.meta ? (item.meta.orchard || 'NA') : '', tree: item.meta ? item.meta.tree : '',
    source: item.meta ? item.meta.source : '', trainOnly: !!(item.meta && item.meta.trainOnly), meta: !!item.meta,
  });

  const CONCURRENCY = 3; // photos sent at the same time
  // Errors that retrying will not fix. Everything else (Google busy, timeouts) is retried automatically.
  const PERMANENT_ERRORS = new Set(['bad_folder', 'bad_type', 'too_large', 'missing', 'bad_name']);
  let retryTimer = null;

  async function processOne(item, run) {
    item.status = 'uploading'; render();
    try {
      // Photo first (skipped if an earlier attempt already got it into Drive), then the Sheet row.
      let res = { ok: true, id: item.driveId };
      if (!item.driveId) {
        res = await uploadOne(item);
        if (res.ok) {
          item.driveId = res.id; item.compressed = !!res.compressed; if (res.name) item.uploadedName = res.name;
          if (res.dupHash) { item.duplicate = true; item.logged = true; } // same photo already in Drive: nothing new to save or log
          await putItem(item); await delBlob(item.id);
        }
      }
      if (res.ok && needsSheetRow(item) && !item.logged) {
        res = await api(logRow(item));
        if (res.ok) item.logged = true;
      }
      if (res.ok) {
        item.status = 'done'; item.error = null;
        run.doneByFolder[item.folderName] = (run.doneByFolder[item.folderName] || 0) + 1;
      } else if (res.error === 'bad_key') {
        item.status = 'queued'; run.rejected = true;
      } else if (PERMANENT_ERRORS.has(res.error) || (item.tries = (item.tries || 0) + 1) >= 5) {
        item.status = 'error'; item.error = res.error || 'unknown'; // e.g. bad_folder: removed by admin
      } else {
        item.status = 'queued'; item.error = res.error || 'unknown'; run.retrySoon = true; // e.g. Google busy
      }
    } catch (e) {
      console.error(e);
      item.error = String(e.message || e);
      // Offline / dropped connection: keep it queued. If it keeps failing while online, it is not
      // a network problem (e.g. the phone cannot read the file), so stop after a few tries.
      if (navigator.onLine && (item.tries = (item.tries || 0) + 1) >= 8) item.status = 'error';
      else item.status = 'queued';
      run.stop = true;
    }
    await putItem(item);
  }

  async function processQueue() {
    if (state.uploading || !navigator.onLine || !state.password) return;
    if (state.role === 'reviewer') return; // review password cannot upload: photos wait on the phone until a team/admin login
    const todo = state.items.filter((i) => i.status === 'queued' || i.status === 'uploading')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!todo.length) { render(); flushSubmissions(); return; }
    state.uploading = true;
    state.batch = { total: todo.length, done: 0 };
    const run = { doneByFolder: {}, rejected: false, stop: false };
    let next = 0;
    const worker = async () => {
      while (!run.stop && !run.rejected && navigator.onLine) {
        const item = todo[next++];
        if (!item) return;
        if (!state.items.includes(item)) { state.batch.done++; continue; } // deleted from the phone meanwhile
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
    maybeReload();
    flushSubmissions();
    if (run.rejected) { passwordRejected(); return; }
    const waiting = state.items.some((i) => i.status === 'queued');
    // #3 weak signal / Google busy: try again by itself after a pause, even if the phone still says "online".
    clearTimeout(retryTimer);
    if (waiting && (run.stop || run.retrySoon)) retryTimer = setTimeout(processQueue, run.stop ? 30000 : 15000);
    // Photos saved while this run was going → start another run.
    else if (waiting && navigator.onLine) processQueue();
  }

  async function trimHistory() {
    const done = state.items.filter((i) => i.status === 'done').sort((a, b) => b.createdAt - a.createdAt);
    const drop = done.slice(1000); // keep the last 1000 uploaded photos (preview + details) for browsing
    for (const old of drop) { await delItem(old.id); await delBlob(old.id + '_p'); }
    const ids = new Set(drop.map((i) => i.id));
    state.items = state.items.filter((i) => !ids.has(i.id));
  }

  // ---------- Pan / zoom engine (viewer, review image, drawing editor) ----------
  // stage = visible box; layer = photo-sized element (image + marks) that is moved and scaled.
  function makeZoomer(stage, layer, opts = {}) {
    const z = { s: 1, x: 0, y: 0, ox: 0, oy: 0, cw: 0, ch: 0, nat: [1, 1], pts: new Map(), pinch: null, pan: null, lastTap: 0 };
    z.fit = (nw, nh) => {
      if (nw && nh) z.nat = [nw, nh];
      const W = stage.clientWidth, H = stage.clientHeight, r = z.nat[0] / z.nat[1];
      z.cw = Math.min(W, H * r); z.ch = z.cw / r; z.ox = (W - z.cw) / 2; z.oy = (H - z.ch) / 2;
      Object.assign(layer.style, { left: z.ox + 'px', top: z.oy + 'px', width: z.cw + 'px', height: z.ch + 'px' });
      z.apply(); if (opts.onFit) opts.onFit(z);
    };
    z.apply = () => {
      const W = stage.clientWidth, H = stage.clientHeight;
      z.s = Math.min(8, Math.max(1, z.s));
      // photo bigger than the screen → no empty edge may show; smaller → keep it centred
      const lim = (pos, size, off, view) => size * z.s <= view ? (view - size * z.s) / 2 - off
        : Math.min(-off, Math.max(view - size * z.s - off, pos));
      z.x = lim(z.x, z.cw, z.ox, W); z.y = lim(z.y, z.ch, z.oy, H);
      layer.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    };
    z.reset = () => { z.s = 1; z.x = 0; z.y = 0; z.apply(); };
    z.zoomAt = (px, py, ns) => { const u = (px - z.ox - z.x) / z.s, v = (py - z.oy - z.y) / z.s; z.s = Math.min(8, Math.max(1, ns)); z.x = px - z.ox - u * z.s; z.y = py - z.oy - v * z.s; z.apply(); };
    z.rel = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // screen point → photo coordinates 0..1
    z.toPhoto = (e) => { const p = z.rel(e); return [(p.x - z.ox - z.x) / z.s / z.cw, (p.y - z.oy - z.y) / z.s / z.ch]; };
    const mine = (e) => !opts.claim || !opts.claim(e, z);
    stage.addEventListener('pointerdown', (e) => {
      if (!mine(e)) return;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      z.pts.set(e.pointerId, z.rel(e));
      if (z.pts.size === 2) {
        const [a, b] = [...z.pts.values()];
        z.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: z.s, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: z.x, y: z.y };
        z.pan = null;
      } else if (z.pts.size === 1) { const p = z.rel(e); z.pan = { sx: p.x, sy: p.y, x: z.x, y: z.y, moved: false }; }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!z.pts.has(e.pointerId)) return;
      z.pts.set(e.pointerId, z.rel(e));
      if (z.pinch && z.pts.size >= 2) {
        const [a, b] = [...z.pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ns = Math.min(8, Math.max(1, z.pinch.s * d / z.pinch.d));
        const u = (z.pinch.m.x - z.ox - z.pinch.x) / z.pinch.s, v = (z.pinch.m.y - z.oy - z.pinch.y) / z.pinch.s;
        z.s = ns; z.x = m.x - z.ox - u * ns; z.y = m.y - z.oy - v * ns; z.apply();
      } else if (z.pan) {
        const p = z.rel(e);
        if (Math.abs(p.x - z.pan.sx) + Math.abs(p.y - z.pan.sy) > 6) z.pan.moved = true;
        z.x = z.pan.x + p.x - z.pan.sx; z.y = z.pan.y + p.y - z.pan.sy; z.apply();
      }
    });
    const up = (e) => {
      if (!z.pts.has(e.pointerId)) return;
      const tap = z.pan && !z.pan.moved && z.pts.size === 1 && !z.pinch;
      z.pts.delete(e.pointerId);
      if (z.pts.size < 2) z.pinch = null;
      if (z.pts.size === 1) { const p = [...z.pts.values()][0]; z.pan = { sx: p.x, sy: p.y, x: z.x, y: z.y, moved: true }; }
      if (z.pts.size === 0) {
        z.pan = null;
        if (tap && !opts.noDoubleTap) {
          const now = Date.now(), p = z.rel(e);
          if (now - z.lastTap < 320) { z.zoomAt(p.x, p.y, z.s > 1.05 ? 1 : 3); z.lastTap = 0; } else z.lastTap = now;
        }
      }
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const p = z.rel(e); z.zoomAt(p.x, p.y, z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    window.addEventListener('resize', () => { if (stage.offsetParent !== null) z.fit(); });
    return z;
  }

  // ---------- Marks (circles, boxes, arrows, pen) drawn by reviewers ----------
  // A mark: { t: 'pen'|'ellipse'|'rect'|'arrow', c: category, col: colour, w: 1|2|3, p: [[u,v],…] } with u,v in 0..1
  const MARK_W = { 1: 0.004, 2: 0.008, 3: 0.014 }; // stroke width relative to photo width
  function renderMarks(svg, marks, cw, ch, opts = {}) {
    svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    const sw = (m) => Math.max(1.5, (MARK_W[m.w] || MARK_W[2]) * cw);
    const P = (q) => `${(q[0] * cw).toFixed(1)},${(q[1] * ch).toFixed(1)}`;
    const out = [];
    let num = 0;
    (marks || []).forEach((m) => {
      if (!m.p || !m.p.length) return;
      const col = esc(m.col || '#e53935'), w = sw(m);
      const i = m.d ? -1 : num++; // photographer's marks (m.d) are dashed and not numbered
      const a = m.p[0], b = m.p[m.p.length - 1];
      const x1 = Math.min(a[0], b[0]) * cw, y1 = Math.min(a[1], b[1]) * ch, x2 = Math.max(a[0], b[0]) * cw, y2 = Math.max(a[1], b[1]) * ch;
      const base = `fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${m.d ? ` stroke-dasharray="${(w * 2.6).toFixed(1)} ${(w * 1.9).toFixed(1)}"` : ''}`;
      if (m.t === 'pen') out.push(`<polyline points="${m.p.map(P).join(' ')}" ${base}/>`);
      else if (m.t === 'ellipse') out.push(`<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${(x2 - x1) / 2}" ry="${(y2 - y1) / 2}" ${base}/>`);
      else if (m.t === 'rect') out.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" ${base}/>`);
      else if (m.t === 'arrow') {
        const ax = a[0] * cw, ay = a[1] * ch, bx = b[0] * cw, by = b[1] * ch, ang = Math.atan2(by - ay, bx - ax), hl = Math.max(10, w * 4);
        out.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" ${base}/><polyline points="${bx - hl * Math.cos(ang - 0.5)},${by - hl * Math.sin(ang - 0.5)} ${bx},${by} ${bx - hl * Math.cos(ang + 0.5)},${by - hl * Math.sin(ang + 0.5)}" ${base}/>`);
      }
      if (!opts.noLabels && i >= 0) { // number badge at the start of the mark (matches the list under the photo)
        const r = Math.max(9, cw * 0.022), lx = (m.t === 'pen' || m.t === 'arrow' ? a[0] * cw : x1), ly = (m.t === 'pen' || m.t === 'arrow' ? a[1] * ch : y1);
        out.push(`<circle cx="${lx}" cy="${ly}" r="${r}" fill="${col}" stroke="#fff" stroke-width="${r * 0.18}"/><text x="${lx}" y="${ly}" fill="#fff" font-size="${r * 1.15}" font-weight="800" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${i + 1}</text>`);
      }
    });
    svg.innerHTML = out.join('');
  }
  // Photo + marks flattened into one JPEG (saved to Drive next to the review).
  async function flattenMarks(src, marks, maxEdge = 2048) {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.round(img.naturalWidth * k), ch = Math.round(img.naturalHeight * k);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', cw); svg.setAttribute('height', ch);
    renderMarks(svg, marks, cw, ch);
    const overlay = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML); });
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, cw, ch); g.drawImage(overlay, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  // ---------- Full-screen viewer (pinch / double-tap zoom, drag to pan) ----------
  const vz = makeZoomer($('viewerStage'), $('viewerLayer'), { onFit: (z) => renderMarks($('viewerSvg'), vwMarks, z.cw, z.ch) });
  let vwUrl = null, vwMarks = [];
  function openViewer(src, ownedUrl, marks) {
    if (vwUrl) URL.revokeObjectURL(vwUrl);
    vwUrl = ownedUrl || null; vwMarks = marks || [];
    const im = $('viewerImg');
    $('viewer').hidden = false;
    vz.s = 1; vz.x = 0; vz.y = 0;
    im.onload = () => vz.fit(im.naturalWidth, im.naturalHeight);
    im.src = src;
    if (im.complete && im.naturalWidth) vz.fit(im.naturalWidth, im.naturalHeight);
    $('viewerHint').classList.remove('gone');
    setTimeout(() => $('viewerHint').classList.add('gone'), 2500);
  }
  function closeViewer() { $('viewer').hidden = true; $('viewerImg').removeAttribute('src'); $('viewerSvg').innerHTML = ''; if (vwUrl) { URL.revokeObjectURL(vwUrl); vwUrl = null; } }
  $('viewerClose').onclick = closeViewer;

  // ---------- Photo detail ----------
  let detailUrl = null, detailId = null;
  function requeue(item) {
    // If the folder disappeared, send it to the currently selected folder instead.
    if (item.error === 'bad_folder' && state.currentFolder) {
      const f = state.folders.find((x) => x.id === state.currentFolder);
      if (f) { item.folderId = f.id; item.folderName = f.name; }
    }
    item.status = 'queued'; item.error = null; item.tries = 0;
    return putItem(item);
  }
  async function openDetail(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    detailId = id;
    const oldUrl = detailUrl;
    const blob = (await getBlob(id + '_p')) || (await getBlob(id));
    detailUrl = blob ? URL.createObjectURL(blob) : null;
    // Decode the new photo first, then swap: no blank / broken frame while swiping.
    const pre = new Image(); pre.src = detailUrl || item.thumb;
    await pre.decode().catch(() => {});
    if (detailId !== id) { if (detailUrl) URL.revokeObjectURL(detailUrl); return; } // a newer swipe won
    $('detailImg').src = detailUrl || item.thumb;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const badge = $('detailBadge');
    badge.className = 'tile-badge b-' + item.status;
    badge.textContent = t(item.status);
    $('detailErr').hidden = item.status !== 'error';
    $('detailErr').textContent = item.error === 'bad_folder' ? t('errFolder') : item.error === 'missing' ? t('errMissing') : t('errGeneric');
    const d = new Date(item.capturedAt || item.createdAt);
    const pos = item.pos;
    const rows = [
      ['fFolder', esc(item.folderName)],
      ['fTime', esc(d.toLocaleString(LOCALE(), { dateStyle: 'medium', timeStyle: 'short' })) + (item.capSrc === 'upload' ? `<br><span class="muted">${esc(t('timeUnknown'))}</span>` : '')],
      ['fBy', esc(item.by || (item.description.match(/^Photographer: (.*)$/m) || [])[1] || '')],
      ['flNote', item.note ? esc(item.note).replace(/\n/g, '<br>') : `<span class="muted">${esc(t('noNote'))}</span>`],
      ['fGps', pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (±${pos.acc} m)<br><a href="https://maps.google.com/?q=${pos.lat},${pos.lng}" target="_blank" rel="noopener">${esc(t('openMap'))}</a>` : `<span class="muted">${esc(t('noGps'))}</span>`],
      ['fFile', `<span class="mono">${esc(item.uploadedName || item.name)}</span>`],
    ];
    if (item.meta) {
      const m = item.meta;
      const reason = !m.orchard && m.token === 'tNA' ? 'reasonBoth' : !m.orchard ? 'reasonOrchard' : 'reasonTree';
      rows.splice(1, 0,
        ['fOrchard', esc(m.orchard || 'NA')],
        ['fTree', `<span class="mono">${esc(m.tree)}</span>`]);
      rows.push(['fSource', esc(t(m.source === 'old' ? 'srcOld' : m.source === 'gallery' ? 'srcGallery' : 'srcCamera'))]);
      rows.push(['fUse', m.trainOnly ? `<b>${esc(t('useTrain', { r: t(reason) }))}</b>` : esc(t('useBoth'))]);
    }
    if (item.status === 'done') rows.push(['fQuality', esc(t(item.duplicate ? 'qDuplicate' : item.compressed ? 'qCompressed' : 'qOriginal'))]);
    $('detailList').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>`).join('');
    const canAct = item.status !== 'done' && item.status !== 'uploading';
    renderDetailJudge(item);
    renderDetailReviews(item);
    if (item.sub && item.sub.done) fetchMyReviews(false).then(() => { if (detailId === item.id && !$('detailSheet').hidden) renderDetailReviews(item); });
    $('detailFoot').hidden = !canAct;
    $('detailRetry').hidden = !(item.status === 'error' || (item.status === 'queued' && navigator.onLine));
    // Position in the current (filtered) list, for swiping to the previous / next photo.
    const ids = state.visibleIds || [], at = ids.indexOf(id);
    $('detailPos').hidden = at < 0 || ids.length < 2;
    $('detailPos').textContent = `${at + 1} / ${ids.length}`;
    $('detailPrev').hidden = at <= 0;
    $('detailNext').hidden = at < 0 || at >= ids.length - 1;
    openSheet('detailSheet');
  }
  // Swipe left / right in photo details → next / previous photo (same order as the home grid, filters applied).
  async function detailStep(dir) {
    const ids = state.visibleIds || [], at = ids.indexOf(detailId), to = ids[at + dir];
    if (at < 0 || !to) return;
    const sheet = $('detailSheet').querySelector('.sheet');
    await openDetail(to); // quick repeated swipes chain; the newest one wins
    if (detailId !== to) return;
    sheet.scrollTop = 0;
    // Only the content slides; the sheet itself keeps still (its own open animation must not replay).
    sheet.classList.remove('slide-l', 'slide-r'); void sheet.offsetWidth;
    sheet.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    clearTimeout(detailStep.t); detailStep.t = setTimeout(() => sheet.classList.remove('slide-l', 'slide-r'), 300);
  }
  $('detailPrev').addEventListener('click', (e) => { e.stopPropagation(); detailStep(-1); });
  $('detailNext').addEventListener('click', (e) => { e.stopPropagation(); detailStep(1); });
  (() => {
    const sheet = $('detailSheet').querySelector('.sheet');
    let sx = 0, sy = 0, st = 0, on = false;
    sheet.addEventListener('touchstart', (e) => {
      on = e.touches.length === 1 && !e.target.closest('input, textarea, .switch');
      if (on) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => { if (e.touches.length > 1) on = false; }, { passive: true });
    sheet.addEventListener('touchend', (e) => {
      if (!on) return; on = false;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - st < 800) detailStep(dx < 0 ? 1 : -1);
    });
    document.addEventListener('keydown', (e) => {
      if ($('detailSheet').hidden || !$('viewer').hidden || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight') detailStep(1); else if (e.key === 'ArrowLeft') detailStep(-1);
    });
  })();
  $('detailImg').closest('.detail-img').addEventListener('click', async () => {
    const orig = detailId ? await getBlob(detailId) : null; // still on the phone = full resolution
    if (orig) { const u = URL.createObjectURL(orig); openViewer(u, u); }
    else openViewer($('detailImg').src);
  });
  // review sheet: tap a just-taken photo to check it full size before saving
  $('reviewStrip').addEventListener('click', (e) => { const im = e.target.closest('img'); if (im) openViewer(im.src); });
  $('recentGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (state.selecting) { const id = tile.dataset.id; state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); render(); return; }
    openDetail(tile.dataset.id);
  });
  $('detailRetry').onclick = async () => {
    const item = state.items.find((i) => i.id === detailId);
    if (!item) return;
    if (item.error === 'bad_folder' && !state.folders.some((f) => f.id === state.currentFolder)) {
      closeSheet('detailSheet'); openSheet('folderSheet'); refreshFolders(false); toast(t('pickFolderFirst'), true);
      return;
    }
    item.tries = 0; item.directFails = 0;
    await requeue(item);
    closeSheet('detailSheet'); render(); processQueue();
  };
  $('detailDelete').onclick = async () => {
    const item = state.items.find((i) => i.id === detailId);
    if (!item || !confirm(t(item.driveId ? 'confirmRemoveRecord' : 'confirmDelete'))) return;
    await delItem(item.id); await delBlob(item.id); await delBlob(item.id + '_p');
    state.items = state.items.filter((i) => i.id !== item.id);
    closeSheet('detailSheet'); render(); toast(t('deleted'));
  };
  $('uploadAllBtn').onclick = async () => {
    for (const i of state.items) if (i.status === 'error') await requeue(i);
    render(); processQueue();
  };

  // =====================================================================
  // ---------- Categories, judgements, expert review ----------
  // =====================================================================
  const DEFAULT_CATS = [
    ['烂叶病', 'Leaf blight', 'Hawar daun', '#e53935'], ['介壳虫', 'Scale insect', 'Serangga perisai', '#fb8c00'],
    ['青蚊', 'Leafhopper', 'Bena daun', '#c0a000'], ['木虱', 'Psyllid', 'Psilid', '#1e88e5'],
    ['红蜘蛛', 'Red spider mite', 'Hama labah-labah merah', '#d81b60'], ['粉介壳', 'Mealybug', 'Koya', '#8e24aa'],
    ['健康', 'Healthy', 'Sihat', '#2e7d32'], ['看不出来', 'Cannot tell', 'Tidak pasti', '#757575'],
  ].map(([zh, en, ms, color]) => ({ zh, en, ms, color }));
  if (!state.cats || !state.cats.length) state.cats = DEFAULT_CATS;
  const tzName = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const catOf = (zh) => state.cats.find((c) => c.zh === zh);
  const catName = (zh) => { const c = catOf(zh); if (!c) return zh; return state.lang === 'en' ? (c.en || c.zh) : state.lang === 'ms' ? (c.ms || c.en || c.zh) : c.zh; };
  const catColor = (zh) => (catOf(zh) || {}).color || '#888888';
  async function loadCats() {
    if (!state.password || !navigator.onLine) return;
    try {
      const r = await api({ action: 'categories', key: state.password, tz: tzName() });
      if (r.ok && r.categories && r.categories.length) { state.cats = r.categories; store.set('cats', r.categories); render(); }
    } catch {}
  }
  // latest review of each reviewer (older versions are kept as history)
  function latestPer(list) {
    const m = new Map();
    (list || []).forEach((r) => { const k = String(r.reviewer || '').trim().toLowerCase(); if (!m.has(k) || (r.version || 1) >= (m.get(k).version || 1)) m.set(k, r); });
    return [...m.values()];
  }
  const lblsHtml = (labels, text, confident) => `<div class="lbls">${(labels || []).map((z) => `<span class="lbl"><i class="cat-dot" style="background:${esc(catColor(z))}"></i>${esc(catName(z))}</span>`).join('')}${text ? `<span class="lbl free">✎ ${esc(text)}</span>` : ''}${confident === false ? `<span class="lbl unsure">${esc(t('confUnsure'))}</span>` : ''}${!(labels || []).length && !text ? `<span class="muted">${esc(t('noJudge'))}</span>` : ''}</div>`;

  // Multi-select categories + free text (+ how sure). Used when saving, editing and reviewing.
  function judgeWidget(box, opts = {}) {
    box.innerHTML = `<div class="set-sub">${esc(t(opts.title || 'myJudgement'))}</div><div class="cat-chips"></div>
      <input class="text-input plain" maxlength="200" autocomplete="off" placeholder="${esc(t('judgeTextPh'))}">${opts.conf === false ? '' : '<div class="segmented seg2"></div>'}`;
    const chips = box.querySelector('.cat-chips'), txt = box.querySelector('input'), seg = box.querySelector('.segmented');
    let sel = new Set(), confident = true;
    const w = {
      onchange: null,
      draw() {
        const extra = [...sel].filter((z) => !catOf(z)).map((zh) => ({ zh, color: '#888888' }));
        chips.innerHTML = [...state.cats, ...extra].map((c) => `<button type="button" data-z="${esc(c.zh)}" class="${sel.has(c.zh) ? 'on' : ''}"><i class="cat-dot" style="background:${esc(c.color)}"></i>${esc(catName(c.zh))}</button>`).join('');
        if (seg) seg.innerHTML = [['1', 'confSure'], ['0', 'confUnsure']].map(([v, k]) => `<button type="button" data-c="${v}" class="${(confident ? '1' : '0') === v ? 'on' : ''}">${esc(t(k))}</button>`).join('');
      },
      get: () => ({ labels: [...sel], text: txt.value.trim(), confident }),
      set(j) { sel = new Set((j && j.labels) || []); txt.value = (j && j.text) || ''; confident = !j || j.confident !== false; w.draw(); },
      isEmpty: () => !sel.size && !txt.value.trim(),
    };
    chips.onclick = (e) => { const b = e.target.closest('[data-z]'); if (!b) return; const z = b.dataset.z; sel.has(z) ? sel.delete(z) : sel.add(z); w.draw(); if (w.onchange) w.onchange(); };
    if (seg) seg.onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; confident = b.dataset.c === '1'; w.draw(); };
    txt.oninput = () => { if (w.onchange) w.onchange(); };
    w.draw();
    return w;
  }
  const saveJudge = judgeWidget($('saveJudge'));
  function renderMyMarkBtn() {
    const one = (state.pending || []).length === 1, n = (state.pendingMarks || []).length;
    $('myMarkBtn').disabled = !one;
    $('myMarkText').textContent = n ? t('myMarksN', { n }) : t('markMine');
    $('myMarkHint').hidden = one;
  }
  $('myMarkBtn').onclick = () => {
    const im = $('reviewStrip').querySelector('img');
    if (!im || (state.pending || []).length !== 1) return;
    openEditor(im.src, state.pendingMarks || [], (m) => { state.pendingMarks = m; renderMyMarkBtn(); }, saveJudge.get().labels);
  };
  const editJudge = judgeWidget($('editJudge'));
  const rvJudge = judgeWidget($('rvJudge'), { title: 'reviewJudge', conf: false });

  // ---------- Sending photos for review ----------
  const subPayload = (i) => ({
    id: i.id, fileId: i.driveId, name: i.uploadedName || i.name, folder: i.folderName,
    orchard: i.meta ? (i.meta.orchard || 'NA') : '', tree: i.meta ? i.meta.tree : '', capturedAt: i.capturedAt, by: i.by || state.name,
    labels: (i.judge && i.judge.labels) || [], labelText: (i.judge && i.judge.text) || '', confident: !i.judge || i.judge.confident !== false,
    note: i.note || '', thumb: i.thumb, marks: roundMarks((i.judge && i.judge.marks) || []),
  });
  const roundMarks = (marks) => (marks || []).filter((m) => m && m.p && m.p.length).map((m) => ({ t: m.t, c: m.c, col: m.col, w: m.w, p: m.p.map((q) => [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000]) }));
  let flushing = false;
  // Photos marked "send for review" go out as soon as they are in Drive (offline → later).
  async function flushSubmissions() {
    if (flushing || !navigator.onLine || !state.password || state.role === 'reviewer') return;
    const ready = state.items.filter((i) => i.sub && i.sub.want && !i.sub.done && i.driveId && i.status === 'done');
    if (!ready.length) return;
    flushing = true;
    try {
      for (let k = 0; k < ready.length; k += 20) {
        const chunk = ready.slice(k, k + 20);
        const res = await api({ action: 'submit', key: state.password, tz: tzName(), items: chunk.map(subPayload) });
        if (!res.ok) { if (res.error === 'bad_key') passwordRejected(); break; }
        for (const i of chunk) { i.sub.done = true; i.sub.at = new Date().toISOString(); await putItem(i); }
      }
    } catch (e) { console.error(e); } finally { flushing = false; render(); }
  }
  function markForReview(items) {
    return Promise.all(items.map((i) => { i.sub = { want: true, done: false }; return putItem(i); }));
  }
  let lastRevFetch = 0;
  // Reviews of my own photos (photographer / admin).
  async function fetchMyReviews(force) {
    if (!navigator.onLine || !state.password || state.role === 'reviewer') return;
    if (!force && Date.now() - lastRevFetch < 60000) return;
    const subs = state.items.filter((i) => i.sub && i.sub.done);
    if (!subs.length) return;
    lastRevFetch = Date.now();
    try {
      const r = await api({ action: 'myReviews', key: state.password, tz: tzName(), ids: subs.map((i) => i.id) });
      if (!r.ok) return;
      let changed = false;
      for (const i of subs) {
        const rv = (r.reviews || {})[i.id] || [];
        if (JSON.stringify(rv) !== JSON.stringify(i.reviews || [])) { i.reviews = rv; changed = true; await putItem(i); }
      }
      if (changed) render();
    } catch {}
  }

  // ---------- Photo details: my judgement + reviews ----------
  function renderDetailJudge(item) {
    const box = $('detailJudge');
    if (state.role === 'reviewer') { box.innerHTML = ''; return; }
    const j = item.judge, sub = item.sub;
    const st = !sub ? '' : !sub.done ? `<span class="state-tag todo">${esc(t('subQueued'))}</span>` : `<span class="state-tag done">${esc(t('submittedAt', { d: fmtDateTime(sub.at || item.createdAt) }))}</span>`;
    box.innerHTML = `<div class="judge-view"><div class="jv-head"><b>${esc(t('myJudgement'))}</b>${st}</div>
      ${lblsHtml(j && j.labels, j && j.text, j ? j.confident : undefined)}
      ${j && (j.marks || []).length ? `<button class="btn btn-small btn-ghost dj-view" id="djView">${esc(t('viewMyMarks', { n: j.marks.length }))}</button>` : ''}
      <div class="jv-actions"><button class="btn btn-small btn-outline" id="djEdit">${esc(t('editJudge'))}</button><button class="btn btn-small btn-outline" id="djMark"><svg><use href="#i-pen"/></svg>${esc(t('markMineShort'))}</button>
      ${!sub || sub.done ? `<button class="btn btn-small btn-primary" id="djSend">${esc(t(sub && sub.done ? 'resend' : 'sendToReview'))}</button>` : ''}</div></div>`;
    $('djEdit').onclick = () => { editJudge.set(item.judge); openSheet('judgeSheet'); };
    const photo = async () => { const b = (await getBlob(item.id + '_p')) || (await getBlob(item.id)); return b ? URL.createObjectURL(b) : item.thumb; };
    if ($('djView')) $('djView').onclick = async () => { const u = await photo(); openViewer(u, u.startsWith('blob:') ? u : null, asRef(item.judge.marks)); };
    $('djMark').onclick = async () => {
      const u = await photo();
      openEditor(u, (item.judge && item.judge.marks) || [], async (m) => {
        item.judge = { ...(item.judge || { labels: [], text: '', confident: true }), marks: m };
        if (item.sub && item.sub.done) item.sub = { want: true, done: false }; // already sent → send the update
        await putItem(item); renderDetailJudge(item); render(); flushSubmissions();
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      }, (item.judge && item.judge.labels) || []);
    };
    const sendBtn = $('djSend');
    if (sendBtn) sendBtn.onclick = async () => { await markForReview([item]); toast(t('sentN', { n: 1 })); renderDetailJudge(item); render(); flushSubmissions(); };
  }
  async function saveJudgeEdit(send) {
    const item = state.items.find((i) => i.id === detailId); if (!item) return;
    const keepMarks = (item.judge && item.judge.marks) || [];
    item.judge = editJudge.isEmpty() && !keepMarks.length ? null : { ...editJudge.get(), marks: keepMarks };
    if (send || (item.sub && item.sub.done)) item.sub = { want: true, done: false }; // already sent → send the update too
    await putItem(item); closeSheet('judgeSheet');
    renderDetailJudge(item); render(); flushSubmissions();
    toast(t(send ? 'sentN' : 'saved', { n: 1 }));
  }
  $('judgeSave').onclick = () => saveJudgeEdit(false);
  $('judgeSend').onclick = () => saveJudgeEdit(true);

  function reviewCards(list, opts = {}) {
    return latestPer(list).sort((a, b) => String(b.at).localeCompare(String(a.at))).map((r) => {
      const older = (list || []).filter((x) => String(x.reviewer).trim().toLowerCase() === String(r.reviewer).trim().toLowerCase()).length - 1;
      return `<div class="rev-card"><div class="rc-head"><span class="rc-name">${esc(r.reviewer)}</span><span class="verdict ${r.verdict === 'agree' ? 'agree' : 'correct'}">${esc(t(r.verdict === 'agree' ? 'vAgree' : 'vCorrect'))}</span></div>
        <div class="rc-time">${esc(fmtDateTime(r.at))}${older > 0 ? ' · ' + esc(t('editedN', { n: older })) : ''}</div>
        <div style="margin-top:8px">${lblsHtml(r.labels, r.labelText)}</div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
        ${(r.marks || []).length ? `<button class="btn btn-small btn-outline rc-marks" data-marks="${esc(r.reviewer)}" data-src="${esc(opts.srcKey || '')}">${esc(t('viewMarks', { n: r.marks.length }))}</button>` : ''}</div>`;
    }).join('');
  }
  function renderDetailReviews(item) {
    const box = $('detailReviews');
    const list = item.reviews || [];
    if (!item.sub || !item.sub.done) { box.innerHTML = ''; return; }
    const n = latestPer(list).length;
    box.innerHTML = `<div class="set-sub">${esc(t('expertReviews', { n }))}</div>${n ? reviewCards(list) : `<div class="hint">${esc(t('noReviewsYet'))}</div>`}`;
    box.querySelectorAll('[data-marks]').forEach((b) => b.onclick = async () => {
      const r = latestPer(list).find((x) => x.reviewer === b.dataset.marks);
      const blob = (await getBlob(item.id + '_p')) || (await getBlob(item.id));
      const u = blob ? URL.createObjectURL(blob) : item.thumb;
      openViewer(u, blob ? u : null, [...asRef(item.judge && item.judge.marks), ...(r ? r.marks : [])]);
    });
  }

  // ---------- Home: filter ----------
  const treeKey = (i) => (i.meta && i.meta.tree ? i.meta.tree.replace(/-p\d+$/, '') : '');
  const treeLabelOf = (k) => k === 'tNA' ? t('treeUnknown') : k.startsWith('tag') ? k.slice(3) : k.startsWith('t') ? t('treeN', { n: Number(k.slice(1)) }) : k;
  const itemCats = (i) => { const s = new Set((i.judge && i.judge.labels) || []); latestPer(i.reviews).forEach((r) => (r.labels || []).forEach((z) => s.add(z))); return s; };
  const FLAGS = ['flNote', 'flTrainOnly', 'flUnsure', 'flUnsent', 'flPending', 'flReviewed'];
  const flagTest = {
    flNote: (i) => !!i.note, flTrainOnly: (i) => !!(i.meta && i.meta.trainOnly), flUnsure: (i) => !!(i.judge && i.judge.confident === false),
    flUnsent: (i) => !i.sub, flPending: (i) => !!i.sub && !latestPer(i.reviews).length, flReviewed: (i) => latestPer(i.reviews).length > 0,
  };
  const DATES = ['all', 'today', 'yesterday', 'd7', 'd30'];
  function dateOk(i, d) {
    if (d === 'all') return true;
    const t0 = new Date(i.capturedAt || i.createdAt), now = new Date(), day = 86400000;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (d === 'today') return t0 >= start;
    if (d === 'yesterday') return t0 >= start - day && t0 < start;
    return t0 >= start - (d === 'd7' ? 6 : 29) * day;
  }
  function filterActive(f = state.filter) { return !!(f.q || f.orchard || f.tree || f.cats.length || f.date !== 'all' || f.flags.length || f.folder); }
  function passesFilter(i, f = state.filter) {
    if (f.orchard && ((i.meta && (i.meta.orchard || 'NA')) || '') !== f.orchard) return false;
    if (f.tree && treeKey(i) !== f.tree) return false;
    if (f.folder && i.folderName !== f.folder) return false;
    if (!dateOk(i, f.date)) return false;
    if (f.cats.length) { const c = itemCats(i); if (!f.cats.some((z) => c.has(z))) return false; }
    if (f.flags.length && !f.flags.every((k) => flagTest[k](i))) return false;
    if (f.q) {
      const hay = [i.note, i.judge && i.judge.text, i.meta && i.meta.orchard, i.meta && i.meta.tree, i.uploadedName || i.name, i.folderName,
        ...(i.judge ? i.judge.labels.map(catName) : []), ...latestPer(i.reviews).map((r) => [r.labelText, r.comment, ...(r.labels || []).map(catName)].join(' '))].join(' ').toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  let draft = null; // filter being edited in the sheet
  function chipRow(el, options, isOn, onTap) {
    el.innerHTML = options.map(([v, label, color]) => `<button type="button" data-v="${esc(v)}" class="${isOn(v) ? 'on' : ''}${color ? ' cat-chip' : ''}">${color ? `<i class="cat-dot" style="background:${esc(color)}"></i>` : ''}${esc(label)}</button>`).join('') || `<span class="muted">—</span>`;
    el.onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { onTap(b.dataset.v); drawFilterSheet(); } };
  }
  const countBy = (arr) => arr.reduce((m, k) => (k ? m.set(k, (m.get(k) || 0) + 1) : m), new Map());
  function drawFilterSheet() {
    const items = state.items, f = draft;
    const orch = countBy(items.map((i) => (i.meta ? (i.meta.orchard || 'NA') : '')));
    chipRow($('fOrchards'), [...orch].sort().map(([o, n]) => [o, `${o === 'NA' ? t('orchardUnknown') : o} · ${n}`]), (v) => f.orchard === v, (v) => { f.orchard = f.orchard === v ? '' : v; f.tree = ''; });
    const trees = f.orchard ? countBy(items.filter((i) => (i.meta && (i.meta.orchard || 'NA')) === f.orchard).map(treeKey)) : new Map();
    $('fTreesTitle').hidden = $('fTrees').hidden = !f.orchard;
    chipRow($('fTrees'), [...trees].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, n]) => [k, `${treeLabelOf(k)} · ${n}`]), (v) => f.tree === v, (v) => { f.tree = f.tree === v ? '' : v; });
    const used = new Set(); items.forEach((i) => itemCats(i).forEach((z) => used.add(z)));
    const catList = [...state.cats.map((c) => c.zh), ...[...used].filter((z) => !catOf(z))];
    chipRow($('fCats'), catList.map((z) => [z, catName(z), catColor(z)]), (v) => f.cats.includes(v), (v) => { f.cats = f.cats.includes(v) ? f.cats.filter((x) => x !== v) : [...f.cats, v]; });
    chipRow($('fDates'), DATES.map((d) => [d, t('d_' + d)]), (v) => f.date === v, (v) => { f.date = v; });
    chipRow($('fFlags'), FLAGS.map((k) => [k, t(k)]), (v) => f.flags.includes(v), (v) => { f.flags = f.flags.includes(v) ? f.flags.filter((x) => x !== v) : [...f.flags, v]; });
    const folders = countBy(items.map((i) => i.folderName));
    chipRow($('fFolders'), [...folders].map(([n, c]) => [n, `${n} · ${c}`]), (v) => f.folder === v, (v) => { f.folder = f.folder === v ? '' : v; });
    $('fApply').textContent = t('showN', { n: items.filter((i) => passesFilter(i, f)).length });
  }
  $('filterBtn').onclick = () => { draft = JSON.parse(JSON.stringify(state.filter)); $('fSearch').value = draft.q; drawFilterSheet(); openSheet('filterSheet'); };
  $('fSearch').oninput = () => { draft.q = $('fSearch').value.trim(); drawFilterSheet(); };
  $('fClear').onclick = () => { draft = { q: '', orchard: '', tree: '', cats: [], date: 'all', flags: [], folder: '' }; $('fSearch').value = ''; drawFilterSheet(); };
  $('fApply').onclick = () => { state.filter = draft; closeSheet('filterSheet'); render(); };
  function renderActiveFilters(n) {
    const f = state.filter, on = filterActive(), box = $('activeFilters');
    $('filterCount').hidden = !on; $('filterBtn').classList.toggle('on', on);
    box.hidden = !on;
    if (!on) return;
    const parts = [];
    if (f.q) parts.push(['q', `“${f.q}”`]);
    if (f.orchard) parts.push(['orchard', f.orchard === 'NA' ? t('orchardUnknown') : f.orchard]);
    if (f.tree) parts.push(['tree', treeLabelOf(f.tree)]);
    f.cats.forEach((z) => parts.push(['cat:' + z, catName(z)]));
    if (f.date !== 'all') parts.push(['date', t('d_' + f.date)]);
    f.flags.forEach((k) => parts.push(['flag:' + k, t(k)]));
    if (f.folder) parts.push(['folder', f.folder]);
    $('filterCount').textContent = parts.length;
    box.innerHTML = `<span class="af-count">${esc(t('foundN', { n }))}</span>` + parts.map(([k, l]) => `<button class="af-chip" data-k="${esc(k)}">${esc(l)}<svg><use href="#i-x"/></svg></button>`).join('');
  }
  $('activeFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k, f = state.filter;
    if (k === 'q') f.q = ''; else if (k === 'orchard') { f.orchard = ''; f.tree = ''; } else if (k === 'tree') f.tree = '';
    else if (k === 'date') f.date = 'all'; else if (k === 'folder') f.folder = '';
    else if (k.startsWith('cat:')) f.cats = f.cats.filter((x) => x !== k.slice(4));
    else if (k.startsWith('flag:')) f.flags = f.flags.filter((x) => x !== k.slice(5));
    render();
  });

  // ---------- Home: select several photos → send for review ----------
  function renderSelectBar() {
    $('selectBar').hidden = !state.selecting;
    $('selectBtn').classList.toggle('on', state.selecting);
    $('selCount').textContent = t('selectedN', { n: state.selected.size });
    $('selSubmit').disabled = !state.selected.size;
  }
  $('selectBtn').onclick = () => { state.selecting = !state.selecting; state.selected.clear(); render(); };
  $('selCancel').onclick = () => { state.selecting = false; state.selected.clear(); render(); };
  $('selAll').onclick = () => { (state.visibleIds || []).forEach((id) => state.selected.add(id)); render(); };
  $('selSubmit').onclick = async () => {
    const items = state.items.filter((i) => state.selected.has(i.id));
    if (!items.length) return;
    const noJudge = items.filter((i) => !i.judge).length;
    if (noJudge && !confirm(t('noJudgeConfirm', { n: noJudge }))) return;
    await markForReview(items);
    state.selecting = false; state.selected.clear();
    render(); toast(t('sentN', { n: items.length }));
    flushSubmissions();
  };

  // ---------- Roles ----------
  function applyRole() {
    const r = state.role, rev = r === 'reviewer';
    document.body.classList.toggle('role-reviewer', rev);
    document.body.classList.toggle('role-admin', r === 'admin');
    $$('#app > main.content:not(.rev-main), #app > nav.dock').forEach((el) => { el.hidden = rev || hubOpen; });
    $('revMain').hidden = !(rev || hubOpen);
    $('revBack').hidden = !hubOpen;
    if (rev && !revState.loaded && !state.onboardMode && state.revName) loadQueue();
    renderRoleBits();
  }
  function renderRoleBits() {
    const r = state.role;
    $('brandTag').textContent = r === 'reviewer' ? `${t('reviewerRole')} · ${state.revName || ''}` : r === 'admin' ? `${t('adminRole')} · ${state.name || ''}` : t('tagline');
    $('adminHubBtn').hidden = r !== 'admin';
    $('catRowBtn').hidden = r !== 'admin';
    $('catValue').textContent = t('catCount', { n: state.cats.length });
    $('roleValue').textContent = t(r === 'reviewer' ? 'reviewerRole' : r === 'admin' ? 'adminRole' : 'teamRole');
    $('nameValue').textContent = (r === 'reviewer' ? state.revName : state.name) || '—';
    $('saveJudge').hidden = $('sendRow').hidden = r === 'reviewer';
  }
  const $$ = (q) => [...document.querySelectorAll(q)];
  $('switchRoleBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('reenter'); };

  // ---------- Review list (reviewers; admin "review hub") ----------
  const revState = { items: [], loaded: false, loading: false, tab: 'todo', sort: 'new', cat: '', by: '', orchard: '', date: 'all' };
  let hubOpen = false;
  const thumbCache = new Map(), imgCache = new Map();
  const revIsAdmin = () => state.role === 'admin';
  const myName = () => (state.role === 'reviewer' ? state.revName : state.name) || '';
  const mine = (s) => (s.reviews || []).filter((r) => String(r.reviewer).trim().toLowerCase() === myName().trim().toLowerCase());
  const labelsKey = (r) => [...(r.labels || [])].sort().join('|') + '|' + String(r.labelText || '').trim().toLowerCase();
  const disagree = (s) => { const l = latestPer(s.reviews); return l.length >= 2 && new Set(l.map(labelsKey)).size > 1; };
  async function loadQueue() {
    if (revState.loading) return;
    if (!navigator.onLine) { $('revOffline').hidden = false; renderQueue(); return; }
    $('revOffline').hidden = true;
    revState.loading = true; $('revCount').textContent = t('loading');
    try {
      const r = await api({ action: 'queue', key: state.password, tz: tzName(), reviewer: state.role === 'reviewer' ? state.revName : '' });
      if (r.ok) { revState.items = r.items || []; revState.loaded = true; mergeOutbox(); }
      else if (r.error === 'bad_key') passwordRejected();
      else toast(t('serverErr'), true);
    } catch (e) { console.error(e); toast(t('serverErr'), true); }
    revState.loading = false;
    renderQueue();
  }
  function revTabs() { return revIsAdmin() ? ['todo', 'reviewed', 'disagree', 'all'] : ['todo', 'mine', 'all']; }
  function revPass(s) {
    const tab = revState.tab, n = latestPer(s.reviews).length;
    if (revIsAdmin()) {
      if (tab === 'todo' && s.reviewCount > 0) return false;
      if (tab === 'reviewed' && !(s.reviewCount > 0)) return false;
      if (tab === 'disagree' && !disagree(s)) return false;
    } else {
      if (tab === 'todo' && mine(s).length) return false;
      if (tab === 'mine' && !mine(s).length) return false;
    }
    if (revState.cat && !(s.labels || []).includes(revState.cat)) return false;
    if (revState.by && s.by !== revState.by) return false;
    if (revState.orchard && (s.orchard || '') !== revState.orchard) return false;
    if (!dateOk({ capturedAt: s.submittedAt }, revState.date)) return false;
    return n >= 0;
  }
  function fillSelect(el, allLabel, values, cur, label = (v) => v) {
    el.innerHTML = `<option value="">${esc(allLabel)}</option>` + values.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  }
  function renderQueue() {
    const tabs = revTabs();
    $('revTitle').textContent = t(revIsAdmin() ? 'reviewHub' : 'reviewList');
    $('revTabs').style.setProperty('--n', tabs.length);
    $('revTabs').innerHTML = tabs.map((k) => `<button type="button" data-tab="${k}" class="${revState.tab === k ? 'on' : ''}">${esc(t('tab_' + k))}</button>`).join('');
    const all = revState.items;
    $('revSort').innerHTML = ['new', 'old', 'unsure'].map((k) => `<option value="${k}" ${revState.sort === k ? 'selected' : ''}>${esc(t('sort_' + k))}</option>`).join('');
    const cats = [...new Set(all.flatMap((s) => s.labels || []))];
    fillSelect($('revCat'), t('allCats'), cats, revState.cat, catName);
    fillSelect($('revBy'), t('allPeople'), [...new Set(all.map((s) => s.by).filter(Boolean))], revState.by);
    fillSelect($('revOrchard'), t('allOrchards'), [...new Set(all.map((s) => s.orchard).filter(Boolean))], revState.orchard);
    $('revDate').innerHTML = DATES.map((d) => `<option value="${d}" ${revState.date === d ? 'selected' : ''}>${esc(t('d_' + d))}</option>`).join('');
    let list = all.filter(revPass);
    if (revState.sort === 'old') list = list.slice().reverse();
    if (revState.sort === 'unsure') list = list.slice().sort((a, b) => (a.confident === b.confident ? 0 : a.confident ? 1 : -1));
    $('revCount').textContent = revState.loading ? t('loading') : t('foundN', { n: list.length });
    $('revEmpty').hidden = list.length > 0 || revState.loading;
    $('revEmptyText').textContent = t(revState.loaded ? 'revEmpty' : 'revNotLoaded');
    $('revList').innerHTML = list.slice(0, 300).map((s) => {
      const me = latestPer(mine(s))[0], n = latestPer(s.reviews).length;
      const stateTags = revIsAdmin()
        ? `<span class="state-tag ${s.reviewCount ? 'done' : 'todo'}">${esc(s.reviewCount ? t('reviewedN', { n: s.reviewCount }) : t('awaitReview'))}</span>${n >= 2 ? `<span class="agree-tag ${disagree(s) ? 'diff' : 'same'}">${esc(t(disagree(s) ? 'disagree' : 'agreeAll'))}</span>` : ''}`
        : me ? `<span class="state-tag done">${esc(t('myVerdict', { v: t(me.verdict === 'agree' ? 'vAgree' : 'vCorrect') }))}</span>` : `<span class="state-tag todo">${esc(t('awaitReview'))}</span>`;
      const thumb = thumbCache.get(s.id);
      return `<button class="rv-item" data-sid="${esc(s.id)}"><div class="rv-thumb" ${thumb ? `style="background-image:url('${thumb}')"` : ''}></div>
        <div><div class="rv-title">${esc(s.orchard && s.orchard !== 'NA' ? s.orchard : s.folder)}${s.tree ? ' · ' + esc(treeLabelOf(String(s.tree).replace(/-p\d+$/, ''))) : ''}</div>
        <div class="rv-meta">${esc(s.by)} · ${esc(fmtDateTime(s.capturedAt || s.submittedAt))}</div>
        ${lblsHtml(s.labels, s.labelText, s.confident)}<div class="rv-state">${stateTags}</div></div></button>`;
    }).join('');
    loadThumbs(list.slice(0, 300).filter((s) => !thumbCache.has(s.id)).map((s) => s.id));
    $('hubBadge').hidden = !revIsAdmin() || !revState.loaded;
    $('hubBadge').textContent = all.filter((s) => !s.reviewCount).length;
  }
  let thumbBusy = false;
  async function loadThumbs(ids) {
    if (thumbBusy || !ids.length || !navigator.onLine) return;
    thumbBusy = true;
    try {
      for (let k = 0; k < ids.length; k += 30) {
        const r = await api({ action: 'thumbs', key: state.password, tz: tzName(), ids: ids.slice(k, k + 30) });
        if (!r.ok) break;
        Object.entries(r.thumbs || {}).forEach(([id, th]) => { if (th) thumbCache.set(id, th); const el = document.querySelector(`.rv-item[data-sid="${CSS.escape(id)}"] .rv-thumb`); if (el && th) el.style.backgroundImage = `url('${th}')`; });
      }
    } catch {} finally { thumbBusy = false; }
  }
  $('revTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { revState.tab = b.dataset.tab; renderQueue(); } };
  [['revSort', 'sort'], ['revCat', 'cat'], ['revBy', 'by'], ['revOrchard', 'orchard'], ['revDate', 'date']].forEach(([id, k]) => { $(id).onchange = () => { revState[k] = $(id).value; renderQueue(); }; });
  $('revRefresh').onclick = () => loadQueue();
  $('revList').onclick = (e) => { const b = e.target.closest('[data-sid]'); if (b) openRevSheet(revState.items.find((s) => s.id === b.dataset.sid)); };
  $('adminHubBtn').onclick = () => { hubOpen = true; applyRole(); window.scrollTo(0, 0); revState.tab = 'todo'; loadQueue(); };
  $('revBack').onclick = () => { hubOpen = false; applyRole(); render(); window.scrollTo(0, 0); };

  // ---------- Reviewing one photo ----------
  let rv = { sub: null, src: null, marks: [], verdict: null };
  let rvShowSub = true; // photographer's marks visible to the reviewer (can be switched off to look without bias)
  const rvRef = () => (rvShowSub && rv.sub ? rv.sub.marks || [] : []);
  async function photoUrl(s) {
    if (imgCache.has(s.fileId)) return imgCache.get(s.fileId);
    const local = state.items.find((i) => i.id === s.id); // admin's own photo: already on this phone
    let blob = local ? ((await getBlob(local.id)) || (await getBlob(local.id + '_p'))) : null;
    if (!blob && !DEMO) {
      const r = await api({ action: 'image', key: state.password, tz: tzName(), fileId: s.fileId, size: 2048 });
      if (r.ok && r.data) { const bin = atob(r.data); const u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); blob = new Blob([u8], { type: r.mime || 'image/jpeg' }); }
    }
    const url = blob ? URL.createObjectURL(blob) : (thumbCache.get(s.id) || '');
    if (blob) { imgCache.set(s.fileId, url); if (imgCache.size > 25) { const [k, u] = imgCache.entries().next().value; URL.revokeObjectURL(u); imgCache.delete(k); } }
    return url;
  }
  function drawRvMarks() {
    const im = $('rvImg');
    if (!im.naturalWidth) return;
    const svg = $('rvSvg');
    Object.assign(svg.style, { left: im.offsetLeft + 'px', top: im.offsetTop + 'px', width: im.offsetWidth + 'px', height: im.offsetHeight + 'px', inset: 'auto' });
    renderMarks(svg, [...asRef(rvRef()), ...rv.marks], im.offsetWidth, im.offsetHeight);
    $('rvDrawText').textContent = rv.marks.length ? t('editMarks', { n: rv.marks.length }) : t('drawMarks');
  }
  function setVerdict(v) {
    rv.verdict = v;
    $('rvVerdict').innerHTML = [['agree', 'vAgree'], ['correct', 'vCorrect']].map(([k, l]) => `<button type="button" data-v="${k}" class="${v === k ? 'on' : ''}">${esc(t(l))}</button>`).join('');
  }
  async function openRevSheet(s) {
    if (!s) return;
    rv = { sub: s, src: null, marks: [], verdict: null };
    const im = $('rvImg'); im.removeAttribute('src'); $('rvSvg').innerHTML = '';
    $('rvLoading').textContent = t('loadingPhoto'); $('rvLoading').hidden = false;
    const tree = s.tree ? treeLabelOf(String(s.tree).replace(/-p\d+$/, '')) + ` (${s.tree})` : '';
    $('rvInfo').innerHTML = [['fBy', s.by], ['fOrchard', s.orchard], ['fTree', tree], ['fTime', fmtDateTime(s.capturedAt || s.submittedAt)], ['fFolder', s.folder], ['flNote', s.note], ['fFile', s.name]]
      .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('');
    const subMarks = s.marks || [];
    $('rvSubmitter').innerHTML = `<div class="judge-view"><div class="jv-head"><b>${esc(t('submitterJudge', { n: s.by }))}</b></div>${lblsHtml(s.labels, s.labelText, s.confident)}
      ${subMarks.length ? `<label class="rm-old sub-marks"><div><div class="set-title">${esc(t('showSubMarks'))}</div><div class="set-desc">${esc(t('subMarksN', { n: subMarks.length }))}</div></div><span class="switch"><input type="checkbox" id="rvShowSub" ${rvShowSub ? 'checked' : ''}><span></span></span></label>` : ''}</div>`;
    if ($('rvShowSub')) $('rvShowSub').onchange = (e) => { rvShowSub = e.target.checked; drawRvMarks(); };
    // admin sees every expert; a reviewer never sees the others
    $('rvOthers').innerHTML = revIsAdmin() && (s.reviews || []).length ? `<div class="set-sub">${esc(t('expertReviews', { n: latestPer(s.reviews).length }))}</div>${reviewCards(s.reviews)}` : '';
    $('rvOthers').querySelectorAll('[data-marks]').forEach((b) => b.onclick = async () => { const r = latestPer(s.reviews).find((x) => x.reviewer === b.dataset.marks); openViewer(await photoUrl(s), null, [...asRef(s.marks), ...(r ? r.marks : [])]); });
    const prev = latestPer(mine(s))[0];
    $('rvPrev').hidden = !prev;
    if (prev) $('rvPrev').textContent = t('yourPrev', { v: prev.version || 1, d: fmtDateTime(prev.at) });
    setVerdict(prev ? prev.verdict : null);
    rvJudge.set(prev ? { labels: prev.labels, text: prev.labelText } : { labels: s.labels, text: s.labelText });
    $('rvComment').value = prev ? prev.comment : '';
    rv.marks = prev && prev.marks ? JSON.parse(JSON.stringify(prev.marks)) : [];
    openSheet('revSheet');
    rv.src = await photoUrl(s);
    if (rv.sub !== s) return;
    $('rvLoading').hidden = !!rv.src;
    if (!rv.src) $('rvLoading').textContent = t('photoFailed');
    im.onload = drawRvMarks;
    if (rv.src) im.src = rv.src;
  }
  $('rvVerdict').onclick = (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    setVerdict(b.dataset.v);
    if (b.dataset.v === 'agree') rvJudge.set({ labels: rv.sub.labels, text: rv.sub.labelText }); // agree = same as the photographer
  };
  rvJudge.onchange = () => { // changing the categories means it is a correction
    const j = rvJudge.get(), s = rv.sub;
    const same = [...j.labels].sort().join('|') === [...(s.labels || [])].sort().join('|') && j.text === (s.labelText || '');
    setVerdict(same ? 'agree' : 'correct');
  };
  $('rvImgBox').onclick = () => { if (rv.src) openViewer(rv.src, null, [...asRef(rvRef()), ...rv.marks]); };
  $('rvDraw').onclick = () => { if (rv.src) openEditor(rv.src, rv.marks, (m) => { rv.marks = m; drawRvMarks(); }, rvJudge.get().labels, rvRef()); };
  // Sending a review is instant for the reviewer: it is saved on the phone (outbox), the sheet closes at once,
  // and it is sent in the background (retried when back online / next time the app opens).
  const OUTBOX = 'revOutbox';
  const outbox = () => store.get(OUTBOX, []);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  function saveOutbox(list) {
    try { localStorage.setItem('dm_' + OUTBOX, JSON.stringify(list)); }
    catch { store.set(OUTBOX, list.map((x) => ({ ...x, markPng: '' }))); } // phone storage full: keep the review, drop the marked copy
  }
  function mergeOutbox() { // reviews not sent yet still count as done on this phone
    for (const p of outbox()) {
      const s = revState.items.find((x) => x.id === p.subId);
      if (s && !(s.reviews || []).some((r) => r.cid === p.cid)) { (s.reviews = s.reviews || []).push(p.local); s.reviewCount = latestPer(s.reviews).length; }
    }
  }
  let revFlushing = false;
  async function flushReviews() {
    if (revFlushing || !navigator.onLine || !state.password || !outbox().length) return;
    revFlushing = true;
    try {
      for (const p of outbox()) {
        const { local, ...body } = p;
        let res;
        try { res = await api({ ...body, action: 'review', key: state.password, tz: tzName() }); } catch (e) { console.error(e); break; } // offline / timeout: try later
        if (!res.ok && res.error === 'bad_key') { passwordRejected(); break; }
        if (!res.ok && res.error !== 'marks_too_big' && res.error !== 'bad_review') break; // server busy: try later
        if (!res.ok) toast(t('marksTooBig'), true);
        saveOutbox(outbox().filter((x) => x.cid !== p.cid));
        if (res.ok && local) local.version = res.version || local.version;
      }
    } finally {
      revFlushing = false;
      const left = outbox().length;
      if (left && !navigator.onLine) toast(t('revQueued', { n: left }));
    }
  }
  $('rvSubmit').onclick = async () => {
    if (!rv.verdict) { toast(t('pickVerdict'), true); return; }
    const j = rvJudge.get(), s = rv.sub, src = rv.src;
    const marks = rv.marks.map((m) => ({ ...m, p: m.p.map((q) => [Math.round(q[0] * 10000) / 10000, Math.round(q[1] * 10000) / 10000]) }));
    const comment = $('rvComment').value.trim(), cid = uid();
    const prev = (s.reviews || []).filter((r) => String(r.reviewer).trim().toLowerCase() === myName().trim().toLowerCase()).length;
    const local = { cid, at: new Date().toISOString(), reviewer: myName(), verdict: rv.verdict, labels: j.labels, labelText: j.text, comment, marks, version: prev + 1 };
    (s.reviews = s.reviews || []).push(local);
    s.reviewCount = latestPer(s.reviews).length;
    const entry = { cid, subId: s.id, reviewer: myName(), verdict: rv.verdict, labels: j.labels, labelText: j.text, comment, marks, markPng: '', photoName: s.name, local };
    saveOutbox([...outbox(), entry]);
    closeSheet('revSheet'); renderQueue(); toast(t(navigator.onLine ? 'reviewSaved' : 'revQueued', { n: outbox().length }));
    // The marked copy for Drive is drawn after the sheet has closed.
    if (marks.length && src) {
      try {
        const png = await flattenMarks(src, marks, 1600);
        saveOutbox(outbox().map((x) => (x.cid === cid ? { ...x, markPng: png } : x)));
      } catch {}
    }
    flushReviews();
  };

  // ---------- Drawing editor ----------
  const me = { marks: [], hist: [], fut: [], tool: 'ellipse', w: 2, cat: '', col: '#e53935', mode: 'draw', cur: null, hidden: false, cb: null, start: '', ref: [] };
  const asRef = (marks) => (marks || []).map((m) => ({ ...m, d: 1 })); // shown dashed, not editable

  const mez = makeZoomer($('meStage'), $('meLayer'), { noDoubleTap: true, claim: () => me.mode === 'draw', onFit: () => meRender() });
  function meRender() {
    renderMarks($('meSvg'), me.hidden ? [] : [...asRef(me.ref), ...me.marks, me.cur].filter(Boolean), mez.cw, mez.ch);
    $('meList').innerHTML = me.marks.length ? me.marks.map((m, i) => `<span><b style="background:${esc(m.col)}">${i + 1}</b>${esc(m.c ? catName(m.c) : t('markOther'))}<button type="button" data-del="${i}">✕</button></span>`).join('') : `<span class="me-empty">${esc(t('meHint'))}</span>`;
    $('meUndo').disabled = !me.hist.length; $('meRedo').disabled = !me.fut.length;
    $$('#meTools [data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === me.tool));
    $$('#meWidths [data-w]').forEach((b) => b.classList.toggle('on', Number(b.dataset.w) === me.w));
    $$('#meMode [data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === me.mode));
    $('meToggle').classList.toggle('on', me.hidden);
    $('meColorDot').style.background = me.col; $('meColor').value = me.col;
    $('meCats').innerHTML = [...state.cats.filter((c) => c.zh !== '健康'), { zh: '', color: me.cat ? '#888888' : me.col }].map((c) => `<button type="button" data-cat="${esc(c.zh)}" class="${me.cat === c.zh ? 'on' : ''}"><i class="cat-dot" style="background:${esc(c.zh ? c.color : me.col)}"></i>${esc(c.zh ? catName(c.zh) : t('markOther'))}</button>`).join('');
  }
  function openEditor(src, marks, cb, preferCats, refMarks) {
    me.marks = JSON.parse(JSON.stringify(marks || [])); me.hist = []; me.fut = []; me.cb = cb; me.cur = null; me.hidden = false; me.mode = 'draw';
    me.ref = refMarks || [];
    me.start = JSON.stringify(me.marks);
    const first = (preferCats || []).find((z) => catOf(z) && z !== '健康');
    me.cat = first || (state.cats[0] || {}).zh || ''; me.col = me.cat ? catColor(me.cat) : '#e53935';
    $('markEd').hidden = false;
    const im = $('meImg');
    mez.s = 1; mez.x = 0; mez.y = 0;
    im.onload = () => mez.fit(im.naturalWidth, im.naturalHeight);
    im.src = src;
    if (im.complete && im.naturalWidth) mez.fit(im.naturalWidth, im.naturalHeight);
    meRender();
  }
  const closeEditor = () => { $('markEd').hidden = true; $('meImg').removeAttribute('src'); };
  const snapshot = () => { me.hist.push(JSON.stringify(me.marks)); me.fut = []; if (me.hist.length > 60) me.hist.shift(); };
  const clamp01 = (q) => [Math.min(1, Math.max(0, q[0])), Math.min(1, Math.max(0, q[1]))];
  const stageEl = $('meStage');
  stageEl.addEventListener('pointerdown', (e) => {
    if (me.mode !== 'draw' || me.cur) return;
    try { stageEl.setPointerCapture(e.pointerId); } catch {}
    me.pid = e.pointerId;
    me.cur = { t: me.tool, c: me.cat, col: me.col, w: me.w, p: [clamp01(mez.toPhoto(e))] };
    meRender();
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!me.cur || e.pointerId !== me.pid) return;
    const q = clamp01(mez.toPhoto(e));
    if (me.cur.t === 'pen') { const l = me.cur.p[me.cur.p.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.003) me.cur.p.push(q); }
    else me.cur.p = [me.cur.p[0], q];
    meRender();
  });
  const meUp = (e) => {
    if (!me.cur || e.pointerId !== me.pid) return;
    const m = me.cur; me.cur = null;
    const a = m.p[0], b = m.p[m.p.length - 1], size = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if ((m.t === 'pen' && m.p.length >= 2) || (m.t !== 'pen' && size > 0.015)) {
      if (m.t === 'pen' && m.p.length > 300) { const k = Math.ceil(m.p.length / 300); m.p = m.p.filter((_, i) => i % k === 0 || i === m.p.length - 1); }
      snapshot(); me.marks.push(m);
    }
    meRender();
  };
  stageEl.addEventListener('pointerup', meUp);
  stageEl.addEventListener('pointercancel', meUp);
  $('meMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { me.mode = b.dataset.m; meRender(); } };
  $('meTools').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { me.tool = b.dataset.t; me.mode = 'draw'; meRender(); } };
  $('meWidths').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) { me.w = Number(b.dataset.w); meRender(); } };
  $('meCats').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; me.cat = b.dataset.cat; if (me.cat) me.col = catColor(me.cat); me.mode = 'draw'; meRender(); };
  $('meColor').oninput = () => { me.col = $('meColor').value; meRender(); };
  $('meUndo').onclick = () => { if (!me.hist.length) return; me.fut.push(JSON.stringify(me.marks)); me.marks = JSON.parse(me.hist.pop()); meRender(); };
  $('meRedo').onclick = () => { if (!me.fut.length) return; me.hist.push(JSON.stringify(me.marks)); me.marks = JSON.parse(me.fut.pop()); meRender(); };
  $('meClear').onclick = () => { if (me.marks.length && confirm(t('clearMarksQ'))) { snapshot(); me.marks = []; meRender(); } };
  $('meToggle').onclick = () => { me.hidden = !me.hidden; meRender(); };
  $('meList').onclick = (e) => { const b = e.target.closest('[data-del]'); if (b) { snapshot(); me.marks.splice(Number(b.dataset.del), 1); meRender(); } };
  $('meDone').onclick = () => { const cb = me.cb; const m = me.marks; closeEditor(); if (cb) cb(m); };
  $('meCancel').onclick = () => { if (JSON.stringify(me.marks) !== me.start && !confirm(t('discardMarksQ'))) return; closeEditor(); };

  // ---------- Categories (admin) ----------
  function suggestions() {
    const known = new Set(state.cats.map((c) => c.zh.toLowerCase()));
    const words = new Map();
    const add = (txt) => String(txt || '').split(/[,，、;；/]+/).map((w) => w.trim()).filter((w) => w && w.length <= 20 && !known.has(w.toLowerCase())).forEach((w) => words.set(w, (words.get(w) || 0) + 1));
    revState.items.forEach((s) => { add(s.labelText); (s.reviews || []).forEach((r) => add(r.labelText)); });
    state.items.forEach((i) => { if (i.judge) add(i.judge.text); });
    return [...words].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }
  function drawCats() {
    $('catList').innerHTML = state.cats.map((c) => `<button type="button" class="cat-chip"><i class="cat-dot" style="background:${esc(c.color)}"></i>${esc(c.zh)}${c.en ? ' · ' + esc(c.en) : ''}${c.ms ? ' · ' + esc(c.ms) : ''}</button>`).join('');
    const sg = suggestions();
    $('catSuggestTitle').hidden = !sg.length;
    $('catSuggest').innerHTML = sg.map(([w, n]) => `<button type="button" data-w="${esc(w)}">＋ ${esc(w)} · ${n}</button>`).join('');
  }
  $('catRowBtn').onclick = () => { closeSheet('settingsSheet'); drawCats(); openSheet('catSheet'); if (!revState.loaded) loadQueue().then(drawCats); };
  $('catSuggest').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) { $('catZh').value = b.dataset.w; $('catZh').focus(); } };
  $('catAddBtn').onclick = async () => {
    const zh = $('catZh').value.trim(); if (!zh) return;
    if (!navigator.onLine) { toast(t('revNeedNet'), true); return; }
    const r = await api({ action: 'addCategory', key: state.password, tz: tzName(), zh, en: $('catEn').value.trim(), ms: $('catMs').value.trim() });
    if (r.ok) { state.cats = r.categories; store.set('cats', r.categories); $('catZh').value = $('catEn').value = $('catMs').value = ''; drawCats(); render(); toast(t('catAdded', { n: zh })); }
    else toast(t('serverErr'), true);
  };

  // ---------- Demo mode: a pretend backend kept in this browser ----------
  function demoApi(b) {
    const key = String(b.key || '');
    const role = key === 'admin' ? 'admin' : key === 'review' ? 'reviewer' : 'team';
    const subs = store.get('demoSubs', []), revs = store.get('demoRevs', {});
    switch (b.action) {
      case 'login': return { ok: true, role };
      case 'folders': return { ok: true, folders: DEMO_FOLDERS };
      case 'categories': return { ok: true, categories: store.get('demoCats', DEFAULT_CATS) };
      case 'addCategory': { const c = store.get('demoCats', DEFAULT_CATS); if (!c.some((x) => x.zh === b.zh)) c.push({ zh: b.zh, en: b.en, ms: b.ms, color: '#00acc1' }); store.set('demoCats', c); return { ok: true, categories: c }; }
      case 'submit': {
        (b.items || []).forEach((it) => { const k = subs.findIndex((x) => x.id === it.id); const row = { ...it, submittedAt: new Date().toISOString() }; if (k >= 0) subs[k] = row; else subs.push(row); });
        store.set('demoSubs', subs); return { ok: true };
      }
      case 'queue': {
        const me2 = String(b.reviewer || '').trim().toLowerCase();
        return { ok: true, items: subs.slice().reverse().map((x) => { const all = revs[x.id] || []; const { thumb, ...rest } = x; return { ...rest, reviews: role === 'admin' ? all : all.filter((r) => r.reviewer.trim().toLowerCase() === me2), reviewCount: latestPer(all).length }; }) };
      }
      case 'thumbs': { const o = {}; (b.ids || []).forEach((id) => { const x = subs.find((y) => y.id === id); if (x) o[id] = x.thumb; }); return { ok: true, thumbs: o }; }
      case 'myReviews': { const o = {}; (b.ids || []).forEach((id) => { if (revs[id]) o[id] = revs[id]; }); return { ok: true, reviews: o }; }
      case 'review': {
        const list = revs[b.subId] = revs[b.subId] || [];
        const version = list.filter((r) => r.reviewer.trim().toLowerCase() === String(b.reviewer).trim().toLowerCase()).length + 1;
        list.push({ at: new Date().toISOString(), reviewer: b.reviewer, verdict: b.verdict, labels: b.labels, labelText: b.labelText, comment: b.comment, marks: b.marks, version });
        store.set('demoRevs', revs); return { ok: true, version };
      }
      default: return { ok: true, id: 'demo' };
    }
  }

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

  // ---------- Versions, update history, automatic updates ----------
  const VERSION = window.DURIMAGE_VERSION || '0';
  const LOG = window.DURIMAGE_CHANGELOG || [];
  const fmtDateTime = (iso) => new Date(iso).toLocaleString(LOCALE(), { dateStyle: 'medium', timeStyle: 'short' });
  const notesOf = (e) => (e.notes[state.lang] || e.notes.en || []);
  const notesHtml = (e) => `<ul class="notes">${notesOf(e).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;

  function renderHistory() {
    $('versionValue').textContent = 'v' + VERSION;
    $('histCurrent').textContent = 'v' + VERSION;
    $('histList').innerHTML = LOG.map((e, i) => `<li>
      <div class="hist-top"><b>v${esc(e.version)}</b>${i === 0 ? `<span class="tag">${esc(t('latest'))}</span>` : ''}
        <time datetime="${esc(e.date)}">${esc(fmtDateTime(e.date))}</time></div>
      ${notesHtml(e)}</li>`).join('');
  }
  $('historyRowBtn').onclick = () => { closeSheet('settingsSheet'); openSheet('historySheet'); };

  // "What's new": once per new version, listing every release since the one this phone last saw.
  function maybeShowWhatsNew() {
    if (state.onboardMode || !LOG.length) return;
    // Phones that used the app before version tracking existed count as having seen 1.1.0.
    const seen = store.get('seenVersion', state.password ? '1.1.0' : null);
    store.set('seenVersion', VERSION);
    if (!seen || seen === VERSION) return;
    const idx = LOG.findIndex((e) => e.version === seen);
    const fresh = LOG.slice(0, idx === -1 ? 1 : idx);
    if (!fresh.length) return;
    $('wnTitle').textContent = t('updatedTo', { v: VERSION });
    $('wnDate').textContent = fmtDateTime(fresh[0].date);
    $('wnBody').innerHTML = fresh.map((e) => (fresh.length > 1 ? `<div class="wn-ver">v${esc(e.version)}</div>` : '') + notesHtml(e)).join('');
    openSheet('whatsNewSheet');
  }

  // A new service worker takes over → reload into the new version, but never in the middle of
  // an upload or while the user is saving a photo.
  let swReg = null, pendingReload = false;
  let pickerOpenUntil = 0; // set when the camera/gallery opens; the photo arrives a moment after we return
  function maybeReload() {
    if (!pendingReload || state.uploading || !$('reviewSheet').hidden) return;
    if (Date.now() < pickerOpenUntil) { setTimeout(maybeReload, 2000); return; }
    location.reload();
  }
  async function checkForUpdate(manual) {
    if (!swReg) { if (manual) toast(t('checkFailed'), true); return; }
    try {
      await swReg.update();
      if (!manual) return;
      if (swReg.installing || swReg.waiting) toast(t('updateFound'));
      else toast(t('upToDate'));
    } catch { if (manual) toast(t('checkFailed'), true); }
  }
  $('checkUpdateBtn').onclick = () => checkForUpdate(true);
  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller; // false on the very first visit
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      pendingReload = true; maybeReload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      swReg = reg;
      setInterval(() => checkForUpdate(false), 30 * 60 * 1000);
    }).catch(() => {});
  }

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
  $('gpsToggle').onchange = (e) => { state.gps = e.target.checked; store.set('gps', state.gps); if (state.gps) gpsStart(); else gpsStop(); };
  $('editNameBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('editName'); };
  $('reenterPwBtn').onclick = () => { closeSheet('settingsSheet'); showOnboard('reenter'); };
  $('clearHistoryBtn').onclick = async () => {
    for (const i of state.items.filter((x) => x.status === 'done')) { await delItem(i.id); await delBlob(i.id + '_p'); }
    state.items = state.items.filter((x) => x.status !== 'done');
    render(); toast(t('historyCleared'));
  };

  window.addEventListener('online', () => { render(); processQueue(); flushSubmissions(); flushReviews(); loadCats(); });
  window.addEventListener('offline', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { setAppHeight(); if (state.role !== 'reviewer') { maybeAskNewDay(); if (state.password) gpsStart(); flushSubmissions(); fetchMyReviews(false); } processQueue(); flushReviews(); checkForUpdate(false); maybeReload(); } });

  // iPhone home-screen apps: after the keyboard closes, the window can stay shrunk (bottom bar
  // floats up, strip at the bottom). Scrolling back to the top once the last field loses focus
  // makes iOS restore the full window; then re-measure.
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // moved to another field
      if (window.visualViewport && window.visualViewport.offsetTop === 0 && window.scrollY === 0) { setAppHeight(); return; }
      window.scrollTo(0, 0);
      setAppHeight();
    }, 120);
  });
  // Keep --app-h equal to the real window height (rotation, iOS toolbars, keyboard closing).
  function setAppHeight() {
    document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
    checkViewportGap();
  }
  // Detects the iPhone home-screen bug where the window is shorter than the screen (keyboard closed).
  // Only iOS home-screen apps (navigator.standalone): there the window normally fills the whole screen.
  function checkViewportGap() {
    const html = document.documentElement;
    if (navigator.standalone !== true) { html.classList.remove('vp-gap'); return; }
    const vv = window.visualViewport;
    if (vv && vv.height < window.innerHeight - 80) return; // keyboard is open: leave as is
    const full = window.innerWidth < window.innerHeight ? screen.height : screen.width;
    const gap = Math.round(full - window.innerHeight);
    html.classList.toggle('vp-gap', gap > 20 && gap < 140);
  }
  // Right after launch/reload, give iOS a nudge to recompute the window, then re-check.
  function nudgeViewport() {
    if (navigator.standalone !== true) return;
    setTimeout(() => { window.scrollTo(0, 0); setAppHeight(); }, 300);
    setTimeout(setAppHeight, 1200);
  }
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 300));

  // Splash: stays at least ~0.8 s after launch so it doesn't flash, then fades out.
  function hideSplash() {
    const el = $('splash'); if (!el) return;
    $('splashTag').textContent = t('tagline');
    const wait = Math.max(0, 800 - performance.now());
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 600); }, wait);
  }

  // ---------- Boot ----------
  (async () => {
    try {
      state.items = await allItems();
      for (const i of state.items) if (i.status === 'uploading') { i.status = 'queued'; await putItem(i); }
    } catch (e) { console.error(e); }
    // Brand-new phone (never logged in, never saw a version): nothing to announce later.
    if (store.get('seenVersion', null) === null && !state.password) store.set('seenVersion', VERSION);
    applyTheme();
    applyI18n();
    applyRole();
    if (!needsOnboard()) { refreshFolders(false); processQueue(); }
    if (!state.onboardMode) {
      maybeShowWhatsNew();
      loadCats();
      if (state.role !== 'reviewer') { maybeAskNewDay(); gpsStart(); flushSubmissions(); fetchMyReviews(true); } flushReviews();
    }
    setupServiceWorker();
    hideSplash();
    setAppHeight(); nudgeViewport();
  })();
})();
