/*
 * SpinDecide - client-side picker wheel.
 *
 * Loaded as a classic deferred script (no build step). The page's Content
 * Security Policy forbids inline scripts, inline event handlers, and inline
 * style attributes, so:
 *   - UI wiring uses data-action / data-change / data-input attributes plus
 *     delegated listeners (see "Event wiring").
 *   - Dynamic styles are applied through the CSSOM (element.style), never via
 *     style="" in HTML strings.
 *   - Every untrusted string that reaches innerHTML goes through escapeHtml().
 */
'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEYS = Object.freeze({
    session: 'spinDecide_activeSession',
    files: 'spinDecideFiles',
    darkMode: 'spinDecide_darkMode',
});

const LIMITS = Object.freeze({
    items: 1000,          // entries per list
    text: 200,            // characters per entry text / label
    listName: 100,
    bannerText: 60,
    history: 500,         // grand-winner records kept
    undo: 30,             // undo snapshots kept in memory
    importBytes: 5 * 1024 * 1024,
    shareDecodedBytes: 1024 * 1024,
    shareWarnUrlLength: 8000,
    wheelLabelNames: 20,  // names read out in the canvas aria-label
});

const themes = Object.freeze({
    default: ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557'],
    violet: ['#5851DB', '#41F27C', '#F4B400', '#219EBC', '#F36A1D', '#C14589', '#1A1536', '#FCFAF5'],
    mono: ['#f8f9fa', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#6c757d', '#495057', '#343a40', '#212529'],
    pastel: ['#cdb4db', '#ffc8dd', '#ffafcc', '#bde0fe', '#a2d2ff'],
    neon: ['#ff00ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'],
    forest: ['#283618', '#606c38', '#fefae0', '#dda15e', '#bc6c25'],
    ocean: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#ade8f4', '#caf0f8'],
});

const DEFAULT_SETTINGS = Object.freeze({
    theme: 'default',
    spinDuration: 10,
    spinsToWin: 1,
    eliminateWinners: false,
    confettiOn: true,
    soundOn: true,
    buttonColor: '#334155',
    bannerType: 'image',
    bannerText: '',
    bannerUrl: '',
    logoUrl: '',
    randomInitialAngle: true,
    initialSpinning: true,
    storageMethod: 'local',
    wheelFontSize: 36,
});

const BOOLEAN_SETTINGS = ['eliminateWinners', 'confettiOn', 'soundOn', 'randomInitialAngle', 'initialSpinning'];
const ICON_TYPES = ['none', 'lucide', 'image'];
const CANVAS_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
const REDUCED_MOTION_MAX_SPIN_SECONDS = 2;
const SHARE_HASH_KEY = 'list';

// ---------------------------------------------------------------------------
// Sanitizing & validation helpers
// ---------------------------------------------------------------------------

/** Escape untrusted text before it is interpolated into an HTML string. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Only #rgb / #rrggbb colors are allowed into styles, attributes, and the canvas. */
function safeColor(value, fallback = '#94a3b8') {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value)) ? String(value) : fallback;
}

/** Image URLs must be https: or data:image/ - matches the CSP img-src. Returns '' otherwise. */
function safeImageUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(url)) return url;
    try {
        return new URL(url).protocol === 'https:' ? url : '';
    } catch {
        return '';
    }
}

function clampString(value, maxLength) {
    return String(value ?? '').slice(0, maxLength);
}

function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizeWeight(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

function normalizeSettings(input) {
    const s = input && typeof input === 'object' ? input : {};
    const out = { ...DEFAULT_SETTINGS };
    out.theme = Object.prototype.hasOwnProperty.call(themes, s.theme) ? s.theme : 'default';
    out.spinDuration = clampInt(s.spinDuration, 1, 30, DEFAULT_SETTINGS.spinDuration);
    out.spinsToWin = clampInt(s.spinsToWin, 1, 100, DEFAULT_SETTINGS.spinsToWin);
    out.wheelFontSize = clampInt(s.wheelFontSize, 10, 60, DEFAULT_SETTINGS.wheelFontSize);
    BOOLEAN_SETTINGS.forEach(key => {
        out[key] = typeof s[key] === 'boolean' ? s[key] : DEFAULT_SETTINGS[key];
    });
    out.buttonColor = safeColor(s.buttonColor, DEFAULT_SETTINGS.buttonColor);
    out.bannerType = s.bannerType === 'text' ? 'text' : 'image';
    out.bannerText = clampString(s.bannerText, LIMITS.bannerText);
    out.bannerUrl = safeImageUrl(s.bannerUrl);
    out.logoUrl = safeImageUrl(s.logoUrl);
    out.storageMethod = ['local', 'file', 'both'].includes(s.storageMethod) ? s.storageMethod : 'local';
    return out;
}

function normalizeItem(item) {
    if (!item || typeof item !== 'object') return null;
    const iconType = ICON_TYPES.includes(item.iconType) ? item.iconType : 'none';
    let iconValue = '';
    if (iconType === 'lucide' && /^[a-z0-9-]{1,64}$/.test(String(item.iconValue))) iconValue = String(item.iconValue);
    if (iconType === 'image') iconValue = safeImageUrl(item.iconValue);
    const score = Math.floor(Number(item.score));
    return {
        text: clampString(item.text, LIMITS.text),
        label: clampString(item.label, LIMITS.text),
        color: safeColor(item.color),
        score: Number.isFinite(score) && score > 0 ? score : 0,
        weight: normalizeWeight(item.weight),
        enabled: item.enabled !== false,
        eliminated: item.eliminated === true,
        iconType,
        iconValue,
    };
}

function normalizeHistoryRecord(record) {
    if (!record || typeof record !== 'object') return null;
    return {
        date: clampString(record.date, 64),
        winner: clampString(record.winner, LIMITS.text),
        listName: clampString(record.listName, LIMITS.listName),
    };
}

/**
 * Validate and normalize app data from localStorage, an imported file, or a
 * share link. Throws if the overall shape is wrong; repairs individual fields.
 */
function normalizeAppData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !data.settings || typeof data.settings !== 'object') {
        throw new Error('Invalid SpinDecide data');
    }
    return {
        currentListName: clampString(data.currentListName ?? 'Default List', LIMITS.listName) || 'Untitled List',
        settings: normalizeSettings(data.settings),
        items: data.items.slice(0, LIMITS.items).map(normalizeItem).filter(Boolean),
        history: (Array.isArray(data.history) ? data.history : []).slice(0, LIMITS.history).map(normalizeHistoryRecord).filter(Boolean),
    };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function createDefaultAppData() {
    return {
        currentListName: 'Default List',
        settings: { ...DEFAULT_SETTINGS },
        items: themes.default.map((color, i) => ({
            text: `Option ${i + 1}`, label: '', color, score: 0, weight: 1,
            enabled: true, eliminated: false, iconType: 'none', iconValue: '',
        })),
        history: [],
    };
}

let appData = createDefaultAppData();
let savedFiles = {};
let colorIndex = appData.items.length % themes.default.length;

let showWeightColumn = false;
let showLabelColumn = false;
let showIconColumn = false;
let showInputColumn = true;
let isDarkMode = false;

let allLucideIcons = [];
let iconPickerTargetIndex = -1;
const imageCache = {};

const undoStack = [];
let storageWarningShown = false;

// Canvas & spin state
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
let wheelSize = 0;
let currentAngle = 0;
let isSpinning = false;
let spinStartAngle = 0;
let spinTargetAngle = 0;
let spinStartTime = 0;
let spinDurationMs = 0;
let lastTickAngle = 0;
let currentWinningIndex = -1;

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const prefersReducedMotion = () => reducedMotionQuery.matches;

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// Randomness (cryptographically strong, so outcomes are defensible)
// ---------------------------------------------------------------------------

/** Uniform float in [0, 1). */
function randomFloat() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
}

/** Uniform integer in [0, maxExclusive), without modulo bias. */
function randomInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    const limit = Math.floor(4294967296 / maxExclusive) * maxExclusive;
    const buf = new Uint32Array(1);
    do {
        crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % maxExclusive;
}

// ---------------------------------------------------------------------------
// Storage (every write is guarded; a full quota is surfaced to the user)
// ---------------------------------------------------------------------------

function isQuotaError(err) {
    return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
}

