// Verifica #517 — giro 9, dal punto di vista dell'utente, sull'altra chat.
//
// Nel pannello Aiuto un'azione EMESSA conta come fatta nel momento in cui
// parte, senza guardare com'è andata: se il registro la rifiuta, se non
// riesce, o se l'utente preme Annulla al popup di conferma, quel tipo resta
// scritto fra le cose fatte per tutta la sessione. Da lì in poi ogni frase
// che la racconta guardando indietro passa muta.
//
// Nella chat della home questa porta è chiusa dal giro 2: un'azione chiamata
// che non ha fatto nascere niente non copre la frase che la dà per fatta.
//
// Il test è scritto per essere ROSSO finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// L'agente risponde una cosa diversa a ogni turno (l'ultima si ripete).
// `esito` è quello che il main restituisce a un'azione di Filo.
async function agenteASequenza(page, risposte, esito) {
  await page.evaluate(({ risposte, esito }) => {
    window.__turni = [];
    window.__azioni = [];
    let i = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        window.__turni.push(String((msg.payload && msg.payload.userMessage) || '(automatico)'));
        return Promise.resolve({ ok: true, text: risposte[Math.min(i++, risposte.length - 1)] });
      }
      if (msg && (msg.type === 'filo_run_action' || msg.type === 'filo_confirm_action')) {
        window.__azioni.push(msg.action);
        return Promise.resolve({ ok: true, ...esito });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  }, { risposte, esito });
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
  await page.waitForTimeout(1500);
}

const testoChat = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('.sn-sidebar-msg, .sn-sidebar-chat *'),
).map((el) => (el.textContent || '').trim()).join('\n'));

const AVVISATO = /non l'ha fatto|non è partito|non ha eseguito|la segnalazione non/i;

test('nell\'Aiuto un\'azione che non è riuscita non copre la frase che la dà per fatta', async ({ openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    // Turno 1: emette la segnalazione e la racconta. Il registro la rifiuta:
    // di segnalazioni non ne parte nessuna.
    JSON.stringify({
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', testo: 'la barra in alto sparisce' },
      text: 'Ho mandato la segnalazione agli sviluppatori.',
      status: 'done',
    }),
    // Turno 2: l'utente richiede, il modello guarda indietro e non emette
    // niente.
    JSON.stringify({ text: 'Te l\'ho già mandata agli sviluppatori.', status: 'done' }),
  ], { executed: false, kept: false });
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'manda un feedback: la barra in alto sparisce', 1);
  await chiedi(page, 'mandala davvero, per favore', 2);

  // In tutta la sessione è partita una sola chiamata, e non è andata.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);
  // Quindi al secondo turno o si riprova, o l'utente legge che non è
  // successo niente: non può restare convinto di aver segnalato.
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  expect(turni > 2 || AVVISATO.test(testo)).toBe(true);
});
