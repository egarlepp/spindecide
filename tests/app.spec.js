// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const XSS = '<img src=x onerror="window.__pwned = (window.__pwned || 0) + 1">';

/** Fast, quiet settings so spins finish quickly in tests. */
const FAST_SETTINGS = { spinDuration: 1, initialSpinning: false, confettiOn: false, soundOn: false, randomInitialAngle: false };

function session(overrides = {}) {
  return {
    currentListName: 'Test List',
    settings: { theme: 'default', spinsToWin: 1, ...FAST_SETTINGS, ...(overrides.settings || {}) },
    items: overrides.items || [
      { text: 'Alpha', label: '', color: '#e63946', score: 0, weight: 1, enabled: true },
      { text: 'Beta', label: '', color: '#457b9d', score: 0, weight: 1, enabled: true },
    ],
    history: overrides.history || [],
  };
}

/**
 * Seeds localStorage once per test (not on reloads), records page errors,
 * CSP violations, and any request that leaves the local server.
 */
async function setup(page, { seed = session(), files = null } = {}) {
  const problems = { errors: [], external: [] };
  page.on('pageerror', err => problems.errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') problems.errors.push(msg.text()); });
  page.on('request', req => {
    const url = new URL(req.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) problems.external.push(req.url());
  });
  await page.addInitScript(([seedData, filesData]) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    if (seedData) localStorage.setItem('spinDecide_activeSession', JSON.stringify(seedData));
    if (filesData) localStorage.setItem('spinDecideFiles', JSON.stringify(filesData));
  }, [seed, files]);
  return problems;
}

async function expectClean(page, problems) {
  expect(problems.errors).toEqual([]);
  expect(problems.external).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(await page.evaluate(() => window.__pwned || 0)).toBe(0);
}

async function spinAndWait(page) {
  await page.locator('#centerSpinBtn').click();
  await expect.poll(() => page.evaluate(() => isSpinning)).toBe(false);
}

test('loads with local assets only, no errors, no CSP violations', async ({ page }) => {
  const problems = await setup(page);
  await page.goto('/');
  await expect(page).toHaveTitle('SpinDecide');
  await expect(page.locator('#entryCount')).toHaveText('2');
  expect(await page.evaluate(() => allLucideIcons.length)).toBeGreaterThan(1000);
  expect(await page.evaluate(() => typeof window.confetti)).toBe('function');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('bold 16px "Inter Variable"'))).toBe(true);
  await expect(page.locator('#wheelCanvas')).toHaveAttribute('aria-label', /Wheel with 2 entries: Alpha, Beta/);
  await expectClean(page, problems);
});

test('default list uses neutral placeholder entries', async ({ page }) => {
  await setup(page, { seed: null });
  await page.goto('/');
  const names = await page.evaluate(() => appData.items.map(i => i.text));
  expect(names).toEqual(['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5']);
});

test('untrusted names from storage and JSON import are rendered as text', async ({ page }) => {
  const evil = session({
    items: [{ text: XSS, label: '', color: '" onmouseover="x', score: 2, weight: 1, enabled: true }],
    history: [{ date: XSS, winner: XSS, listName: XSS }],
  });
  evil.currentListName = XSS;
  const problems = await setup(page, { seed: evil, files: { [`it's ${XSS}`]: evil } });
  await page.goto('/');
  for (const tab of ['scores', 'history', 'entries']) await page.locator(`#btn-${tab}`).click();
  await page.locator('#fileMenuButton').click();
  await expect(page.locator('#savedListsContainer')).toContainText(`it's ${XSS}`);
  await page.locator('#savedListsContainer [data-role="open"]').click();
  expect(await page.evaluate(() => appData.items[0].color)).toBe('#94a3b8');

  const file = path.join(os.tmpdir(), `spindecide-evil-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ currentData: { ...evil, settings: { theme: 'nope', bannerUrl: 'javascript:alert(1)' } } }));
  await page.setInputFiles('#importFileInput', file);
  await expect(page.locator('#toastContainer')).toContainText('JSON data imported');
  expect(await page.evaluate(() => [appData.settings.theme, appData.settings.bannerUrl])).toEqual(['default', '']);
  await expectClean(page, problems);
});

test('invalid JSON import is rejected without changing state', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  const file = path.join(os.tmpdir(), `spindecide-bad-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ foo: 1 }));
  await page.setInputFiles('#importFileInput', file);
  await expect(page.locator('#customDialogMessage')).toContainText('Invalid file format');
  expect(await page.evaluate(() => appData.items.length)).toBe(2);
});