function safeGetItem(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        storageWarningShown = false;
        return true;
    } catch (err) {
        console.error(`Could not write "${key}" to localStorage`, err);
        if (!storageWarningShown) {
            storageWarningShown = true;
            showToast(isQuotaError(err)
                ? 'Browser storage is full, so changes are not being saved. Export a backup (Settings → Data Storage → File, then File → Save Data) and delete old saved lists.'
                : 'Browser storage is unavailable (private window or blocked site data), so changes are not being saved. Export a backup to keep your data.',
                { tone: 'warn', timeout: 15000 });
        }
        return false;
    }
}

function autoSave() {
    safeSetItem(STORAGE_KEYS.session, JSON.stringify(appData));
}

// ---------------------------------------------------------------------------
// Announcements & toasts
// ---------------------------------------------------------------------------

function announce(message) {
    const region = $('liveRegion');
    if (!region) return;
    region.textContent = '';
    // Clear then set on the next frame so repeated messages are re-announced.
    requestAnimationFrame(() => { region.textContent = message; });
}

function showToast(message, { undo: offerUndo = false, tone = 'info', timeout = 6000 } = {}) {
    const container = $('toastContainer');
    if (!container) return;
    while (container.children.length >= 3) container.firstElementChild.remove();

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto w-full flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-medium border ${
        tone === 'warn'
            ? 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/90 dark:text-amber-50 dark:border-amber-700'
            : 'bg-slate-900 text-white border-slate-700 dark:bg-white dark:text-slate-900 dark:border-slate-200'}`;

    const text = document.createElement('span');
    text.className = 'flex-1';
    text.textContent = message;
    toast.appendChild(text);

    if (offerUndo) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'font-bold underline underline-offset-2 hover:opacity-80';
        btn.textContent = 'Undo';
        btn.addEventListener('click', () => { toast.remove(); undo(); });
        toast.appendChild(btn);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'opacity-60 hover:opacity-100';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '✕';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(close);

    container.appendChild(toast);
    announce(message);
    setTimeout(() => toast.remove(), timeout);
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** Record the current state before a change the user may want to reverse. */
function snapshot(label) {
    undoStack.push({ label, state: JSON.stringify(appData), colorIndex });
    if (undoStack.length > LIMITS.undo) undoStack.shift();
    updateUndoButton();
}

function undo() {
    if (isSpinning) return;
    const entry = undoStack.pop();
    if (!entry) return;
    try {
        appData = normalizeAppData(JSON.parse(entry.state));
    } catch (err) {
        console.error('Undo snapshot was invalid', err);
        updateUndoButton();
        return;
    }
    colorIndex = entry.colorIndex;
    currentWinningIndex = -1;
    applyBranding();
    updateUI();
    updateUndoButton();
    showToast(`Undid ${entry.label}.`);
}

function updateUndoButton() {
    const btn = $('undoBtn');
    if (!btn) return;
    const last = undoStack[undoStack.length - 1];
    btn.disabled = !last;
    const label = last ? `Undo ${last.label}` : 'Undo';
    btn.setAttribute('aria-label', label);
    btn.title = `${label} (Ctrl+Z)`;
}

// ---------------------------------------------------------------------------
// Modals (focus trap, Escape to close, focus restore)
// ---------------------------------------------------------------------------

const modalStack = [];
const modalHideTimers = new WeakMap();

function focusableIn(root) {
    return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.classList.contains('hidden') && el.offsetParent !== null);
}

function openModal(overlay, box, { initialFocus = null, onEscape = null } = {}) {
    clearTimeout(modalHideTimers.get(overlay));
    const existing = modalStack.findIndex(m => m.overlay === overlay);
    if (existing !== -1) modalStack.splice(existing, 1);
    modalStack.push({ overlay, box, onEscape, returnFocus: document.activeElement });

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        box.classList.remove('scale-95');
        box.classList.add('scale-100');
    });
    setTimeout(() => {
        const target = initialFocus || focusableIn(box)[0] || box;
        if (target === box) box.setAttribute('tabindex', '-1');
        target.focus();
    }, 50);
}

function closeModal(overlay) {
    const index = modalStack.findIndex(m => m.overlay === overlay);
    if (index === -1) return;
    const [modal] = modalStack.splice(index, 1);
    overlay.classList.add('opacity-0');
    modal.box.classList.remove('scale-100');
    modal.box.classList.add('scale-95');
    modalHideTimers.set(overlay, setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }, 200));
    if (modal.returnFocus && document.contains(modal.returnFocus) && typeof modal.returnFocus.focus === 'function') {
        modal.returnFocus.focus();
    }
}

function handleModalKeydown(e) {
    const top = modalStack[modalStack.length - 1];
    if (!top) return false;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (top.onEscape) top.onEscape();
        return true;
    }
    if (e.key === 'Tab') {
        const items = focusableIn(top.box);
        if (items.length === 0) { e.preventDefault(); return true; }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !top.box.contains(document.activeElement))) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !top.box.contains(document.activeElement))) {
            e.preventDefault(); first.focus();
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
    if (safeGetItem(STORAGE_KEYS.darkMode) === 'true') {
        document.documentElement.classList.add('dark');
    }
    applyDarkModeIcons();

    if (window.lucide && window.lucide.icons) {
        allLucideIcons = Object.keys(window.lucide.icons)
            .map(name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
    }

    loadFiles();
    applyBranding();
    updateUI();
    updateUndoButton();
    wireEvents();

    const container = $('wheelContainer');
    if (window.ResizeObserver) {
        new ResizeObserver(() => resizeCanvas()).observe(container);
    } else {
        window.addEventListener('resize', resizeCanvas);
    }
    resizeCanvas();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawWheel);

    requestAnimationFrame(animationLoop);

    await maybeOpenSharedListFromHash();
    window.addEventListener('hashchange', maybeOpenSharedListFromHash);
}

function resizeCanvas() {
    const container = $('wheelContainer');
    const wrapper = $('wheelWrapper');
    const size = Math.max(200, Math.floor(Math.min(container.clientWidth, container.clientHeight) - 40));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    wrapper.style.width = `${size}px`;
    wrapper.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wheelSize = size;
    drawWheel();
}

// ---------------------------------------------------------------------------
// Event wiring (delegated; no inline handlers - required by the CSP)
// ---------------------------------------------------------------------------

const indexOf = el => Number.parseInt(el.dataset.index, 10);

const clickActions = {
    toggleFileMenu: () => toggleFileMenu(),
    createNewList: () => { closeFileMenu(); createNewList(); },
    saveData: () => { closeFileMenu(); saveData(); },
    openImport: () => { closeFileMenu(); $('importFileInput').click(); },
    copyShareLink: () => { closeFileMenu(); copyShareLink(); },
    openSettings: () => openSettings(),
    closeSettings: () => closeSettings(),
    saveSettings: () => saveSettings(),
    toggleDarkMode: () => toggleDarkMode(),
    togglePresenter: () => togglePresenter(),
    undo: () => undo(),
    spin: () => spin(),
    shuffleItems: () => shuffleItems(),
    clearAll: () => clearAll(),
    switchTab: el => switchTab(el.dataset.tab),
    addEntry: () => addEntry(),
    resetScores: () => resetScores(),
    clearHistory: () => clearHistory(),
    closeIconPicker: () => closeIconPicker(),
    closeWinner: () => closeWinner(),
    removeWinner: () => removeWinner(),
    toggleItemEnabled: el => toggleItemEnabled(indexOf(el)),
    removeItem: el => removeItem(indexOf(el)),
    openIconPicker: el => openIconPicker(indexOf(el)),
};

const changeActions = {
    importFromFile: (el, e) => importFromFile(e),
    updateListName: el => updateListName(el.value),
    toggleWeightCol: el => toggleWeightCol(el.checked),
    toggleIconCol: el => { showIconColumn = el.checked; renderEntries(); },
    toggleLabelCol: el => { showLabelColumn = el.checked; renderEntries(); },
    toggleInputCol: el => { showInputColumn = el.checked; renderEntries(); },
    toggleBannerInputs: () => toggleBannerInputs(),
    updateColor: el => updateItem(indexOf(el), { color: safeColor(el.value) }),
    updateText: el => updateItem(indexOf(el), { text: clampString(el.value, LIMITS.text) }),
    updateLabel: el => updateItem(indexOf(el), { label: clampString(el.value, LIMITS.text) }),
    updateWeight: el => updateItem(indexOf(el), { weight: normalizeWeight(el.value) }),
    updateIconType: el => updateItem(indexOf(el), { iconType: ICON_TYPES.includes(el.value) ? el.value : 'none', iconValue: '' }),
    updateIconValue: el => {
        const url = safeImageUrl(el.value);
        if (el.value.trim() && !url) showToast('Icon image URLs must start with https://', { tone: 'warn' });
        updateItem(indexOf(el), { iconValue: url });
    },
};

const inputActions = {
    renderIconGrid: el => renderIconGrid(el.value),
    mirrorValue: el => { $(el.dataset.target).textContent = el.value; },
};

function wireEvents() {
    document.addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        if (el && !el.disabled && clickActions[el.dataset.action]) {
            clickActions[el.dataset.action](el, e);
        }
        // Close the File menu when clicking outside it.
        const menu = $('fileMenuContainer');
        if (menu && !menu.contains(e.target)) closeFileMenu();
    });
    document.addEventListener('change', e => {
        const el = e.target.closest('[data-change]');
        if (el && changeActions[el.dataset.change]) changeActions[el.dataset.change](el, e);
    });
    document.addEventListener('input', e => {
        const el = e.target.closest('[data-input]');
        if (el && inputActions[el.dataset.input]) inputActions[el.dataset.input](el, e);
    });

    $('newItemInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addEntry(); }
    });

    // Arrow-key navigation between tabs (WAI-ARIA tabs pattern).
    document.querySelector('[role="tablist"]').addEventListener('keydown', e => {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const current = tabs.indexOf(document.activeElement);
        if (current === -1) return;
        let next = null;
        if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
        if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        switchTab(tabs[next].dataset.tab);
        tabs[next].focus();
    });

    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && document.body.classList.contains('presenter')) togglePresenter(false);
    });
    reducedMotionQuery.addEventListener?.('change', drawWheel);
}

function isTypingTarget(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function handleGlobalKeydown(e) {
    if (handleModalKeydown(e)) return;

    if (e.key === 'Escape') {
        if (!$('fileMenuDropdown').classList.contains('hidden')) {
            closeFileMenu();
            $('fileMenuButton').focus();
            return;
        }
        if (document.body.classList.contains('presenter')) {
            togglePresenter(false);
            return;
        }
    }

    if (isTypingTarget(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const onPage = e.target === document.body || e.target === canvas || e.target === document.documentElement;
    if (e.key === ' ' && onPage) {
        e.preventDefault();
        spin();
    } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePresenter();
    }
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function getEnabledItems() { return appData.items.filter(i => i.enabled); }
function getTotalWeight() { return getEnabledItems().reduce((sum, item) => sum + normalizeWeight(item.weight), 0); }
function displayNameOf(item) { return item.label && item.label.trim() !== '' ? item.label : item.text; }
function currentPalette() { return themes[appData.settings.theme] || themes.default; }

function getContrastColor(hexColor) {
    let hex = safeColor(hexColor, '#000000').slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#000000' : '#ffffff';
}

/** Render a Lucide icon to an SVG data URI so it can be drawn on the canvas. */
function getLucideSvgDataUri(iconName, color) {
    if (!window.lucide) return '';
    try {
        const tempDiv = document.createElement('div');
        const i = document.createElement('i');
        i.setAttribute('data-lucide', iconName);
        tempDiv.appendChild(i);
        lucide.createIcons({ root: tempDiv, attrs: { color, stroke: color, 'stroke-width': 2 } });
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tempDiv.innerHTML);
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Audio (created lazily on the first user gesture to satisfy autoplay rules)
// ---------------------------------------------------------------------------

let audioCtx = null;

function getAudio() {
    if (!appData.settings.soundOn) return null;
    try {
        if (!audioCtx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            audioCtx = new Ctor();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    } catch {
        return null;
    }
}

function playTone({ type, from, to = from, volume, duration }) {
    const ac = getAudio();
    if (!ac) return;
    try {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(from, ac.currentTime);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, ac.currentTime + duration);
        gain.gain.setValueAtTime(volume, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + duration);
        osc.start();
        osc.stop(ac.currentTime + duration);
    } catch {
        // Audio is decorative; ignore failures.
    }
}

const playTick = () => playTone({ type: 'triangle', from: 800, to: 100, volume: 0.5, duration: 0.05 });
const playHit = () => playTone({ type: 'sine', from: 400, to: 600, volume: 0.3, duration: 0.1 });
function playWin() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        setTimeout(() => playTone({ type: 'triangle', from: freq, volume: 0.4, duration: 0.5 }), i * 100);
    });
}

// ---------------------------------------------------------------------------
// Wheel drawing
// ---------------------------------------------------------------------------

function drawWheel() {
    if (!wheelSize) return;
    ctx.clearRect(0, 0, wheelSize, wheelSize);

    const center = wheelSize / 2;
    const radius = center - 16;
    const enabledItems = getEnabledItems();

    if (enabledItems.length === 0) {
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isDarkMode ? '#1e293b' : '#f1f5f9';
        ctx.fill();
        ctx.strokeStyle = isDarkMode ? '#334155' : '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = isDarkMode ? '#64748b' : '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold 20px ${CANVAS_FONT}`;
        ctx.fillText('No active items', center, center);
        return;
    }

    const totalWeight = getTotalWeight();
    let startAngle = currentAngle;

    ctx.save();
    ctx.translate(center, center);

    enabledItems.forEach(item => {
        const sliceAngle = (normalizeWeight(item.weight) / totalWeight) * 2 * Math.PI;
        const color = safeColor(item.color);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isDarkMode ? '#0f172a' : '#ffffff';
        ctx.stroke();

        ctx.save();
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const textColor = getContrastColor(color);
        ctx.fillStyle = textColor;

        const maxArcWidth = (radius - 50) * sliceAngle * 0.8;
        let fontSize = Math.max(10, Math.min(appData.settings.wheelFontSize || 36, maxArcWidth));
        let textX = radius - 20;
        const hasIcon = item.iconType !== 'none' && !!item.iconValue;
        // Radial room between the rim and the center peg (55px) for icon + text.
        const radialRoom = () => textX - 62 - (hasIcon ? fontSize * 1.2 + 8 : 0);

        const name = displayNameOf(item);
        let textToDraw = name.length > 25 ? `${name.substring(0, 22)}...` : name;
        ctx.font = `bold ${fontSize}px ${CANVAS_FONT}`;
        // Shrink the font, then truncate, so labels never run under the center button.
        while (fontSize > 10 && ctx.measureText(textToDraw).width > radialRoom()) {
            fontSize -= 1;
            ctx.font = `bold ${fontSize}px ${CANVAS_FONT}`;
        }
        if (ctx.measureText(textToDraw).width > radialRoom()) {
            let cut = textToDraw.replace(/\.\.\.$/, '');
            while (cut.length > 1 && ctx.measureText(`${cut}…`).width > radialRoom()) cut = cut.slice(0, -1);
            textToDraw = `${cut}…`;
        }

        if (hasIcon) {
            const cacheKey = item.iconType === 'lucide' ? `lucide_${item.iconValue}_${textColor}` : `img_${item.iconValue}`;
            if (!imageCache[cacheKey]) {
                const entry = { img: new Image(), loaded: false };
                imageCache[cacheKey] = entry;
                entry.img.onload = () => {
                    entry.loaded = true;
                    if (!isSpinning) drawWheel();
                };
                entry.img.src = item.iconType === 'image' ? item.iconValue : getLucideSvgDataUri(item.iconValue, textColor);
            }
            const cached = imageCache[cacheKey];
            if (cached.loaded) {
                const iconSize = fontSize * 1.2;
                ctx.drawImage(cached.img, textX - iconSize, -iconSize / 2, iconSize, iconSize);
                textX -= iconSize + 8;
            }
        }

        ctx.fillText(textToDraw, textX, 0);
        ctx.restore();
        startAngle += sliceAngle;
    });

    // Outer border (matches the spin button)
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.lineWidth = 14;
    ctx.strokeStyle = appData.settings.buttonColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius - 7, 0, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.strokeStyle = isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.4)';
    ctx.stroke();

    // Center peg base
    ctx.beginPath();
    ctx.arc(0, 0, 55, 0, 2 * Math.PI);
    ctx.fillStyle = isDarkMode ? '#0f172a' : '#ffffff';
    ctx.fill();

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Animation loop & spin logic
// ---------------------------------------------------------------------------

