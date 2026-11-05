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
    $('pwErr').textContent = '';
    $('pwInput').value = '';
    $('pwInput').classList.remove('bad');
    $('nameInput').value = nonAscii(state.name) ? '' : (state.name || '');
    // No auto-focus on first launch: the keyboard would cover the intro. Focus only when re-entering.
    if (mode !== 'pw') setTimeout(() => (pwStep ? $('pwInput') : $('nameInput')).focus(), 50);
  }
  function hideOnboard() {
    $('onboard').hidden = true; state.onboardMode = null;
    document.body.classList.remove('ob-mode'); document.documentElement.classList.remove('ob-mode');
    maybeShowWhatsNew();
    if (state.password && state.name) gpsStart(); // location permission is asked now, not when the camera opens
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
    const name = $('nameInput').value.replace(/[^A-Za-z0-9 \-]/g, '').trim().replace(/\s+/g, ' ');
    if (!name) { $('nameInput').classList.remove('bad'); void $('nameInput').offsetWidth; $('nameInput').classList.add('bad'); return; }
    state.name = name; store.set('name', name);
    hideOnboard(); render(); processQueue();
  });
  $('pwCancel').onclick = hideOnboard;
  asciiField($('nameInput'), null, false);
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
  function asciiField(input, warn, upper) {
    const run = (e) => {
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
    const drop = done.slice(120);
    for (const old of drop) { await delItem(old.id); await delBlob(old.id + '_p'); }
    const ids = new Set(drop.map((i) => i.id));
    state.items = state.items.filter((i) => !ids.has(i.id));
  }

  // ---------- Full-screen viewer (pinch / double-tap zoom, drag to pan) ----------
  const vw = { s: 1, x: 0, y: 0, pts: new Map(), pinch: null, pan: null, lastTap: 0, url: null };
  function vwApply() {
    const st = $('viewerStage'), W = st.clientWidth, H = st.clientHeight;
    vw.s = Math.min(8, Math.max(1, vw.s));
    // The photo is letter-boxed inside the screen; clamp against the photo itself, not the screen:
    // bigger than the screen → no empty edge may show; smaller → keep it centred.
    const im = $('viewerImg'), r = (im.naturalWidth || W) / (im.naturalHeight || H);
    const cw = Math.min(W, H * r), ch = cw / r, ox = (W - cw) / 2, oy = (H - ch) / 2;
    const fit = (pos, size, off, view) => size * vw.s <= view
      ? (view - size * vw.s) / 2 - off * vw.s
      : Math.min(-off * vw.s, Math.max(view - (off + size) * vw.s, pos));
    vw.x = fit(vw.x, cw, ox, W);
    vw.y = fit(vw.y, ch, oy, H);
    $('viewerImg').style.transform = `translate(${vw.x}px, ${vw.y}px) scale(${vw.s})`;
  }
  function vwZoomAt(px, py, ns) { const p = { x: (px - vw.x) / vw.s, y: (py - vw.y) / vw.s }; vw.s = ns; vw.x = px - p.x * ns; vw.y = py - p.y * ns; vwApply(); }
  function openViewer(src, ownedUrl) {
    vw.s = 1; vw.x = 0; vw.y = 0; vw.pts.clear(); vw.pinch = vw.pan = null;
    if (vw.url) URL.revokeObjectURL(vw.url);
    vw.url = ownedUrl || null;
    $('viewerImg').src = src;
    $('viewerImg').style.transform = '';
    $('viewer').hidden = false;
    $('viewerHint').classList.remove('gone');
    setTimeout(() => $('viewerHint').classList.add('gone'), 2500);
  }
  function closeViewer() { $('viewer').hidden = true; $('viewerImg').removeAttribute('src'); if (vw.url) { URL.revokeObjectURL(vw.url); vw.url = null; } }
  $('viewerClose').onclick = closeViewer;
  const stage = $('viewerStage');
  const rel = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch {} // keep tracking a finger that slides off the photo
    vw.pts.set(e.pointerId, rel(e));
    if (vw.pts.size === 2) {
      const [a, b] = [...vw.pts.values()];
      vw.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vw.s, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: vw.x, y: vw.y };
      vw.pan = null;
    } else if (vw.pts.size === 1) {
      const p = rel(e);
      vw.pan = { sx: p.x, sy: p.y, x: vw.x, y: vw.y, moved: false };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!vw.pts.has(e.pointerId)) return;
    vw.pts.set(e.pointerId, rel(e));
    if (vw.pinch && vw.pts.size >= 2) {
      const [a, b] = [...vw.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ns = Math.min(8, Math.max(1, vw.pinch.s * d / vw.pinch.d));
      const p = { x: (vw.pinch.m.x - vw.pinch.x) / vw.pinch.s, y: (vw.pinch.m.y - vw.pinch.y) / vw.pinch.s };
      vw.s = ns; vw.x = m.x - p.x * ns; vw.y = m.y - p.y * ns; vwApply();
    } else if (vw.pan) {
      const p = rel(e);
      if (Math.abs(p.x - vw.pan.sx) + Math.abs(p.y - vw.pan.sy) > 6) vw.pan.moved = true;
      vw.x = vw.pan.x + p.x - vw.pan.sx; vw.y = vw.pan.y + p.y - vw.pan.sy; vwApply();
    }
  });
  const vwUp = (e) => {
    const wasPan = vw.pan && !vw.pan.moved && vw.pts.size === 1 && !vw.pinch;
    vw.pts.delete(e.pointerId);
    if (vw.pts.size < 2) vw.pinch = null;
    if (vw.pts.size === 1) { const p = [...vw.pts.values()][0]; vw.pan = { sx: p.x, sy: p.y, x: vw.x, y: vw.y, moved: true }; }
    if (vw.pts.size === 0) {
      vw.pan = null;
      if (wasPan) { // a tap: double-tap toggles zoom at that point
        const now = Date.now(), p = rel(e);
        if (now - vw.lastTap < 320) { vwZoomAt(p.x, p.y, vw.s > 1.05 ? 1 : 3); vw.lastTap = 0; }
        else vw.lastTap = now;
      }
    }
  };
  stage.addEventListener('pointerup', vwUp);
  stage.addEventListener('pointercancel', vwUp);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const p = rel(e); vwZoomAt(p.x, p.y, Math.min(8, Math.max(1, vw.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); }, { passive: false });
  window.addEventListener('resize', () => { if (!$('viewer').hidden) vwApply(); });

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
    if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; }
    const blob = (await getBlob(id + '_p')) || (await getBlob(id));
    if (blob) detailUrl = URL.createObjectURL(blob);
    $('detailImg').src = detailUrl || item.thumb;
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
      ['fNote', item.note ? esc(item.note).replace(/\n/g, '<br>') : `<span class="muted">${esc(t('noNote'))}</span>`],
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
    $('detailFoot').hidden = !canAct;
    $('detailRetry').hidden = !(item.status === 'error' || (item.status === 'queued' && navigator.onLine));
    openSheet('detailSheet');
  }
  $('detailImg').closest('.detail-img').addEventListener('click', async () => {
    const orig = detailId ? await getBlob(detailId) : null; // still on the phone = full resolution
    if (orig) { const u = URL.createObjectURL(orig); openViewer(u, u); }
    else openViewer($('detailImg').src);
  });
  // review sheet: tap a just-taken photo to check it full size before saving
  $('reviewStrip').addEventListener('click', (e) => { const im = e.target.closest('img'); if (im) openViewer(im.src); });
  $('recentGrid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) openDetail(tile.dataset.id);
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

  window.addEventListener('online', () => { render(); processQueue(); });
  window.addEventListener('offline', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { setAppHeight(); maybeAskNewDay(); if (state.password) gpsStart(); processQueue(); checkForUpdate(false); maybeReload(); } });

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
    if (!needsOnboard()) { refreshFolders(false); processQueue(); }
    if (!state.onboardMode) { maybeShowWhatsNew(); maybeAskNewDay(); gpsStart(); }
    setupServiceWorker();
    hideSplash();
    setAppHeight(); nudgeViewport();
  })();
})();