test('CSV parser handles quotes, embedded commas/newlines, BOM, and a header row', async ({ page }) => {
  await setup(page, { seed: session({ items: [] }) });
  await page.goto('/');
  const csv = '﻿Text,Label,Weight\r\n"Smith, John",JS,2\r\n"Say ""hi""",,\r\n"Multi\nline",Two lines,0.5\r\nPlain\r\n';
  const file = path.join(os.tmpdir(), `spindecide-${Date.now()}.csv`);
  fs.writeFileSync(file, csv);
  await page.setInputFiles('#importFileInput', file);
  await page.locator('#customDialogConfirm').click();
  await expect(page.locator('#toastContainer')).toContainText('Added 4 entries');
  const items = await page.evaluate(() => appData.items.map(i => [i.text, i.label, i.weight]));
  expect(items).toEqual([
    ['Smith, John', 'JS', 2],
    ['Say "hi"', '', 1],
    ['Multi\nline', 'Two lines', 0.5],
    ['Plain', '', 1],
  ]);
});

test('export downloads a JSON blob that round-trips', async ({ page }) => {
  await setup(page, { seed: session({ settings: { storageMethod: 'file' } }) });
  await page.goto('/');
  await page.locator('#fileMenuButton').click();
  await page.locator('[data-action="saveData"]').click();
  await page.locator('#customDialogInput').fill('backup');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#customDialogConfirm').click()]);
  expect(download.suggestedFilename()).toBe('backup.json');
  const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(data.currentData.items.map(i => i.text)).toEqual(['Alpha', 'Beta']);
});

test('spin scores an entry, records history, and announces the result', async ({ page }) => {
  const problems = await setup(page);
  await page.goto('/');
  await spinAndWait(page);
  await expect(page.locator('#winnerModal')).toBeVisible();
  await expect(page.locator('#winnerCloseBtn')).toBeFocused();
  const winner = await page.locator('#winnerName').textContent();
  expect(['Alpha', 'Beta']).toContain(winner);
  await expect(page.locator('#liveRegion')).toHaveText(`Grand winner: ${winner}.`);
  expect(await page.evaluate(() => appData.history.length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#winnerModal')).toBeHidden();
  await expectClean(page, problems);
});

test('elimination mode takes the winner off the wheel; reset brings it back', async ({ page }) => {
  await setup(page, { seed: session({ settings: { eliminateWinners: true } }) });
  await page.goto('/');
  await spinAndWait(page);
  await expect(page.locator('#winnerEliminatedNote')).toBeVisible();
  await page.locator('#winnerCloseBtn').click();
  expect(await page.evaluate(() => appData.items.filter(i => i.eliminated && !i.enabled).length)).toBe(1);
  await expect(page.locator('#entryCount')).toHaveText('1');

  await page.locator('#btn-scores').click();
  await page.locator('[data-action="resetScores"]').click();
  await page.locator('#customDialogConfirm').click();
  await expect(page.locator('#entryCount')).toHaveText('2');
  expect(await page.evaluate(() => appData.items.every(i => i.score === 0 && i.enabled && !i.eliminated))).toBe(true);
});

test('undo restores a cleared list via toast, button, and Ctrl+Z', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.locator('[data-action="clearAll"]').click();
  await page.locator('#customDialogConfirm').click();
  await expect(page.locator('#entryCount')).toHaveText('0');
  await page.locator('#toastContainer button', { hasText: 'Undo' }).click();
  await expect(page.locator('#entryCount')).toHaveText('2');

  await page.locator('[data-action="removeItem"]').first().click();
  await expect(page.locator('#entryCount')).toHaveText('1');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#entryCount')).toHaveText('2');

  await spinAndWait(page);
  await page.locator('#winnerCloseBtn').click();
  await expect(page.locator('#undoBtn')).toHaveAttribute('aria-label', 'Undo last spin');
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => [appData.history.length, appData.items.every(i => i.score === 0)])).toEqual([0, true]);
  await expect(page.locator('#undoBtn')).toBeDisabled();
});