function animationLoop(time) {
    if (isSpinning) {
        const elapsed = time - spinStartTime;
        if (elapsed < spinDurationMs) {
            const t = elapsed / spinDurationMs;
            const ease = 1 - Math.pow(1 - t, 4); // easeOutQuart
            currentAngle = spinStartAngle + (spinTargetAngle - spinStartAngle) * ease;

            const totalItems = getEnabledItems().length;
            if (totalItems > 0 && Math.abs(currentAngle - lastTickAngle) > (Math.PI * 2) / totalItems) {
                playTick();
                lastTickAngle = currentAngle;
            }
            drawWheel();
        } else {
            currentAngle = spinTargetAngle;
            isSpinning = false;
            $('centerSpinBtn').removeAttribute('aria-disabled');
            drawWheel();
            determineWinner();
        }
    } else if (appData.settings.initialSpinning && !prefersReducedMotion()) {
        currentAngle += 0.001;
        drawWheel();
    }
    requestAnimationFrame(animationLoop);
}

function effectiveSpinSeconds() {
    const seconds = appData.settings.spinDuration;
    return prefersReducedMotion() ? Math.min(seconds, REDUCED_MOTION_MAX_SPIN_SECONDS) : seconds;
}

function spin() {
    if (isSpinning || getEnabledItems().length === 0) return;
    getAudio();

    const seconds = effectiveSpinSeconds();
    isSpinning = true;
    $('centerSpinBtn').setAttribute('aria-disabled', 'true');
    spinStartTime = performance.now();
    spinDurationMs = seconds * 1000;
    spinStartAngle = currentAngle;
    lastTickAngle = currentAngle;

    // The final random offset is uniform over a full turn, so each slice wins
    // with probability proportional to its weight.
    const totalRotations = 3 + randomFloat() * 5 + seconds / 2;
    spinTargetAngle = spinStartAngle + totalRotations * Math.PI * 2 + randomFloat() * Math.PI * 2;
}

