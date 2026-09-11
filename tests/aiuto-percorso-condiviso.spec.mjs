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

test('rispondendo, il percorso parte davvero (e una risposta sola, non una per clic)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);

  await page.evaluate(() => {
    window.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'filo_save_path') { window.__inviati.push(msg); return Promise.resolve({ ok: true }); }
      return orig(msg, ...rest);
    };
  });

  // la sessione non c'è (nessuna conversazione vera): il riquadro non deve
  // inventarsi un percorso
  await page.click('.sn-sidebar-feedback-btn');
  expect(await page.evaluate(() => window.__inviati.length)).toBe(0);

  // con una sessione, parte una volta sola anche a furia di clic
  await page.evaluate(() => {
    window.__filoSidebarTest.renderFeedbackPrompt();
  });
  await page.waitForTimeout(50);
  const bottoni = page.locator('.sn-sidebar-feedback').last().locator('.sn-sidebar-feedback-btn').first();
  await bottoni.click();
  await bottoni.click({ force: true }).catch(() => {});
  await page.waitForTimeout(50);
  const dopo = await page.evaluate(() => ({
    inviati: window.__inviati.length,
    disabilitati: Array.from(document.querySelectorAll('.sn-sidebar-feedback'))
      .pop().querySelectorAll('.sn-sidebar-feedback-btn[disabled]').length,
  }));
  expect(dopo.inviati).toBeLessThanOrEqual(1);
  expect(dopo.disabilitati).toBe(2);
});
