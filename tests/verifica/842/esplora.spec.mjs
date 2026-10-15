// Verifica #842 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');
const PREFERENZE = 'filo://preferences/preferences.html';
const EDITOR = 'filo://editor/editor.html';

const chiedi = (app, valore, chiave = 'scorciatoia') => app.evaluate((_e, o) => globalThis.SN_EXECUTE_FILO_ACTION(
  { type: 'IMPOSTA_PREFERENZA', chiave: o.chiave, valore: o.valore }, { sender: null }), { valore, chiave });

function premi(app, keyCode, modifiers = []) {
  return app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
  }, { keyCode, modifiers });
}
const quanteSchede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.length);
const scelte = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).scorciatoie || {});
const tastiDellaRiga = (page, id) => page.locator(`#scorciatoieFilo .sc-riga[data-azione="${id}"] .sc-tasti`);

test('chat: varianti', async ({ app }) => {
  const out = {};
  for (const [v, k] of [['Ctrl+Shift+Y', 'scorciatoia di traduci'], ['traduzione: ctrl maiusc y', 'scorciatoia'], ['Traduci: ', 'scorciatoia'],
    ['Traduci: <img src=x>', 'scorciatoia'], ['Salva per dopo: Alt+Shift+S', 'scorciatoia'], ['Spiega: Alt+T', 'scorciatoia'],
    ['Aiuto: Ctrl+Y', 'scorciatoia'], ['Aiuto: Alt+1', 'scorciatoia'], ['Aiuto: Ctrl+Shift+T', 'scorciatoia']]) {
    const r = await chiedi(app, v, k);
    out[`${k} | ${v}`] = { ok: r.executed, err: r.output && (r.output.error || r.output.label || r.output.message) };
  }
  console.log(JSON.stringify(out, null, 1));
  console.log(JSON.stringify(await scelte(app)));
});

test('scambio e moduli liberati', async ({ app, openTab }) => {
  expect((await chiedi(app, 'Spiega: Alt+Shift+E')).executed).toBe(true);
  const r = await chiedi(app, 'Traduci: Alt+E');
  console.log('traduci su alt+e', JSON.stringify(r.output));
  expect(r.executed).toBe(true);
  // Editor: Alt+T ora libero, Alt+E di Traduci rifiutato.
  const page = await openTab(EDITOR);
  await expect(page.locator('#doc')).toBeVisible();
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Alt+E');
  await page.click('#cfgSave');
  console.log('modulo Alt+E:', await page.locator('#cfgShortcutTaken').isVisible() ? await page.locator('#cfgShortcutTaken').innerText() : 'ACCETTATA');
  await page.fill('#cfgShortcut', 'Alt+T');
  await page.click('#cfgSave');
  console.log('modulo Alt+T:', await page.locator('#cfgShortcutTaken').isVisible().catch(() => false) ? await page.locator('#cfgShortcutTaken').innerText() : 'ACCETTATA');
  await page.locator('.ed-module[data-type="settings"]').click().catch(() => {});
  await page.click('#doc');
  await premi(app, 'T', ['alt']);
  await page.waitForTimeout(600);
  console.log('Alt+T nell editor apre il modulo:', await page.locator('#overlay').isVisible());
  // tutte di serie: Traduci non può tornare ad Alt+T (modulo).
  const s = await chiedi(app, 'tutte di serie');
  console.log('tutte di serie', JSON.stringify(s.output), JSON.stringify(await scelte(app)));
  const pref = await openTab(PREFERENZE);
  await expect(pref.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  console.log('righe', await pref.locator('#scorciatoieFilo').innerText());
  await pref.locator('#scorciatoieRipristina').click();
  await pref.waitForTimeout(500);
  console.log('dopo ripristina', await pref.locator('#scorciatoieFilo').innerText());
  mkdirSync(SHOTS, { recursive: true });
  await pref.locator('#sec-scorciatoie').scrollIntoViewIfNeeded();
  await pref.locator('#sec-scorciatoie').screenshot({ path: join(SHOTS, 'v842-ripristina.png') });
});

test('modulo in un altro documento', async ({ app }) => {
  await app.evaluate(async () => {
    const S = require('./src/main/shim/storage');
  }).catch(() => {});
  const r0 = await app.evaluate(async () => {
    const T = globalThis.SN_TASTI;
    T.usaScorciatoieModuli({ files: [{ meta: { title: '<b>Doc due</b>' }, modules: [{ type: 'word-count', data: { shortcut: 'Ctrl+Shift+K' } }] }] });
    return T.rifiutoScorciatoiaFilo('translate-selection', 'Ctrl+Shift+K');
  });
  console.log('rifiuto modulo altro doc (iniettato in memoria)', JSON.stringify(r0));
});

test('registrazione: tasti della shell e uscite', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await expect(page.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  const n = await quanteSchede(app);
  const url0 = page.url();
  const riga = page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]');
  await tastiDellaRiga(page, 'translate-selection').click();
  const err = riga.locator('.sc-errore');
  for (const [k, m] of [['W', ['control']], ['R', ['control']], ['L', ['control']], ['1', ['alt']], ['Left', ['alt']], ['B', ['control', 'shift']], ['Z', ['control']], ['F5', []], ['Tab', ['control']]]) {
    await premi(app, k, m);
    await page.waitForTimeout(250);
    console.log(m.join('+'), k, '→', (await err.isVisible()) ? await err.innerText() : '(nessun errore)', '| tasti:', await tastiDellaRiga(page, 'translate-selection').innerText());
  }
  console.log('schede', n, await quanteSchede(app), 'url', page.url() === url0);
  // Alt da solo poi rilascio
  await premi(app, 'Alt', ['alt']);
  console.log('alt da solo:', await tastiDellaRiga(page, 'translate-selection').innerText());
  // clic altrove: finisce l'ascolto?
  await page.locator('h1, h2').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const ancora = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return (t.view.webContents._filoRegistraTastiFino || 0) > Date.now();
  });
  console.log('dopo clic altrove main ascolta ancora:', ancora, 'classe', await riga.getAttribute('class'));
  // Ricomincia e ricarica la pagina mentre registra
  await tastiDellaRiga(page, 'translate-selection').click();
  await page.reload();
  await page.waitForTimeout(800);
  const dopoReload = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return (t.view.webContents._filoRegistraTastiFino || 0) > Date.now();
  });
  console.log('dopo ricarica a registrazione aperta main ascolta ancora:', dopoReload);
  const nn = await quanteSchede(app);
  await premi(app, 'T', ['control']);
  await page.waitForTimeout(500);
  console.log('Ctrl+T dopo ricarica apre scheda:', (await quanteSchede(app)) > nn);
});