test('share link round-trips a list and escapes hostile content', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seed = session();
  seed.items[0].iconType = 'image';
  seed.items[0].iconValue = 'https://tracker.example/pixel.png';
  seed.items.push({ text: XSS, label: 'Gamma', color: '#00ff00', score: 3, weight: 2.5, enabled: false });
  const problems = await setup(page, { seed });
  await page.goto('/');
  await page.locator('#fileMenuButton').click();
  await page.locator('[data-action="copyShareLink"]').click();
  await expect(page.locator('#toastContainer')).toContainText('Share link copied');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#list=z[A-Za-z0-9_-]+$/);

  const page2 = await context.newPage();
  const problems2 = await setup(page2, { seed: session({ items: [] }) });
  await page2.goto(url);
  await expect(page2.locator('#customDialogTitle')).toHaveText('Open shared list?');
  await page2.locator('#customDialogConfirm').click();
  await expect(page2.locator('#entryCount')).toHaveText('2');
  const items = await page2.evaluate(() => appData.items.map(i => [i.text, i.label, i.weight, i.enabled, i.score, i.iconType]));
  expect(items).toEqual([
    ['Alpha', '', 1, true, 0, 'none'],
    ['Beta', '', 1, true, 0, 'none'],
    [XSS, 'Gamma', 2.5, false, 0, 'none'],
  ]);
  expect(await page2.evaluate(() => location.hash)).toBe('');
  await page2.locator('#undoBtn').click();
  await expect(page2.locator('#entryCount')).toHaveText('0');
  // The sender loads its own image icon; the recipient must never fetch it.
  expect(problems.external.every(u => u.startsWith('https://tracker.example/'))).toBe(true);
  expect(await page.evaluate(() => window.__pwned || 0)).toBe(0);
  await expectClean(page2, problems2);
});

test('a corrupt share link shows an error and changes nothing', async ({ page }) => {
  await setup(page);
  await page.goto('/#list=zAAAA');
  await expect(page.locator('#customDialogTitle')).toHaveText('Could not open link');
  expect(await page.evaluate(() => appData.items.length)).toBe(2);
});

test('presenter mode hides chrome, spins with Space, exits with Escape', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.locator('#presenterBtn').click();
  await expect(page.locator('#sidePanel')).toBeHidden();
  await expect(page.locator('#appHeader')).toBeHidden();
  await expect(page.locator('#presenterExit')).toBeVisible();
  await page.locator('#presenterExit').blur();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => isSpinning)).toBe(true);
  await expect.poll(() => page.evaluate(() => isSpinning)).toBe(false);
  await page.keyboard.press('Escape'); // closes the winner modal
  await page.keyboard.press('Escape'); // exits presenter mode
  await expect(page.locator('#sidePanel')).toBeVisible();
});

test('reduced motion caps spin length and disables idle spin', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await setup(page, { seed: session({ settings: { spinDuration: 20, initialSpinning: true } }) });
  await page.goto('/');
  const a1 = await page.evaluate(() => currentAngle);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => currentAngle)).toBe(a1);
  await page.locator('#centerSpinBtn').click();
  expect(await page.evaluate(() => spinDurationMs)).toBe(2000);
  await context.close();
});

test('a full storage quota warns the user instead of failing silently', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.locator('#newItemInput').fill('Gamma');
  await page.locator('[data-action="addEntry"]').click();
  await expect(page.locator('#toastContainer')).toContainText('Browser storage is full');
});

test('modal dialogs trap focus and close on Escape', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  const opener = page.locator('[data-action="openSettings"]');
  await opener.click();
  await expect(page.locator('#settingsBox')).toBeVisible();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('settingsBox').contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#settingsModal')).toBeHidden();
  await expect(opener).toBeFocused();

  // Regression: Escape from the color picker used to drop focus to <body>.
  await opener.click();
  await page.locator('#setBtnColor').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settingsModal')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('weighted spins are fair (statistical smoke test)', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  // Simulate the final resting angle the way spin() does and count winners for weights 1:3.
  const counts = await page.evaluate(() => {
    appData.items = [
      { ...appData.items[0], weight: 1 },
      { ...appData.items[1], weight: 3 },
    ];
    const tally = [0, 0];
    const total = 4;
    for (let n = 0; n < 20000; n++) {
      const angle = (3 + randomFloat() * 5) * Math.PI * 2 + randomFloat() * Math.PI * 2;
      let pointer = (Math.PI * 1.5 - (angle % (Math.PI * 2))) % (Math.PI * 2);
      if (pointer < 0) pointer += Math.PI * 2;
      tally[pointer < (1 / total) * Math.PI * 2 ? 0 : 1]++;
    }
    return tally;
  });
  const share = counts[0] / (counts[0] + counts[1]);
  expect(share).toBeGreaterThan(0.23);
  expect(share).toBeLessThan(0.27);
});
