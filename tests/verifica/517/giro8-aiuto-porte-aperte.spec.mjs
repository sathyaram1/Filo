// Verifica #517 — giro 8, dal punto di vista dell'utente, sull'altra chat.
//
// Il pannello Aiuto guarda una risposta sola quando è testo, e quando porta
// un'azione di Filo o un'azione sulla pagina. Restano fuori i turni in cui il
// pannello AZIONA UN COMANDO della barra di Filo (home, impostazioni, app,
// account, schermo intero, riduci a icona): lì il testo che il modello scrive
// compare in chat e non lo guarda nessuno. Nessun ritentativo, nessuna riga
// sotto la risposta, niente nei log.
//
// È il caso della segnalazione parola per parola: un turno di prosecuzione
// dopo un comando, una cosa raccontata, una cosa mai fatta.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// L'agente risponde una cosa diversa a ogni turno (l'ultima si ripete).
async function agenteASequenza(page, risposte) {
  await page.evaluate((risposte) => {
    window.__turni = [];
    window.__azioni = [];
    window.__shell = [];
    let i = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        window.__turni.push(String((msg.payload && msg.payload.userMessage) || '(automatico)'));
        return Promise.resolve({ ok: true, text: risposte[Math.min(i++, risposte.length - 1)] });
      }
      if (msg && (msg.type === 'filo_run_action' || msg.type === 'filo_confirm_action')) {
        window.__azioni.push(msg.action);
        return Promise.resolve({ ok: true, executed: true, kept: true });
      }
      if (msg && msg.type === 'shell_action') {
        window.__shell.push(msg.command);
        return Promise.resolve({ ok: true });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  }, risposte);
}

async function apriAiuto(page) {
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
}

async function chiedi(page, domanda, turniAttesi) {
  await page.fill('.sn-sidebar-input textarea', domanda);
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await page.waitForFunction(
    (n) => (window.__turni || []).length >= n, turniAttesi, { timeout: 15000 },
  );
  // Un secondo tentativo, se ci fosse, partirebbe subito dopo.
  await page.waitForTimeout(1500);
}

const testoChat = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('.sn-sidebar-msg, .sn-sidebar-chat *'),
).map((el) => (el.textContent || '').trim()).join('\n'));

const AVVISATO = /non l'ha fatto|non è partito|non ha eseguito|la segnalazione non/i;

test('nell\'Aiuto un comando della barra non mette in ombra quello che il modello racconta', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    // Il pannello apre le impostazioni davvero, e nella stessa riga racconta
    // una segnalazione che non ha emesso.
    JSON.stringify({
      action: 'shell',
      command: 'settings',
      text: 'Apro le impostazioni. Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.',
      status: 'done',
    }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; window.__shell = []; });

  await chiedi(page, 'apri le impostazioni e manda un feedback: la barra in alto sparisce', 1);

  // Le impostazioni si aprono…
  expect(await page.evaluate(() => window.__shell.length)).toBe(1);
  // …e di segnalazioni non ne parte nessuna.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  // Quindi o il turno torna indietro al modello, o sotto la risposta c'è la
  // riga che dice che non è successo niente.
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  expect(turni > 1 || AVVISATO.test(testo)).toBe(true);
});

test('nell\'Aiuto un comando della barra raccontato per intero resta muto', async ({ openTab }) => {
  // La controprova che la porta è quella e non un'altra: la STESSA frase,
  // senza il comando della barra, viene vista.
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({
      text: 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.',
      status: 'done',
    }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; window.__shell = []; });

  await chiedi(page, 'manda un feedback: la barra in alto sparisce', 1);

  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  expect(turni > 1 || AVVISATO.test(testo)).toBe(true);
});
