// Verifica #584, giro 5 — il riquadrino «Ha funzionato?» dal lato dell'utente.
//
// Tutto il lavoro di questo feedback sta a valle di tre pulsanti: 👍, 👎 e ✕.
// Da lì parte (o non parte) il percorso che finisce nella raccolta pubblica.
// I giri passati hanno provato le regole, la coda, la pulizia e la domanda al
// giudice: quello che nessuno ha ancora osservato è che quei tre pulsanti
// facciano davvero quello che la riga sotto la domanda promette.
//
// Qui si ascolta il messaggio VERO che la pagina manda al processo principale
// (`save_path`), non un nome di comodo: un ascoltatore sintonizzato sul nome
// sbagliato resta muto anche quando il pulsante non pubblica più niente.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function apriRiquadro(page) {
  await page.waitForFunction(
    () => typeof window.__filoSidebarTest?.renderFeedbackPrompt === 'function',
    null, { timeout: 8000 },
  );
  await page.evaluate(() => {
    window.SN_SIDEBAR.open();
    window.__filoSidebarTest.renderFeedbackPrompt();
  });
  await page.waitForSelector('.sn-sidebar-feedback', { timeout: 8000 });
}

// Intercetta i messaggi verso il processo principale SENZA lasciarli passare:
// così la prova non scrive niente da nessuna parte e resta osservabile.
async function ascolta(page) {
  await page.evaluate(() => {
    window.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && typeof msg.type === 'string' && msg.type.includes('save_path')) {
        window.__inviati.push(JSON.parse(JSON.stringify(msg)));
        return Promise.resolve({ ok: true });
      }
      return orig(msg, ...rest);
    };
  });
}

test('il pollice in su pubblica davvero, e il messaggio che parte non dice chi è stato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-btn').first().click();
  await page.waitForTimeout(100);

  const inviati = await page.evaluate(() => window.__inviati);
  // Il cuore: rispondendo, qualcosa parte. Se un giorno il pulsante smettesse
  // di pubblicare, questa riga diventa rossa.
  expect(inviati.length).toBe(1);
  expect(inviati[0].type).toBe('save_path');

  const p = inviati[0].payload || {};
  expect(p.session).toBeTruthy();
  expect(p.session.success).toBe(true);
  expect(typeof p.session.rawUrl).toBe('string');
  expect(p.session.rawUrl.length).toBeGreaterThan(0);

  // Nel messaggio che lascia la pagina non c'è nessun identificativo del
  // mittente, a nessun livello.
  const piatto = JSON.stringify(inviati[0]).toLowerCase();
  for (const parola of ['clientid', 'useragent', 'user_agent', 'installid', 'deviceid']) {
    expect(piatto).not.toContain(parola);
  }
});

test('il pollice in giù pubblica anche lui, e lo dice: è una risposta, non un parere privato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-btn').nth(1).click();
  await page.waitForTimeout(100);

  const inviati = await page.evaluate(() => window.__inviati);
  expect(inviati.length).toBe(1);
  expect(inviati[0].payload.session.success).toBe(false);

  // La riga sotto la domanda dice «Rispondendo», non «Rispondendo di sì»:
  // deve valere per tutti e due i pulsanti, perché tutti e due pubblicano.
  const nota = (await page.locator('.sn-sidebar-feedback-nota').last().textContent()) || '';
  expect(nota.toLowerCase()).toContain('rispondendo');
});

test('la X non pubblica niente: chiudere il riquadro è la via d’uscita', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-skip').click();
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.__inviati.length)).toBe(0);
});

test('due clic in fretta non pubblicano due percorsi', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  const su = page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-btn').first();
  await su.click();
  await su.click({ force: true }).catch(() => {});
  await su.click({ force: true }).catch(() => {});
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => window.__inviati.length)).toBe(1);
});