function determineWinner() {
    const totalWeight = getTotalWeight();
    if (totalWeight === 0) return;

    // The pointer sits at the top (-PI/2, i.e. 1.5 PI). Rotate it back into wheel space.
    const normalizedAngle = currentAngle % (Math.PI * 2);
    let pointerAngle = (Math.PI * 1.5 - normalizedAngle) % (Math.PI * 2);
    if (pointerAngle < 0) pointerAngle += Math.PI * 2;

    let offset = 0;
    for (const item of getEnabledItems()) {
        const sliceAngle = (normalizeWeight(item.weight) / totalWeight) * Math.PI * 2;
        if (pointerAngle >= offset && pointerAngle < offset + sliceAngle) {
            processSpinResult(item);
            return;
        }
        offset += sliceAngle;
    }
}

function processSpinResult(item) {
    snapshot('last spin');
    item.score += 1;

    const name = displayNameOf(item);
    const target = appData.settings.spinsToWin;

    if (item.score >= target) {
        currentWinningIndex = appData.items.indexOf(item);
        appData.history.unshift({ date: new Date().toLocaleString(), winner: name, listName: appData.currentListName });
        if (appData.history.length > LIMITS.history) appData.history.length = LIMITS.history;

        const eliminated = appData.settings.eliminateWinners;
        if (eliminated) {
            item.enabled = false;
            item.eliminated = true;
        }
        updateUI();
        playWin();

        if (appData.settings.confettiOn && typeof window.confetti === 'function') {
            window.confetti({ particleCount: 250, spread: 100, origin: { y: 0.5 }, colors: [safeColor(item.color), '#ffffff', '#FFCA3A'], disableForReducedMotion: true, zIndex: 100 });
        }

        const nameEl = $('winnerName');
        nameEl.textContent = name;
        nameEl.style.color = getContrastColor(item.color) === '#ffffff' ? safeColor(item.color) : '';
        $('winnerEliminatedNote').classList.toggle('hidden', !eliminated);

        openModal($('winnerModal'), $('winnerModalContent'), { initialFocus: $('winnerCloseBtn'), onEscape: closeWinner });
        announce(`Grand winner: ${name}.${eliminated ? ' Eliminated from the wheel.' : ''}`);
        switchTab('scores');
    } else {
        updateUI();
        playHit();
        const overlay = $('hitOverlay');
        const card = $('hitCard');
        $('hitName').textContent = name;
        $('hitScore').textContent = `Score: ${item.score}/${target}`;
        card.style.backgroundColor = safeColor(item.color);
        card.style.color = getContrastColor(item.color);

        overlay.classList.remove('opacity-0', 'scale-95');
        overlay.classList.add('opacity-100', 'scale-100');
        setTimeout(() => {
            overlay.classList.remove('opacity-100', 'scale-100');
            overlay.classList.add('opacity-0', 'scale-95');
        }, 2500);
        announce(`${name}: ${item.score} of ${target}.`);
    }
}

// ---------------------------------------------------------------------------
// UI updaters
// ---------------------------------------------------------------------------

function updateUI() {
    $('listNameInput').value = appData.currentListName;
    $('targetScoreDisplay').textContent = appData.settings.spinsToWin;

    const accent = appData.settings.buttonColor;
    $('centerSpinBtn').style.backgroundColor = accent;
    $('pointerCircle').style.backgroundColor = accent;
    $('pointerTriangle').style.borderTopColor = accent;

    const enabled = getEnabledItems();
    const names = enabled.slice(0, LIMITS.wheelLabelNames).map(displayNameOf).join(', ');
    canvas.setAttribute('aria-label', enabled.length
        ? `Wheel with ${enabled.length} entries: ${names}${enabled.length > LIMITS.wheelLabelNames ? ', and more' : ''}. Click or press Space to spin.`
        : 'Wheel with no active entries');

    renderEntries();
    renderScores();
    renderHistory();
    drawWheel();
    autoSave();
}

function applyBranding() {
    const { bannerType, bannerText, bannerUrl, logoUrl } = appData.settings;
    const bannerBg = $('bannerBg');
    const bannerTextContainer = $('bannerTextContainer');

    if (bannerType === 'text') {
        bannerBg.style.backgroundImage = 'none';
        bannerTextContainer.classList.remove('hidden');
        $('bannerTextDisplay').textContent = bannerText || '';
    } else {
        bannerTextContainer.classList.add('hidden');
        bannerBg.style.backgroundImage = bannerUrl ? `url(${JSON.stringify(bannerUrl)})` : 'none';
    }

    const logoImg = $('logoImg');
    if (logoUrl) {
        logoImg.src = logoUrl;
        logoImg.classList.remove('hidden');
        $('defaultLogo').classList.add('hidden');
    } else {
        logoImg.classList.add('hidden');
        $('defaultLogo').classList.remove('hidden');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => {
        const active = el.dataset.tab === tabName;
        el.setAttribute('aria-selected', String(active));
        el.tabIndex = active ? 0 : -1;
        el.classList.toggle('border-blue-500', active);
        el.classList.toggle('text-blue-600', active);
        el.classList.toggle('dark:text-blue-400', active);
        el.classList.toggle('border-transparent', !active);
        el.classList.toggle('text-slate-500', !active);
        el.classList.toggle('dark:text-slate-400', !active);
    });
    const panel = $(`tab-${tabName}`);
    panel.classList.remove('hidden');
    panel.classList.add('flex');
}

function toggleWeightCol(show) {
    showWeightColumn = show;
    if (!show && appData.items.some(i => i.weight !== 1)) {
        // Hidden weights would silently skew the wheel, so hiding the column resets them.
        snapshot('weight reset');
        appData.items.forEach(i => { i.weight = 1; });
        updateUI();
        showToast('Weights reset to 1.', { undo: true });
    } else {
        renderEntries();
    }
}

// ---------------------------------------------------------------------------
// Entry interactions
// ---------------------------------------------------------------------------

function addEntry() {
    const input = $('newItemInput');
    const text = clampString(input.value.trim(), LIMITS.text);
    if (!text) return;
    if (appData.items.length >= LIMITS.items) {
        showToast(`A list can hold up to ${LIMITS.items} entries.`, { tone: 'warn' });
        return;
    }
    const palette = currentPalette();
    appData.items.push({
        text, label: '', color: palette[colorIndex % palette.length], score: 0, weight: 1,
        enabled: true, eliminated: false, iconType: 'none', iconValue: '',
    });
    colorIndex = (colorIndex + 1) % palette.length;
    input.value = '';
    if (appData.settings.randomInitialAngle && !isSpinning) currentAngle = randomFloat() * Math.PI * 2;
    updateUI();
}