test('etichette su mac e manifesto', async ({ app, openTab }) => {
  expect((await chiedi(app, 'Aiuto: Alt+Shift+K')).executed).toBe(true);
  const m = await app.evaluate(() => {
    const T = globalThis.SN_TASTI;
    const C = globalThis.SN_CAPABILITIES;
    const v = C && (C.visibili ? C.visibili() : C.list ? C.list() : null);
    const help = Array.isArray(v) ? v.find((c) => c.id === 'help-sidebar') : null;
    return { mac: T.scorciatoieFilo('darwin').map((s) => s.etichetta), help: help && help.invoke, keys: Object.keys(C || {}) };
  });
  console.log(JSON.stringify(m));
  const altro = await openTab('filo://options/altro.html');
  console.log(await altro.locator('#shortcutsList').innerText());
  await altro.locator('#shortcutsList').screenshot({ path: join(SHOTS, 'v842-altro.png') });
});

test('passare da una riga all altra mentre registra', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await expect(page.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  await tastiDellaRiga(page, 'translate-selection').click();
  await expect(page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]')).toHaveClass(/sc-registra/);
  await tastiDellaRiga(page, 'explain-selection').click();
  await page.waitForTimeout(300);
  console.log('classe spiega dopo un clic:', await page.locator('#scorciatoieFilo .sc-riga[data-azione="explain-selection"]').getAttribute('class'));
  console.log('classe traduci:', await page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]').getAttribute('class'));
  await premi(app, 'U', ['control', 'shift']);
  await page.waitForTimeout(400);
  console.log('dopo Ctrl+Shift+U', JSON.stringify(await scelte(app)));
  // ripristina mentre registra
  await tastiDellaRiga(page, 'save-for-later').click();
  await page.locator('#scorciatoieRipristina').click();
  await page.waitForTimeout(400);
  console.log('dopo ripristina a registrazione aperta', JSON.stringify(await scelte(app)), await page.locator('#scorciatoieFilo').innerText());
  // cambio dalla chat mentre registra
  await tastiDellaRiga(page, 'save-for-later').click();
  await chiedi(app, 'Aiuto: Alt+Shift+H');
  await page.waitForTimeout(400);
  console.log('aiuto dalla chat mentre si registra salva', await tastiDellaRiga(page, 'open-help-sidebar').innerText());
  await premi(app, 'Escape');
  await page.waitForTimeout(300);
  console.log('dopo esc aiuto', await tastiDellaRiga(page, 'open-help-sidebar').innerText());
});
