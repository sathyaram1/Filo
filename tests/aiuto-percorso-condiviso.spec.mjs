// Il riquadrino «Ha funzionato?» dell'Aiuto, e la promessa che porta scritta
// (#584, audit pre-alpha).
//
// Rispondere lì non è un parere privato a chi scrive Filo: manda il sito, la
// pagina di partenza e la sequenza dei clic in una raccolta che legge chiunque.
// La pagina che lo spiega esiste, ma chi preme il pollice in su non ci è mai
// stato: la riga deve stare dove si sceglie. Questa spec tiene ferme due cose:
// che la riga ci sia accanto ai pulsanti, e che il percorso parta davvero
// quando si risponde.
//
// Senza il fix il primo test è rosso: sotto la domanda non c'era niente.

import { test, expect } from './fixtures/electron.mjs';

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

test('sotto «Ha funzionato?» c’è scritto che rispondendo si condivide il percorso', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);

  const nota = page.locator('.sn-sidebar-feedback-nota');
  await expect(nota).toBeVisible();
  const testo = (await nota.textContent()) || '';
  expect(testo.toLowerCase()).toContain('condividi');

  // la riga sta PRIMA dei pulsanti: dopo, la si legge a scelta fatta
  const ordine = await page.evaluate(() => {
    const box = document.querySelector('.sn-sidebar-feedback');
    const figli = Array.from(box.children).map((el) => el.className);
    return {
      nota: figli.findIndex((c) => c.includes('feedback-nota')),
      pulsanti: figli.findIndex((c) => c.includes('feedback-row')),
    };
  });
  expect(ordine.nota).toBeGreaterThanOrEqual(0);
  expect(ordine.nota).toBeLessThan(ordine.pulsanti);

  // e si legge: non è testo bianco su bianco né alto zero
  const resa = await page.evaluate(() => {
    const el = document.querySelector('.sn-sidebar-feedback-nota');
    const s = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, colore: s.color, sfondo: getComputedStyle(el.parentElement).backgroundColor };
  });
  expect(resa.h).toBeGreaterThan(8);
  expect(resa.colore).not.toBe(resa.sfondo);

  await page.screenshot({ path: 'tests/.shots/584-nota-percorso-condiviso.png' });
});

// Il messaggio che si ascolta è quello VERO (`save_path`, da SN_MSG). Una prova
// sintonizzata su un nome di comodo resta muta anche il giorno in cui il
// pulsante smette di pubblicare: le sue due domande («nessun invio prima», «al
// massimo uno dopo») sono vere su una lista che non si riempie mai (#584,
// quinto giro).
async function ascolta(page) {
  await page.evaluate(() => {
    window.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'save_path') {
        window.__inviati.push(JSON.parse(JSON.stringify(msg)));
        return Promise.resolve({ ok: true });
      }
      return orig(msg, ...rest);
    };
  });
}

test('il pollice in su pubblica davvero, una volta sola, e senza dire chi \u00e8 stato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  const su = page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-btn').first();
  await su.click();
  await su.click({ force: true }).catch(() => {});
  await su.click({ force: true }).catch(() => {});
  await page.waitForTimeout(150);

  const inviati = await page.evaluate(() => window.__inviati);
  expect(inviati.length).toBe(1);
  expect(inviati[0].payload.session.success).toBe(true);
  expect(typeof inviati[0].payload.session.rawUrl).toBe('string');

  // Nel messaggio che lascia la pagina non c'\u00e8 nessun identificativo del
  // mittente, a nessun livello.
  const piatto = JSON.stringify(inviati[0]).toLowerCase();
  for (const parola of ['useragent', 'user_agent', 'installid', 'deviceid']) {
    expect(piatto).not.toContain(parola);
  }
});

test('il pollice in gi\u00f9 pubblica anche lui, con l\u2019esito negativo', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-btn').nth(1).click();
  await page.waitForTimeout(150);

  const inviati = await page.evaluate(() => window.__inviati);
  expect(inviati.length).toBe(1);
  expect(inviati[0].payload.session.success).toBe(false);

  // La riga sotto la domanda dice «Rispondendo», non «Rispondendo di s\u00ec»:
  // deve valere per tutti e due i pulsanti, perch\u00e9 tutti e due pubblicano.
  const nota = (await page.locator('.sn-sidebar-feedback-nota').last().textContent()) || '';
  expect(nota.toLowerCase()).toContain('rispondendo');
});

test('la X non pubblica niente: chiudere il riquadro \u00e8 la via d\u2019uscita', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-skip').click();
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => window.__inviati.length)).toBe(0);
});