function updateItem(index, changes) {
    const item = appData.items[index];
    if (!item) return;
    Object.assign(item, changes);
    updateUI();
}

function updateListName(value) {
    appData.currentListName = clampString(value.trim(), LIMITS.listName) || 'Untitled List';
    updateUI();
}

function toggleItemEnabled(index) {
    const item = appData.items[index];
    if (!item) return;
    item.enabled = !item.enabled;
    item.eliminated = false;
    updateUI();
}

function removeItem(index) {
    const item = appData.items[index];
    if (!item) return;
    snapshot('delete entry');
    appData.items.splice(index, 1);
    updateUI();
    showToast(`Deleted "${displayNameOf(item) || 'entry'}".`, { undo: true });
}

function shuffleItems() {
    if (appData.items.length < 2) return;
    snapshot('shuffle');
    for (let i = appData.items.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [appData.items[i], appData.items[j]] = [appData.items[j], appData.items[i]];
    }
    updateUI();
}

async function createNewList() {
    const proceed = await showCustomDialog({ type: 'confirm', title: 'Create New List', message: 'Create a new blank list? The current entries, scores, and history will be cleared.' });
    if (!proceed) return;
    snapshot('new list');
    appData.items = [];
    appData.history = [];
    appData.currentListName = 'Untitled List';
    colorIndex = 0;
    currentWinningIndex = -1;
    updateUI();
    showToast('Started a new blank list.', { undo: true });
}

async function clearAll() {
    if (appData.items.length === 0) return;
    const proceed = await showCustomDialog({ type: 'confirm', title: 'Clear All', message: 'Remove all entries and their scores?' });
    if (!proceed) return;
    snapshot('clear all');
    appData.items = [];
    updateUI();
    showToast('Cleared all entries.', { undo: true });
}

async function resetScores() {
    const proceed = await showCustomDialog({ type: 'confirm', title: 'Reset Scores', message: 'Reset all scores to 0 and bring back eliminated entries?' });
    if (!proceed) return;
    snapshot('score reset');
    appData.items.forEach(i => {
        i.score = 0;
        if (i.eliminated) {
            i.enabled = true;
            i.eliminated = false;
        }
    });
    updateUI();
    showToast('Scores reset.', { undo: true });
}

async function clearHistory() {
    if (appData.history.length === 0) return;
    const proceed = await showCustomDialog({ type: 'confirm', title: 'Clear History', message: 'Clear all winning history?' });
    if (!proceed) return;
    snapshot('clear history');
    appData.history = [];
    updateUI();
    showToast('History cleared.', { undo: true });
}

// ---------------------------------------------------------------------------
// File menu
// ---------------------------------------------------------------------------

function toggleFileMenu() {
    const dropdown = $('fileMenuDropdown');
    const open = dropdown.classList.toggle('hidden') === false;
    $('fileMenuButton').setAttribute('aria-expanded', String(open));
    if (open) {
        const first = focusableIn(dropdown)[0];
        if (first) first.focus();
    }
}

function closeFileMenu() {
    const dropdown = $('fileMenuDropdown');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    dropdown.classList.add('hidden');
    $('fileMenuButton').setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------------------
// Icon picker
// ---------------------------------------------------------------------------

function openIconPicker(index) {
    iconPickerTargetIndex = index;
    $('iconSearchInput').value = '';
    renderIconGrid('');
    openModal($('iconPickerModal'), $('iconPickerBox'), { initialFocus: $('iconSearchInput'), onEscape: closeIconPicker });
}

function closeIconPicker() {
    closeModal($('iconPickerModal'));
    iconPickerTargetIndex = -1;
}

function renderIconGrid(query) {
    const grid = $('iconGrid');
    grid.innerHTML = '';
    const q = String(query).toLowerCase().trim();
    const filtered = allLucideIcons.filter(icon => icon.includes(q)).slice(0, 20);

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-4 sm:col-span-5 text-center text-sm text-slate-500 py-8">${allLucideIcons.length ? 'No icons match your search.' : 'Icons failed to load.'}</div>`;
        return;
    }

    filtered.forEach(icon => {
        const label = icon.charAt(0).toUpperCase() + icon.slice(1).replace(/-/g, ' ');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flex flex-col items-center justify-center p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 shadow-sm border border-transparent hover:border-slate-200 dark:hover:border-slate-600 transition-all text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 group';
        btn.setAttribute('aria-label', label);
        btn.addEventListener('click', () => selectIcon(icon));
        // icon names come from the bundled Lucide library (validated [a-z0-9-]); label is escaped anyway.
        btn.innerHTML = `
            <i data-lucide="${escapeHtml(icon)}" class="w-6 h-6 mb-1 opacity-80 group-hover:opacity-100 transition-opacity" aria-hidden="true"></i>
            <span class="text-[9px] truncate w-full text-center opacity-60 group-hover:opacity-100" aria-hidden="true">${escapeHtml(label)}</span>`;
        grid.appendChild(btn);
    });

    if (window.lucide) lucide.createIcons({ root: grid, attrs: { 'stroke-width': 2 } });
}

function selectIcon(iconName) {
    const index = iconPickerTargetIndex;
    closeIconPicker();
    if (appData.items[index]) updateItem(index, { iconType: 'lucide', iconValue: iconName });
}

// ---------------------------------------------------------------------------
// Rendering lists
// ---------------------------------------------------------------------------

function renderEntries() {
    const list = $('entriesList');
    list.innerHTML = '';

    appData.items.forEach((item, index) => {
        const isEnabled = item.enabled !== false;
        const n = index + 1;
        const name = escapeHtml(displayNameOf(item) || `entry ${n}`);
        const dis = isEnabled ? '' : 'disabled';
        const li = document.createElement('li');
        li.className = `flex flex-col gap-2 p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm border ${isEnabled ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800 opacity-60'} transition-all`;

        let html = `
            <div class="flex items-center gap-2">
                <input type="color" value="${safeColor(item.color)}" aria-label="Color for ${name}" class="w-6 h-6 cursor-pointer rounded border-0 p-0 shrink-0" data-change="updateColor" data-index="${index}" ${dis}>
                <div class="flex-1 flex gap-2 min-w-0 items-center">`;

        if (showInputColumn) {
            html += `<input type="text" value="${escapeHtml(item.text)}" maxlength="${LIMITS.text}" placeholder="Entry..." aria-label="Entry ${n} text" class="flex-1 w-full min-w-0 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 outline-none focus:border-blue-500 text-slate-700 dark:text-slate-200 text-sm ${isEnabled ? '' : 'line-through text-slate-400'}" data-change="updateText" data-index="${index}" ${dis}>`;
        }
        if (showLabelColumn) {
            html += `<input type="text" value="${escapeHtml(item.label)}" maxlength="${LIMITS.text}" placeholder="Label / Alias..." aria-label="Entry ${n} label" class="flex-1 w-full min-w-0 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 outline-none focus:border-blue-500 text-slate-700 dark:text-slate-200 text-sm" data-change="updateLabel" data-index="${index}" ${dis}>`;
        }
        if (!showInputColumn && !showLabelColumn) {
            html += '<div class="flex-1 text-sm text-slate-400 italic py-1">Entry hidden</div>';
        }
        if (item.eliminated) {
            html += '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Eliminated</span>';
        }

        html += `
                    <button type="button" data-action="toggleItemEnabled" data-index="${index}" aria-pressed="${isEnabled}" aria-label="${isEnabled ? 'Disable' : 'Enable'} ${name}" title="${isEnabled ? 'Disable' : 'Enable'}" class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${isEnabled ? 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' : 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24'}"></path><line x1="1" y1="1" x2="23" y2="23" class="${isEnabled ? 'hidden' : ''}"></line></svg>
                    </button>
                    <button type="button" data-action="removeItem" data-index="${index}" aria-label="Delete ${name}" title="Delete" class="p-1.5 text-red-400 hover:text-red-600 shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>`;

        if (showWeightColumn) {
            html += `
            <div class="flex items-center gap-2 pl-8 pt-1">
                <span class="text-xs text-slate-500 font-medium uppercase tracking-wider w-14" aria-hidden="true">Weight:</span>
                <input type="number" min="0.1" max="1000" step="0.1" value="${normalizeWeight(item.weight)}" aria-label="Weight for ${name}" class="w-20 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-2 py-0.5 outline-none focus:border-blue-500 text-slate-700 dark:text-slate-200 text-xs" data-change="updateWeight" data-index="${index}" ${dis}>
            </div>`;
        }

        if (showIconColumn) {
            html += `
            <div class="flex items-center gap-2 pl-8 pt-1">
                <span class="text-xs text-slate-500 font-medium uppercase tracking-wider w-14" aria-hidden="true">Icon:</span>
                <select aria-label="Icon type for ${name}" class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-2 py-0.5 outline-none text-xs text-slate-700 dark:text-slate-200 shrink-0" data-change="updateIconType" data-index="${index}" ${dis}>
                    <option value="none" ${item.iconType === 'none' ? 'selected' : ''}>None</option>
                    <option value="lucide" ${item.iconType === 'lucide' ? 'selected' : ''}>Lucide Icon</option>
                    <option value="image" ${item.iconType === 'image' ? 'selected' : ''}>Image URL</option>
                </select>`;
            if (item.iconType === 'lucide') {
                const displayIcon = item.iconValue ? item.iconValue.charAt(0).toUpperCase() + item.iconValue.slice(1).replace(/-/g, ' ') : 'Select icon...';
                html += `
                <button type="button" data-action="openIconPicker" data-index="${index}" aria-label="Choose icon for ${name}" class="flex-1 flex justify-between items-center bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-2 py-0.5 outline-none text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" ${dis}>
                    <span class="truncate">${escapeHtml(displayIcon)}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-50 shrink-0" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                </button>`;
            } else if (item.iconType === 'image') {
                html += `<input type="url" placeholder="https://... (100x100px)" value="${escapeHtml(item.iconValue)}" aria-label="Icon image URL for ${name}" class="flex-1 min-w-[100px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded px-2 py-0.5 outline-none text-xs text-slate-700 dark:text-slate-200" data-change="updateIconValue" data-index="${index}" ${dis}>`;
            }
            html += '</div>';
        }

        li.innerHTML = html;
        list.appendChild(li);
    });

    $('entryCount').textContent = getEnabledItems().length;
}

