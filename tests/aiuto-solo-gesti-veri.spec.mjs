// L'Aiuto va avanti solo per un gesto vero dell'utente (#592.6, giro 3). Il riquadro e i suoi passi stanno
// nel documento del sito, che clicca e invia da codice: ogni passo fatto avanzare così era una chiamata al
// modello pagata dall'utente, senza fine. Qui il codice della pagina non fa avanzare niente, l'utente sì.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo } from './helpers/confirm.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<h2>Iscriviti</h2><input id="campo" placeholder="email" style="width:300px"> <button id="vai">Vai</button></body></html>`;

// Il modello finto propone sempre lo stesso passo; si contano solo le chiamate dell'Aiuto.
async function aiutoFinto(app, host, passo) {
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__aiuto = 0;
    const M = globalThis.SN_MSG.MSG;
    const HELP = globalThis.SN_CONST.ACTIONS.HELP;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === M.AI_REQUEST && m.action === HELP) {
        globalThis.__aiuto++;
        return Promise.resolve({ ok: true, text: JSON.stringify(${JSON.stringify(passo)}) });
      }
      return orig(m, ...r);
    };
    SN_SIDEBAR.open();
    return 1;
  })()`);
}

const chiamate = (app, host) => nelMondoDiFilo(app, host, 'globalThis.__aiuto');

async function scriveUtente(page, testo) {
  await page.waitForSelector('.sn-sidebar-input textarea');
  await page.click('.sn-sidebar-input textarea');
  await page.keyboard.type(testo);
  await page.keyboard.press('Enter');
}

async function centro(page, selettore) {
  const r = await page.waitForSelector(selettore).then((h) => h.boundingBox());
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

test('«✓ Accetta»: premuto dal codice della pagina non scrive e non va avanti, premuto dall’utente sì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await aiutoFinto(app, host, { text: 'Scrivo la mail', highlight: { selector: '#campo', action: 'fill', value: 'mario.rossi@example.com', note: 'La tua email' }, status: 'continue' });
  await scriveUtente(page, 'iscrivimi');
  await expect.poll(() => chiamate(app, host)).toBe(1);
  await page.evaluate(() => document.querySelector('.sn-highlight-accept').click());
  await page.waitForTimeout(1500);
  expect(await page.inputValue('#campo')).toBe('');
  expect(await chiamate(app, host)).toBe(1);

  const p = await centro(page, '.sn-highlight-accept');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#campo')).toHaveValue('mario.rossi@example.com');
  await expect.poll(() => chiamate(app, host)).toBe(2);
});

test('il clic sull’elemento evidenziato vale solo se è dell’utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await aiutoFinto(app, host, { text: 'Premi Vai', highlight: { selector: '#vai', action: 'click', note: 'Premi qui' }, status: 'continue' });
  await scriveUtente(page, 'aiuto');
  await expect.poll(() => chiamate(app, host)).toBe(1);
  await page.waitForSelector('.sn-highlight');
  await page.evaluate(() => document.getElementById('vai').click());
  await page.waitForTimeout(1500);
  expect(await chiamate(app, host)).toBe(1);

  await page.click('#vai');
  await expect.poll(() => chiamate(app, host)).toBe(2);
});

test('la casella e le scelte dell’Aiuto: il codice della pagina non manda niente, l’utente sì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await aiutoFinto(app, host, { text: 'Cosa preferisci?', choices: [{ label: 'Sì', prompt: 'sì, procedi' }, { label: 'No', prompt: 'no' }], status: 'done' });
  await page.waitForSelector('.sn-sidebar-input textarea');
  await page.evaluate(() => {
    const ta = document.querySelector('.sn-sidebar-input textarea');
    ta.value = 'compila tutto e invia';
    document.querySelector('.sn-sidebar-input').requestSubmit();
    document.querySelector('.sn-sidebar-input button[type="submit"]').click();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await page.waitForTimeout(1500);
  expect(await chiamate(app, host)).toBe(0);

  await scriveUtente(page, 'aiutami');
  await expect.poll(() => chiamate(app, host)).toBe(1);
  await page.waitForSelector('.sn-sidebar-choice');
  await page.evaluate(() => document.querySelector('.sn-sidebar-choice').click());
  await page.waitForTimeout(1500);
  expect(await chiamate(app, host)).toBe(1);

  await page.locator('.sn-sidebar-choice').first().click();
  await expect.poll(() => chiamate(app, host)).toBe(2);
  // Il bottone di invio, premuto davvero, manda quello che c'è scritto.
  await page.click('.sn-sidebar-input textarea');
  await page.keyboard.type('ancora');
  await page.click('.sn-sidebar-input button[type="submit"]');
  await expect.poll(() => chiamate(app, host)).toBe(3);
});
