// Verifica #517 — giro 4, dal punto di vista dell'utente, sull'altra chat.
//
// Il presidio vive solo nella chat della home. L'altra chat con Filo —
// l'Aiuto, il pannello che si apre sulla pagina — può fare azioni di Filo
// (mandare una segnalazione agli sviluppatori, copiare, cercare sul web,
// comandare la finestra) e lì il fallimento è muto come prima del lavoro.
//
// E sono proprio le due forme che la segnalazione descrive:
//   1. il modello risponde in prosa invece che nel formato atteso: il testo
//      arriva all'utente, l'azione no, nessun secondo tentativo, nessun
//      avviso;
//   2. il modello scrive la risposta buona come preambolo e chiude con un
//      oggetto vuoto: qui l'utente perde anche la risposta, e legge
//      «(risposta vuota)».
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Il modello dell'Aiuto risponde sempre la stessa cosa. Registriamo i turni
// che partono (per vedere se ne parte un secondo) e le azioni di Filo che
// vengono dispacciate (per vedere che non ne parte nessuna).
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
  // Un secondo tentativo, se ci fosse, partirebbe subito dopo.
  await page.waitForTimeout(1500);
}

const testoChat = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('.sn-sidebar-msg, .sn-sidebar-chat *'),
).map((el) => (el.textContent || '').trim()).join('\n'));

test('la risposta in prosa che racconta un\'azione mai partita non resta muta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.');
  await apriAiutoEChiedi(page, 'manda un feedback: la barra in alto sparisce');

  // Di segnalazioni non ne parte nessuna: la frase è falsa.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);

  // L'utente non deve restare a crederci. O il turno torna indietro al
  // modello (come fa la chat della home), o sotto la risposta c'è una riga
  // che dice che non è successo niente.
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  const avvisato = /non l'ha fatto|non è partito|non è stata|nessuna segnalazione/i.test(testo);
  expect(turni > 1 || avvisato).toBe(true);
});

test('la risposta buona seguita da un oggetto vuoto non diventa «(risposta vuota)»', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.\n{}');
  await apriAiutoEChiedi(page, 'manda un feedback: la barra in alto sparisce');

  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);

  const testo = await testoChat(page);
  // Oggi la risposta scritta prima dell'oggetto sparisce del tutto.
  expect(testo).not.toContain('(risposta vuota)');
  const turni = await page.evaluate(() => window.__turni.length);
  const avvisato = /non l'ha fatto|non è partito|non è stata|nessuna segnalazione/i.test(testo);
  expect(turni > 1 || avvisato).toBe(true);
});