function renderScores() {
    const list = $('scoresList');
    list.innerHTML = '';
    const target = appData.settings.spinsToWin;

    [...appData.items]
        .sort((a, b) => b.score - a.score)
        .forEach(item => {
            if (item.score === 0 && !item.enabled) return;
            const percent = Math.min(100, (item.score / target) * 100);
            const name = displayNameOf(item);
            const color = safeColor(item.color);

            const li = document.createElement('li');
            li.className = 'bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm';
            li.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <span data-swatch class="w-3 h-3 rounded-full shrink-0" aria-hidden="true"></span>
                        <span class="font-medium text-sm truncate max-w-[150px] sm:max-w-[200px]" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                        ${item.eliminated ? '<span class="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">Eliminated</span>' : ''}
                    </div>
                    <span class="font-bold ${item.score >= target ? 'text-green-500' : 'text-blue-600 dark:text-blue-400'}">${item.score} / ${target}</span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden" role="progressbar" aria-label="${escapeHtml(name)} progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(item.score, target)}">
                    <div data-bar class="h-full rounded-full transition-all duration-500"></div>
                </div>`;
            // Styles via CSSOM: inline style="" attributes are blocked by the CSP.
            li.querySelector('[data-swatch]').style.backgroundColor = color;
            const bar = li.querySelector('[data-bar]');
            bar.style.width = `${percent}%`;
            bar.style.backgroundColor = color;
            list.appendChild(li);
        });
}

function renderHistory() {
    const list = $('historyList');
    list.innerHTML = '';
    if (appData.history.length === 0) {
        list.innerHTML = '<li class="text-sm text-slate-400 italic px-2">No winners yet.</li>';
        return;
    }
    appData.history.forEach(record => {
        const li = document.createElement('li');
        li.className = 'bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col gap-1';
        li.innerHTML = `
            <div class="flex justify-between items-start">
                <span class="font-bold text-lg text-slate-800 dark:text-white break-words min-w-0">${escapeHtml(record.winner)}</span>
                <span class="text-xs text-slate-400 whitespace-nowrap ml-2">${escapeHtml(record.date)}</span>
            </div>
            <div class="text-xs text-slate-500 font-medium">List: ${escapeHtml(record.listName)}</div>`;
        list.appendChild(li);
    });
}

// ---------------------------------------------------------------------------
// Winner modal
// ---------------------------------------------------------------------------

function closeWinner() {
    closeModal($('winnerModal'));
    currentWinningIndex = -1;
}

function removeWinner() {
    const item = appData.items[currentWinningIndex];
    if (!item) return;
    snapshot('remove winner');
    appData.items.splice(currentWinningIndex, 1);
    updateUI();
    closeWinner();
    showToast(`Removed "${displayNameOf(item)}".`, { undo: true });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function openSettings() {
    const s = appData.settings;
    $('setSpinsToWin').value = s.spinsToWin;
    $('setEliminate').checked = s.eliminateWinners;
    $('setWheelFontSize').value = s.wheelFontSize;
    $('fontSizeVal').textContent = s.wheelFontSize;
    $('setDuration').value = s.spinDuration;
    $('durationVal').textContent = s.spinDuration;
    $('setConfetti').checked = s.confettiOn;
    $('setSound').checked = s.soundOn;
    $('setRandomAngle').checked = s.randomInitialAngle;
    $('setInitialSpin').checked = s.initialSpinning;
    $('setBtnColor').value = s.buttonColor;
    $('setBannerType').value = s.bannerType;
    $('setBannerText').value = s.bannerText;
    $('setBannerUrl').value = s.bannerUrl;
    $('setLogoUrl').value = s.logoUrl;
    $('setStorageMethod').value = s.storageMethod;
    toggleBannerInputs();
    renderThemeSelector();

    if (!modalStack.some(m => m.overlay === $('settingsModal'))) {
        openModal($('settingsModal'), $('settingsBox'), { onEscape: closeSettings });
    }
}

function renderThemeSelector() {
    const container = $('themeSelector');
    container.innerHTML = '';
    Object.keys(themes).forEach(key => {
        const selected = appData.settings.theme === key;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(selected));
        btn.className = `flex flex-col gap-1 p-2 border-2 rounded-lg transition-all text-left ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`;
        btn.addEventListener('click', () => changeTheme(key));

        const label = document.createElement('span');
        label.className = 'text-xs font-bold capitalize px-1';
        label.textContent = key;
        const bars = document.createElement('div');
        bars.className = 'flex w-full gap-0.5';
        bars.setAttribute('aria-hidden', 'true');
        themes[key].slice(0, 5).forEach(color => {
            const bar = document.createElement('div');
            bar.className = 'h-6 flex-1 rounded-sm';
            bar.style.backgroundColor = color;
            bars.appendChild(bar);
        });
        btn.append(label, bars);
        container.appendChild(btn);
    });
}

function closeSettings() {
    closeModal($('settingsModal'));
}

async function changeTheme(key) {
    if (appData.settings.theme === key || !themes[key]) return;
    const proceed = await showCustomDialog({ type: 'confirm', title: 'Change Theme', message: 'Changing the theme overwrites the custom colors on your entries. Continue?' });
    if (!proceed) return;
    snapshot('theme change');
    appData.settings.theme = key;
    const palette = themes[key];
    appData.items.forEach((item, i) => { item.color = palette[i % palette.length]; });
    colorIndex = appData.items.length % palette.length;
    updateUI();
    renderThemeSelector();
}

function saveSettings() {
    const rawBannerUrl = $('setBannerUrl').value.trim();
    const rawLogoUrl = $('setLogoUrl').value.trim();

    appData.settings = normalizeSettings({
        ...appData.settings,
        spinsToWin: $('setSpinsToWin').value,
        eliminateWinners: $('setEliminate').checked,
        wheelFontSize: $('setWheelFontSize').value,
        spinDuration: $('setDuration').value,
        confettiOn: $('setConfetti').checked,
        soundOn: $('setSound').checked,
        randomInitialAngle: $('setRandomAngle').checked,
        initialSpinning: $('setInitialSpin').checked,
        buttonColor: $('setBtnColor').value,
        bannerType: $('setBannerType').value,
        bannerText: $('setBannerText').value,
        bannerUrl: rawBannerUrl,
        logoUrl: rawLogoUrl,
        storageMethod: $('setStorageMethod').value,
    });

    if ((rawBannerUrl && !appData.settings.bannerUrl) || (rawLogoUrl && !appData.settings.logoUrl)) {
        showToast('Image URLs must start with https://. The invalid URL was not saved.', { tone: 'warn' });
    }

    applyBranding();
    updateUI();
    closeSettings();
}

function toggleBannerInputs() {
    const isText = $('setBannerType').value === 'text';
    $('bannerImageGroup').classList.toggle('hidden', isText);
    $('bannerTextGroup').classList.toggle('hidden', !isText);
}

// ---------------------------------------------------------------------------
// Persistence: localStorage, JSON export/import, CSV import
// ---------------------------------------------------------------------------

function loadFiles() {
    const storedLists = safeGetItem(STORAGE_KEYS.files);
    if (storedLists) {
        try {
            const parsed = JSON.parse(storedLists);
            savedFiles = {};
            Object.keys(parsed && typeof parsed === 'object' ? parsed : {}).forEach(name => {
                try {
                    savedFiles[name] = normalizeAppData(parsed[name]);
                } catch (err) {
                    console.warn(`Skipping invalid saved list "${name}"`, err);
                }
            });
        } catch (err) {
            console.error('Saved lists in localStorage are corrupt', err);
        }
    }

    const session = safeGetItem(STORAGE_KEYS.session);
    if (session) {
        try {
            appData = normalizeAppData(JSON.parse(session));
        } catch (err) {
            console.error('Saved session in localStorage is corrupt; starting fresh', err);
        }
    }
    colorIndex = appData.items.length % currentPalette().length;
    renderFileList();
}

function persistSavedFiles() {
    return safeSetItem(STORAGE_KEYS.files, JSON.stringify(savedFiles));
}

async function saveData() {
    const method = appData.settings.storageMethod;

    if (method === 'local' || method === 'both') {
        const name = await showCustomDialog({ type: 'prompt', title: 'Save Data', message: 'Enter a name to save this list to browser storage:', defaultValue: appData.currentListName });
        if (name && name.trim()) {
            appData.currentListName = clampString(name.trim(), LIMITS.listName);
            savedFiles[appData.currentListName] = JSON.parse(JSON.stringify(appData));
            const ok = persistSavedFiles();
            renderFileList();
            updateUI();
            if (method === 'local') {
                await showCustomDialog(ok
                    ? { type: 'alert', title: 'Saved', message: `Saved as "${appData.currentListName}" in this browser.` }
                    : { type: 'alert', title: 'Not saved', message: 'Browser storage is full or unavailable. Switch Settings → Data Storage to "File-based" and save a backup file instead.' });
            }
        } else if (method === 'local') {
            return;
        }
    }

    if (method === 'file' || method === 'both') await exportToFile();
}

async function exportToFile() {
    const defaultName = appData.currentListName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'spindecide_data';
    let fileName = await showCustomDialog({ type: 'prompt', title: 'Export to File', message: 'Enter a file name:', defaultValue: defaultName });
    if (!fileName) return;
    fileName = fileName.replace(/[\\/:*?"<>|]+/g, '_').trim() || defaultName;
    if (!fileName.toLowerCase().endsWith('.json')) fileName += '.json';

    // A Blob URL avoids the size limits some browsers put on data: URLs.
    const blob = new Blob([JSON.stringify({ savedFiles, currentData: appData }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function importFromFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > LIMITS.importBytes) {
        showCustomDialog({ type: 'alert', title: 'File too large', message: `Import files must be under ${LIMITS.importBytes / 1024 / 1024} MB.` });
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async e => {
        const content = String(e.target.result || '');
        input.value = ''; // allow re-importing the same file
        if (file.name.toLowerCase().endsWith('.csv')) {
            await handleCSVImport(content);
            return;
        }
        try {
            const imported = JSON.parse(content);
            if (!imported || typeof imported !== 'object' || (!imported.savedFiles && !imported.currentData)) {
                throw new Error('Missing savedFiles/currentData');
            }
            // Validate everything before touching state so a bad file can't half-apply.
            const nextSaved = {};
            Object.keys(imported.savedFiles && typeof imported.savedFiles === 'object' ? imported.savedFiles : {}).forEach(name => {
                nextSaved[clampString(name, LIMITS.listName)] = normalizeAppData(imported.savedFiles[name]);
            });
            const nextData = imported.currentData ? normalizeAppData(imported.currentData) : null;

            snapshot('import');
            if (imported.savedFiles) {
                savedFiles = nextSaved;
                persistSavedFiles();
            }
            if (nextData) appData = nextData;
            colorIndex = appData.items.length % currentPalette().length;
            renderFileList();
            applyBranding();
            updateUI();
            showToast('JSON data imported.', { undo: true });
        } catch (err) {
            console.error('Import failed', err);
            await showCustomDialog({ type: 'alert', title: 'Error', message: 'Invalid file format. Please upload a valid SpinDecide JSON or CSV file.' });
        }
    };
    reader.onerror = () => showCustomDialog({ type: 'alert', title: 'Error', message: 'Could not read that file.' });
    reader.readAsText(file);
}

/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines
 * inside quotes, CRLF/LF line endings, and a UTF-8 BOM.
 */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;

    for (; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else {
                field += c;
            }
        } else if (c === '"' && field.trim() === '') {
            field = '';
            inQuotes = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function isCsvHeaderRow(row) {
    const cells = row.map(c => c.trim().toLowerCase());
    return ['text', 'entry', 'name', 'choice', 'option'].includes(cells[0])
        && cells.slice(1).every(c => ['', 'label', 'alias', 'weight'].includes(c));
}

async function handleCSVImport(csvText) {
    const proceed = await showCustomDialog({
        type: 'confirm',
        title: 'Import CSV',
        message: 'Append the entries from this CSV to your current list?\n\nFormat: Text, Label (optional), Weight (optional). Quote fields that contain commas.',
    });
    if (!proceed) return;

    const rows = parseCsv(csvText);
    if (rows.length && isCsvHeaderRow(rows[0])) rows.shift();

    const palette = currentPalette();
    const room = LIMITS.items - appData.items.length;
    const newItems = [];
    let skippedForLimit = 0;

    rows.forEach(row => {
        const text = clampString((row[0] || '').trim(), LIMITS.text);
        if (!text) return;
        if (newItems.length >= room) { skippedForLimit++; return; }
        newItems.push({
            text,
            label: clampString((row[1] || '').trim(), LIMITS.text),
            weight: normalizeWeight((row[2] || '').trim() || 1),
            color: palette[(colorIndex + newItems.length) % palette.length],
            score: 0, enabled: true, eliminated: false, iconType: 'none', iconValue: '',
        });
    });

    if (newItems.length === 0) {
        await showCustomDialog({ type: 'alert', title: 'Warning', message: skippedForLimit ? `This list is full (${LIMITS.items} entries).` : 'No valid entries found in the CSV file.' });
        return;
    }

    snapshot('CSV import');
    appData.items.push(...newItems);
    colorIndex = (colorIndex + newItems.length) % palette.length;
    if (appData.settings.randomInitialAngle && !isSpinning) currentAngle = randomFloat() * Math.PI * 2;
    updateUI();
    showToast(`Added ${newItems.length} entries to "${appData.currentListName}".${skippedForLimit ? ` ${skippedForLimit} skipped (list limit is ${LIMITS.items}).` : ''}`, { undo: true });
}

function openSavedList(name) {
    if (!savedFiles[name]) return;
    snapshot('open saved list');
    appData = normalizeAppData(JSON.parse(JSON.stringify(savedFiles[name])));
    colorIndex = appData.items.length % currentPalette().length;
    currentWinningIndex = -1;
    applyBranding();
    updateUI();
    showToast(`Opened "${name}".`, { undo: true });
}

async function deleteSavedList(name) {
    const proceed = await showCustomDialog({ type: 'confirm', title: 'Delete Saved List', message: `Delete saved list "${name}"? This can't be undone.` });
    if (!proceed) return;
    delete savedFiles[name];
    persistSavedFiles();
    renderFileList();
}

function renderFileList() {
    const container = $('savedListsContainer');
    if (!container) return;
    container.innerHTML = '';
    const names = Object.keys(savedFiles);
    if (names.length === 0) {
        container.innerHTML = '<div class="px-4 py-2 text-sm text-slate-400 italic">No saved lists</div>';
        return;
    }
    names.forEach(name => {
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors group';
        row.innerHTML = `
            <button type="button" data-role="open" class="flex-1 text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 truncate">${escapeHtml(name)}</button>
            <button type="button" data-role="delete" aria-label="Delete saved list ${escapeHtml(name)}" title="Delete" class="px-3 py-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>`;
        row.querySelector('[data-role="open"]').addEventListener('click', () => { closeFileMenu(); openSavedList(name); });
        row.querySelector('[data-role="delete"]').addEventListener('click', () => { closeFileMenu(); deleteSavedList(name); });
        container.appendChild(row);
    });
}

// ---------------------------------------------------------------------------
// Share links: the list is compressed into the URL fragment (#list=...).
// Fragments are never sent to the server, so sharing needs no backend.
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function readStreamLimited(stream, maxBytes) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error('This share link is too large to open.');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(chunk => { out.set(chunk, offset); offset += chunk.length; });
    return out;
}

