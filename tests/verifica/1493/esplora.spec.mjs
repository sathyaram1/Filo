import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const LUNGO = 'Un titolo lunghissimo di una pagina che non finisce mai e continua ancora e ancora con altre parole inutili fino a riempire tutta la barra';
const pagina = (t) => `<!doctype html><html><head><title>${t}</title></head><body>x</body></html>`;
const larghezze = (shell) => shell.evaluate(() => [...document.querySelectorAll('.tabs .tab')].map((el) => ({
  w: Math.round(el.getBoundingClientRect().width), attiva: el.classList.contains('active'),
  titolo: el.querySelector('.title')?.textContent || '', tagliato: (() => { const t = el.querySelector('.title'); return t ? t.scrollWidth > t.clientWidth : false; })(),
})));
const azione = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), { type: 'IMPOSTA_ESTETICA', ...a });
const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);

test('una scheda sola col titolo lungo, finestra larga', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.isVisible() || true); w.setSize(1920, 1000); });
  const url = testServer.html(pagina(LUNGO));
  await openTab(url);
  // chiudi le altre
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.list?.();
    return s;
  }).catch(() => null);
  await expect.poll(async () => (await larghezze(shell)).find((t) => t.titolo.startsWith('Un titolo'))?.w ?? 0).toBeGreaterThan(0);
  await shell.waitForTimeout(800);
  const l = await larghezze(shell);
  console.log('una sola', JSON.stringify(l));
  for (const t of l) expect(t.w).toBeLessThanOrEqual(241);
  mkdirSync(SHOTS, { recursive: true });
  await shell.screenshot({ path: join(SHOTS, 'v1493-una-scheda.png'), clip: { x: 0, y: 0, width: 1920, height: 80 } });
});

test('quattro schede lunghe e home, poi tetto 400, 110, chat e ripristino', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1920, 1000); });
  for (let i = 0; i < 4; i++) await openTab(testServer.html(pagina(`${i} ${LUNGO}`)));
  await shell.waitForTimeout(800);
  let l = await larghezze(shell);
  console.log('quattro', JSON.stringify(l));
  for (const t of l) expect(t.w).toBeLessThanOrEqual(241);
  await shell.screenshot({ path: join(SHOTS, 'v1493-quattro.png'), clip: { x: 0, y: 0, width: 1920, height: 80 } });

  await setTokens(shell, { 'tab.larghezza': '400px' });
  await shell.waitForTimeout(800);
  l = await larghezze(shell);
  console.log('400', JSON.stringify(l));
  expect(Math.max(...l.map((t) => t.w))).toBeGreaterThan(300);
  for (const t of l) expect(t.w).toBeLessThanOrEqual(401);

  await setTokens(shell, { 'tab.larghezza': '110px' });
  await shell.waitForTimeout(800);
  l = await larghezze(shell);
  console.log('110', JSON.stringify(l));
  for (const t of l) expect(t.w).toBeLessThanOrEqual(111);
  await shell.screenshot({ path: join(SHOTS, 'v1493-110.png'), clip: { x: 0, y: 0, width: 1920, height: 80 } });

  const r = await azione(app, { token: 'tab.larghezza', valore: 320 }).catch((e) => String(e));
  console.log('chat 320', JSON.stringify(r));
  await shell.waitForTimeout(800);
  l = await larghezze(shell);
  console.log('dopo chat', JSON.stringify(l));
  const r2 = await azione(app, { token: 'tab.larghezza', valore: 'predefinito' }).catch((e) => String(e));
  console.log('chat predefinito', JSON.stringify(r2));
  await shell.waitForTimeout(800);
  l = await larghezze(shell);
  console.log('dopo predefinito', JSON.stringify(l));
  const r3 = await azione(app, { token: 'tab.larghezza', valore: 50 }).catch((e) => String(e));
  console.log('chat 50', JSON.stringify(r3));
  const r4 = await azione(app, { token: 'tab.larghezza', valore: '5000' }).catch((e) => String(e));
  console.log('chat 5000', JSON.stringify(r4));
});

test('preferenze: riga del tetto, cursore, e scheda col titolo lungo in finestra stretta', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1920, 1000); });
  await openTab(testServer.html(pagina(LUNGO)));
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(800);
  const riga = await pref.evaluate(() => {
    const el = document.querySelector('[id="tok-tab.larghezza"]');
    if (!el) return null;
    const box = el.closest('[class*=row], li, div');
    return { tag: el.tagName, type: el.type, value: el.value, testo: box?.innerText?.slice(0, 200) };
  });
  console.log('riga pref', JSON.stringify(riga));
  const html = await pref.evaluate(() => [...document.querySelectorAll('[id^="tok-"]')].map((e) => e.id).filter((x) => /tab/.test(x)));
  console.log('ids', JSON.stringify(html));
  if (riga) {
    const campo = pref.locator('[id="tok-tab.larghezza"]');
    await campo.scrollIntoViewIfNeeded();
    await pref.screenshot({ path: join(SHOTS, 'v1493-pref.png') });
    await campo.fill('180').catch(async () => { await campo.evaluate((e) => { e.value = '180'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }); });
    await campo.press('Enter').catch(() => {});
    await pref.waitForTimeout(1000);
    const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});
    console.log('salvato', JSON.stringify(salvato));
    const l = await larghezze(shell);
    console.log('dopo pref', JSON.stringify(l));
    await pref.screenshot({ path: join(SHOTS, 'v1493-pref-dopo.png') });
    await campo.fill('abc').catch(() => {});
    await campo.press('Enter').catch(() => {});
    await pref.waitForTimeout(500);
    console.log('dopo abc', JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {})));
    await pref.screenshot({ path: join(SHOTS, 'v1493-pref-abc.png') });
  }
});
