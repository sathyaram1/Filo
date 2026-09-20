// #517 — l'agente Aiuto (il pannello che si apre sulla pagina) parla in JSON.
// Quando la risposta arriva fuori da quel formato non esegue niente, e finora
// finiva in silenzio: l'utente leggeva «ho mandato la segnalazione agli
// sviluppatori» e la segnalazione non partiva, oppure perdeva anche la frase e
// leggeva «(risposta vuota)». Sono le due forme che il feedback descrive.
//
// Adesso il turno torna indietro al modello una volta, e se non basta l'utente
// legge che in questo turno non è stato eseguito niente.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Il modello dell'Aiuto risponde sempre la stessa cosa: così il secondo
// tentativo fallisce come il primo e si vede anche cosa resta all'utente.
async function agenteCheRisponde(page, risposta) {
  await page.evaluate((risposta) => {
    window.__turni = [];
    window.__azioni = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        window.__turni.push(String((msg.payload && msg.payload.userMessage) || '(automatico)'));
        return Promise.resolve({ ok: true, text: risposta });
      }
      if (msg && (msg.type === 'filo_run_action' || msg.type === 'filo_confirm_action')) {
        window.__azioni.push(msg.action);
        return Promise.resolve({ ok: true, executed: true, kept: true });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  }, risposta);
}

async function apriAiutoEChiedi(page, domanda) {
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });
  await page.fill('.sn-sidebar-input textarea', domanda);
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await page.waitForFunction(() => (window.__turni || []).length >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

test('la risposta in prosa torna indietro al modello una volta, poi l\'utente lo legge', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.');
  await apriAiutoEChiedi(page, 'manda un feedback: la barra in alto sparisce');

  // Nessuna segnalazione parte: la frase è falsa.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  // Il turno è tornato indietro al modello una volta, e la chat lo dice
  // invece di saltare un turno in silenzio.
  await expect(page.locator('.sn-sidebar-log', { hasText: 'risposta rifatta' })).toHaveCount(1);
  // E, siccome il modello ha insistito, l'utente lo legge sotto la risposta.
  await expect(page.locator('.sn-sidebar-msg-avviso')).toHaveCount(1);
  await expect(page.locator('.sn-sidebar-msg-avviso')).toContainText('non ha eseguito niente');
});

test('la risposta buona davanti a un oggetto vuoto non diventa «(risposta vuota)»', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.\n{}');
  await apriAiutoEChiedi(page, 'manda un feedback: la barra in alto sparisce');

  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  const testo = await page.evaluate(() => (document.querySelector('.sn-sidebar-conv')?.textContent || ''));
  expect(testo).not.toContain('(risposta vuota)');
  expect(testo).toContain('Ho mandato la segnalazione');
  await expect(page.locator('.sn-sidebar-msg-avviso')).toHaveCount(1);
});

test('una risposta nel formato giusto non fa scattare niente', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, '{"text":"Il pulsante sta in alto a destra.","status":"done"}');
  await apriAiutoEChiedi(page, 'dove sta il pulsante per disdire?');

  // Nessun rimbalzo, nessun avviso, la risposta si legge.
  await expect(page.locator('.sn-sidebar-log', { hasText: 'risposta rifatta' })).toHaveCount(0);
  await expect(page.locator('.sn-sidebar-msg-avviso')).toHaveCount(0);
  const testo = await page.evaluate(() => (document.querySelector('.sn-sidebar-conv')?.textContent || ''));
  expect(testo).toContain('in alto a destra');
});
