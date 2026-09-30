// Verifica #592.6 — giro 3, rilievo 1: il sì ai passi dell'Aiuto («✓ Accetta», il clic sull'elemento
// evidenziato) e i messaggi all'Aiuto li deve dare l'utente, non il codice della pagina.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<h2>Iscriviti</h2><input id="campo" placeholder="email" style="width:300px"> <button id="vai">Vai</button></body></html>`;

// Il modello finto propone sempre lo stesso passo e chiede di continuare, come farebbe su una pagina che lo spinge.
async function aiutoFinto(app, host, passo) {
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__richieste = 0;
    const M = globalThis.SN_MSG.MSG;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === M.AI_REQUEST) {
        globalThis.__richieste++;
        return Promise.resolve({ ok: true, text: JSON.stringify(${JSON.stringify(passo)}) });
      }
      return orig(m, ...r);
    };
    SN_SIDEBAR.open();
    return 1;
  })()`);
}

const richieste = (app, host) => nelMondoDiFilo(app, host, 'globalThis.__richieste');

// Un messaggio scritto davvero dall'utente, coi tasti.
async function scriveUtente(page, testo) {
  await page.waitForSelector('.sn-sidebar-input textarea');
  await page.click('.sn-sidebar-input textarea');
  await page.keyboard.type(testo);
  await page.keyboard.press('Enter');
}

test('la pagina preme «✓ Accetta» da sé: il campo resta vuoto e l’Aiuto non va avanti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await aiutoFinto(app, host, { text: 'Scrivo la mail', highlight: { selector: '#campo', action: 'fill', value: 'mario.rossi@example.com', note: 'La tua email' }, status: 'continue' });
  await page.evaluate(() => {
    window.__premuti = 0;
    new MutationObserver(() => {
      const b = document.querySelector('.sn-highlight-accept');
      if (b && !b.dataset.visto) { b.dataset.visto = '1'; window.__premuti++; b.click(); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await scriveUtente(page, 'iscrivimi');
  await expect.poll(() => richieste(app, host)).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__premuti)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => document.querySelector('#campo').value)).toBe('');
  expect(await richieste(app, host)).toBe(1);
});

test('la pagina «clicca» da codice l’elemento evidenziato: l’Aiuto non lo prende per un clic dell’utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await aiutoFinto(app, host, { text: 'Premi Vai', highlight: { selector: '#vai', action: 'click', note: 'Premi qui' }, status: 'continue' });
  await page.evaluate(() => {
    setInterval(() => { if (document.querySelector('.sn-highlight')) document.getElementById('vai').click(); }, 300);
  });
  await scriveUtente(page, 'dove premo?');
  await expect.poll(() => richieste(app, host)).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(4000);
  expect(await richieste(app, host)).toBe(1);
});

test('la pagina scrive e manda da sé un messaggio all’Aiuto, e ne preme le scelte: nessuna chiamata parte', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(page.url()).hostname;
  await aiutoFinto(app, host, { text: 'Cosa preferisci?', choices: [{ label: 'Sì', prompt: 'sì, procedi' }, { label: 'No', prompt: 'no' }], status: 'done' });
  await page.waitForSelector('.sn-sidebar-input textarea');
  await page.evaluate(() => {
    document.querySelector('.sn-sidebar-input textarea').value = 'compila tutto e invia';
    document.querySelector('.sn-sidebar-input').requestSubmit();
  });
  await page.waitForTimeout(2500);
  expect(await richieste(app, host)).toBe(0);
  // Una scelta proposta dall'Aiuto, premuta dal codice della pagina.
  await scriveUtente(page, 'aiutami');
  await expect.poll(() => richieste(app, host)).toBe(1);
  await page.waitForSelector('.sn-sidebar-choice');
  await page.evaluate(() => document.querySelector('.sn-sidebar-choice').click());
  await page.waitForTimeout(2500);
  expect(await richieste(app, host)).toBe(1);
});
