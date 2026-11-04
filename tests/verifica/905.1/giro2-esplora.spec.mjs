// Verifica #905.1 giro 2: esplorazione dei segreti del proxy e di Safe Browsing, sul disco e nell'archivio.

import { test, expect, aspettaFinestra, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const { readExportZip } = require('../../../src/main/services/exportData.js');

const PW = 'pass word segreta 42';
const PROXY = `  mario:${PW}@gate.esempio.com:8080  `;
const TOKEN = 'tokenSolo-abcdef123456';
const PROXY_RES = `${TOKEN}@res.esempio.com:9000`;
const SAFE = 'AIzaSyD-chiave-safe-browsing-verifica';

const avvia = (userData) => electron.launch({
  args: [...argomentiScala, '.'], cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});

async function apriSicurezza(app) {
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  const page = await aspettaFinestra(app, (w) => { try { return new URL(w.url()).hostname === 'security'; } catch (_) { return false; } }, 'Sicurezza non aperta');
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const testoArchivio = (buf) => { const r = readExportZip(buf); return JSON.stringify(r.data) + (r.filo ? r.filo.toString('utf8') : ''); };

test('portachiavi vero: segreti cifrati, tornano al riavvio, export senza spunta senza password', async () => {
  const userData = cartellaTemporanea('filo-v905-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light' } }), 'utf8');
  const zip1 = join(userData, 'a.zip');
  let app = await avvia(userData);
  try {
    await primaFinestra(app);
    const enc = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
    console.log('isEncryptionAvailable', enc);
    const page = await apriSicurezza(app);
    await expect(page.locator('#sec-export-keys-row')).toBeHidden();
    await page.evaluate(async (s) => {
      await chrome.runtime.sendMessage({ type: 'update_settings', settings: { proxy: { datacenter: s.p, residential: s.r }, security: { safeBrowse: { enabled: true, safeBrowsingKey: s.k } } } });
    }, { p: PROXY, r: PROXY_RES, k: SAFE });
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    await expect(page.locator('#sec-export-keys-row'), 'la casella compare senza ricaricare').toBeVisible();
    const disco = readFileSync(join(userData, 'storage.json'), 'utf8');
    const bak = existsSync(join(userData, 'storage.json.bak')) ? readFileSync(join(userData, 'storage.json.bak'), 'utf8') : '';
    if (enc) for (const s of [PW, TOKEN, SAFE]) { expect(disco.includes(s), `disco: ${s}`).toBe(false); expect(bak.includes(s), `bak: ${s}`).toBe(false); }
    await app.close();

    app = await avvia(userData);
    await primaFinestra(app);
    const s = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
    expect(s.proxy.datacenter.trim()).toBe(PROXY.trim());
    expect(s.proxy.residential).toBe(PROXY_RES);
    expect(s.security.safeBrowse.safeBrowsingKey).toBe(SAFE);
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, zip1);
    const p2 = await apriSicurezza(app);
    await expect(p2.locator('#sec-export-keys-row')).toBeVisible();
    await p2.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(zip1), { timeout: 8000 }).toBe(true);
    const t = testoArchivio(readFileSync(zip1));
    for (const x of [PW, TOKEN, SAFE, encodeURIComponent(PW)]) expect(t.includes(x), `archivio: ${x}`).toBe(false);
    const d = readExportZip(readFileSync(zip1)).data;
    expect(d.settings.proxy.datacenter).toBe('gate.esempio.com:8080');
    expect(d.settings.proxy.residential).toBe('res.esempio.com:9000');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('portachiavi finto: password con spazi e solo utente non restano in chiaro', async () => {
  const userData = cartellaTemporanea('filo-v905c-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light' } }), 'utf8');
  const app = await avvia(userData);
  try {
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (s) => Buffer.from(String(s).split('').reverse().join(''), 'utf8');
      safeStorage.decryptString = (b) => Buffer.from(b).toString('utf8').split('').reverse().join('');
    });
    const page = await apriSicurezza(app);
    await page.evaluate(async (s) => {
      await chrome.runtime.sendMessage({ type: 'update_settings', settings: { proxy: { datacenter: s.p, residential: s.r } } });
    }, { p: PROXY, r: PROXY_RES });
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    const disco = readFileSync(join(userData, 'storage.json'), 'utf8');
    for (const s of [PW, TOKEN, encodeURIComponent(PW)]) expect(disco.includes(s), `disco: ${s}`).toBe(false);
    expect(await app.evaluate(() => globalThis.__filoStorage.statoDisco().avvisi.filter((a) => a.chiave === 'chiavi-in-chiaro').length)).toBe(0);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('senza portachiavi: solo la password del proxy, l\'avviso parte', async () => {
  const userData = cartellaTemporanea('filo-v905b-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light' } }), 'utf8');
  const app = await avvia(userData);
  try {
    await app.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false; });
    await primaFinestra(app);
    await app.evaluate(async (_e, p) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: p } });
      await globalThis.__filoStorage.whenSettled();
    }, PROXY);
    await expect.poll(() => app.evaluate(() => globalThis.__filoStorage.statoDisco().avvisi.filter((a) => a.chiave === 'chiavi-in-chiaro').length), { timeout: 8000 }).toBe(1);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