/** Encodes as "z" + deflate-raw + base64url when supported, else "j" + base64url JSON. */
async function encodeSharePayload(payload) {
    const json = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream === 'function') {
        const compressed = await readStreamLimited(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw')), Infinity);
        return `z${bytesToBase64Url(compressed)}`;
    }
    return `j${bytesToBase64Url(json)}`;
}

async function decodeSharePayload(encoded) {
    const kind = encoded[0];
    const bytes = base64UrlToBytes(encoded.slice(1));
    let jsonBytes;
    if (kind === 'z') {
        if (typeof DecompressionStream !== 'function') throw new Error('This browser is too old to open compressed share links.');
        jsonBytes = await readStreamLimited(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), LIMITS.shareDecodedBytes);
    } else if (kind === 'j') {
        if (bytes.length > LIMITS.shareDecodedBytes) throw new Error('This share link is too large to open.');
        jsonBytes = bytes;
    } else {
        throw new Error('This share link is not in a recognized format.');
    }
    return JSON.parse(new TextDecoder().decode(jsonBytes));
}

/**
 * Compact share format (v1). Image-URL icons are left out on purpose: they
 * would make every recipient's browser fetch a URL chosen by the sender.
 */
function buildSharePayload() {
    return {
        v: 1,
        n: appData.currentListName,
        s: { t: appData.settings.theme, w: appData.settings.spinsToWin, e: appData.settings.eliminateWinners ? 1 : 0 },
        i: appData.items.map(item => [
            item.text,
            item.label,
            normalizeWeight(item.weight),
            safeColor(item.color),
            item.enabled || item.eliminated ? 1 : 0,
            item.iconType === 'lucide' ? item.iconValue : '',
        ]),
    };
}

