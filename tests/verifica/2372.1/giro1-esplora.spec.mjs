// Verifica #2372.1 giro 1: il campo della chat tiene il fuoco dopo clic su punti non vuoti; una lettera ridata non toglie in silenzio.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { home, modelloFinto } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}
const fuoco = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : ''; });

test('a: clic dentro la storia della chat, poi Backspace, Home e Invio arrivano al campo', async ({ app }) => {
  test.setTimeout(90_000);
  const lungo = Array.from({ length: 40 }, (_, i) => `riga ${i} di una risposta lunga`).join('\n\n');
  await modelloFinto(app, [{ text: lungo }, { text: 'Eccomi.' }]);
  const page = await casa(app);
  const campo = page.locator('#input');
  await campo.fill('prima domanda');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'prima domanda' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubbles')).toContainText('riga 39', { timeout: 10_000 });
  const scorre = await page.evaluate(() => { const b = document.querySelector('.dash-bubbles'); return b.scrollHeight > b.clientHeight; });
  console.log('storia che scorre:', scorre);
  await page.keyboard.type('ciao');
  await expect(campo).toHaveValue('ciao');
  const box = await page.locator('.dash-bubbles').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  console.log('fuoco dopo clic nella storia:', await fuoco(page));
  await page.keyboard.press('Backspace');
  await expect(campo).toHaveValue('cia');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Home');
  await page.keyboard.type('x');
  await expect(campo).toHaveValue('xcia');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'xcia' })).toBeVisible({ timeout: 10_000 });
});

test('b: clic sulla colonna delle carte e su una carta di destra, poi Backspace e Ctrl+V', async ({ app }) => {
  const page = await casa(app);
  const campo = page.locator('#input');
  await page.keyboard.type('ciao');
  await expect(campo).toHaveValue('ciao');
  const punti = await page.evaluate(() => {
    const out = [];
    for (const sel of ['.dash-left .dash-carte', '.dash-right', '#altro', '.dash-altro-tit', '.dash-saluto, .dash-greeting, h1']) {
      const n = document.querySelector(sel);
      if (!n) continue;
      const r = n.getBoundingClientRect();
      if (r.width && r.height) out.push({ sel, x: r.x + Math.min(r.width - 2, 6), y: r.y + Math.min(r.height - 2, 6) });
    }
    return out;
  });
  console.log('punti:', JSON.stringify(punti));
  await app.evaluate(({ clipboard }) => clipboard.writeText('Z'));
  let atteso = 'ciao';
  for (const p of punti) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(150);
    console.log(p.sel, '→ fuoco', await fuoco(page));
    await page.keyboard.press('Backspace');
    atteso = atteso.slice(0, -1);
    await expect(campo, `Backspace dopo clic su ${p.sel}`).toHaveValue(atteso);
    await page.keyboard.press('Control+V');
    atteso += 'Z';
    await expect(campo, `Ctrl+V dopo clic su ${p.sel}`).toHaveValue(atteso);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('q');
    atteso = atteso.slice(0, -1) + 'q' + atteso.slice(-1);
    await expect(campo, `freccia dopo clic su ${p.sel}`).toHaveValue(atteso);
    await page.keyboard.press('End');
  }
});

test('c: tornando alla scheda della home dopo un\'altra scheda il campo ha il fuoco', async ({ app, openTab }) => {
  const page = await casa(app);
  await page.keyboard.type('ciao');
  const altra = await openTab('filo://preferences/preferences.html');
  await expect(altra.locator('body')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => { try { return x.view.webContents.getURL().startsWith('filo://newtab'); } catch (_) { return false; } });
    w._filoTabs.activate ? w._filoTabs.activate(t.id) : w._filoTabs.switchTo(t.id);
  }).catch((e) => console.log('attivazione:', e.message));
  await page.waitForTimeout(400);
  console.log('fuoco dopo il ritorno:', await fuoco(page), await page.evaluate(() => document.hasFocus()));
  await page.keyboard.press('Backspace');
  await expect(page.locator('#input')).toHaveValue('cia');
});

test('d: dare dalle Preferenze una lettera nuova a un tasto che ne aveva già una dice quale perde', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: 'e', tasto: 'impostazioni' }] } }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.locator('#doppioToccoNuova').fill('i');
  await pref.locator('#doppioToccoDove').fill('Impostazioni');
  await pref.locator('#doppioToccoAggiungi').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere.map((v) => v.lettera).join())).not.toBe('e');
  const righe = await pref.locator('#doppioToccoLettere .mem-riga').allTextContents();
  const avviso = await pref.locator('#doppioToccoHint').textContent();
  console.log('righe:', JSON.stringify(righe), 'avviso:', avviso);
  await pref.screenshot({ path: `${SHOTS}/2372-1-v-lettera-tasto.png` });
  // La riga «ee → Impostazioni» c'era: se è sparita, l'avviso lo deve dire.
  if (!righe.some((r) => r.includes('ee'))) expect(avviso).toMatch(/ee|prima/);
});