function sharePayloadToList(payload) {
    if (!payload || payload.v !== 1 || !Array.isArray(payload.i)) throw new Error('This share link is not in a recognized format.');
    const s = payload.s && typeof payload.s === 'object' ? payload.s : {};
    const data = normalizeAppData({
        currentListName: payload.n,
        settings: { theme: s.t, spinsToWin: s.w, eliminateWinners: s.e === 1 },
        items: payload.i.filter(Array.isArray).map(([text, label, weight, color, enabled, icon]) => ({
            text, label, weight, color, enabled: enabled !== 0, score: 0,
            iconType: icon ? 'lucide' : 'none', iconValue: icon || '',
        })),
        history: [],
    });
    return { name: data.currentListName, items: data.items, settings: data.settings };
}

function shareBaseUrl() {
    return location.href.split('#')[0];
}

async function copyShareLink() {
    if (appData.items.length === 0) {
        showToast('Add some entries before sharing.', { tone: 'warn' });
        return;
    }
    let url;
    try {
        url = `${shareBaseUrl()}#${SHARE_HASH_KEY}=${await encodeSharePayload(buildSharePayload())}`;
    } catch (err) {
        console.error('Could not build share link', err);
        showToast('Could not build a share link in this browser.', { tone: 'warn' });
        return;
    }

    const longWarning = url.length > LIMITS.shareWarnUrlLength ? ' It is very long, so some chat apps may cut it off; for big lists, share a JSON export instead.' : '';
    try {
        await navigator.clipboard.writeText(url);
        showToast(`Share link copied. Anyone with the link can see these ${appData.items.length} entries.${longWarning}`, { timeout: 9000 });
    } catch {
        await showCustomDialog({ type: 'prompt', title: 'Share Link', message: `Copy this link.${longWarning}`, defaultValue: url });
    }
}

async function maybeOpenSharedListFromHash() {
    const match = location.hash.match(new RegExp(`^#${SHARE_HASH_KEY}=([A-Za-z0-9_-]+)$`));
    if (!match) return;
    // Drop the fragment first so a reload doesn't prompt again.
    try {
        history.replaceState(null, '', shareBaseUrl());
    } catch {
        location.hash = '';
    }

    let shared;
    try {
        shared = sharePayloadToList(await decodeSharePayload(match[1]));
    } catch (err) {
        console.error('Invalid share link', err);
        await showCustomDialog({ type: 'alert', title: 'Could not open link', message: err instanceof Error && err.message.startsWith('This ') ? err.message : 'This share link is damaged or incomplete.' });
        return;
    }

    const proceed = await showCustomDialog({
        type: 'confirm',
        title: 'Open shared list?',
        message: `"${shared.name}" with ${shared.items.length} entries.\n\nThis replaces the entries on your wheel. Use Undo to get your current list back; saved lists and history are not affected.`,
    });
    if (!proceed) return;

    snapshot('open shared list');
    appData.currentListName = shared.name;
    appData.items = shared.items;
    appData.settings.theme = shared.settings.theme;
    appData.settings.spinsToWin = shared.settings.spinsToWin;
    appData.settings.eliminateWinners = shared.settings.eliminateWinners;
    colorIndex = appData.items.length % currentPalette().length;
    currentWinningIndex = -1;
    updateUI();
    showToast(`Opened shared list "${shared.name}".`, { undo: true });
}

// ---------------------------------------------------------------------------
// Presenter mode
// ---------------------------------------------------------------------------

function togglePresenter(force) {
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('presenter');
    if (on === document.body.classList.contains('presenter')) return;
    document.body.classList.toggle('presenter', on);
    $('presenterBtn').setAttribute('aria-pressed', String(on));

    if (on && document.fullscreenEnabled && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => { /* still usable without fullscreen */ });
    } else if (!on && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    resizeCanvas();
    if (on) {
        $('presenterExit').focus();
        announce('Presenter mode on. Press Space to spin, P or Escape to exit.');
    } else {
        $('presenterBtn').focus();
        announce('Presenter mode off.');
    }
}

// ---------------------------------------------------------------------------
// Alert / confirm / prompt dialog
// ---------------------------------------------------------------------------

/** Returns: alert → true, confirm → true/null, prompt → string/null. */
function showCustomDialog({ type = 'alert', title = 'Message', message = '', defaultValue = '' } = {}) {
    return new Promise(resolve => {
        const overlay = $('customDialog');
        const box = $('customDialogBox');
        const input = $('customDialogInput');
        const btnCancel = $('customDialogCancel');
        const btnConfirm = $('customDialogConfirm');

        $('customDialogTitle').textContent = title;
        $('customDialogMessage').textContent = message;
        box.setAttribute('role', type === 'prompt' ? 'dialog' : 'alertdialog');
        input.classList.toggle('hidden', type !== 'prompt');
        input.value = type === 'prompt' ? defaultValue : '';
        btnCancel.classList.toggle('hidden', type === 'alert');

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            btnCancel.onclick = null;
            btnConfirm.onclick = null;
            input.onkeydown = null;
            closeModal(overlay);
            resolve(value);
        };
        btnCancel.onclick = () => finish(null);
        btnConfirm.onclick = () => finish(type === 'prompt' ? input.value : true);
        input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); btnConfirm.click(); } };

        openModal(overlay, box, {
            initialFocus: type === 'prompt' ? input : btnConfirm,
            onEscape: () => finish(type === 'alert' ? true : null),
        });
        if (type === 'prompt') setTimeout(() => input.select(), 60);
    });
}

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

function toggleDarkMode() {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    safeSetItem(STORAGE_KEYS.darkMode, String(dark));
    applyDarkModeIcons();
}

function applyDarkModeIcons() {
    isDarkMode = document.documentElement.classList.contains('dark');
    $('moonIcon').classList.toggle('hidden', isDarkMode);
    $('sunIcon').classList.toggle('hidden', !isDarkMode);
    $('darkModeBtn').setAttribute('aria-pressed', String(isDarkMode));
    drawWheel();
}

// ---------------------------------------------------------------------------

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
