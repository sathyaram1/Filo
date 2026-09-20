// Verifica #517 — giro 5, dal punto di vista dell'utente, sull'altra chat.
//
// Il giro 4 aveva trovato l'Aiuto (il pannello che si apre sulla pagina)
// completamente muto. Adesso riconosce la risposta che arriva FUORI dal suo
// formato: la prosa al posto del JSON, e l'oggetto vuoto. Resta fuori il caso
// principale della segnalazione: una risposta nel formato GIUSTO, che però
// racconta un'azione che non è mai partita.
//
// «Ho mandato la segnalazione agli sviluppatori», dentro un JSON regolare:
// nessuna segnalazione parte, il turno non torna indietro, e sotto la
// risposta non c'è niente. La stessa identica frase, nella chat della home,
// viene vista e rimandata indietro — due chat, una sola coperta.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

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

test('nel formato giusto, la segnalazione raccontata e mai partita non resta muta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, JSON.stringify({
    text: 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.',
    status: 'done',
  }));
  await apriAiutoEChiedi(page, 'manda un feedback: la barra in alto sparisce');

  // Di segnalazioni non ne parte nessuna: la frase è falsa.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);

  // L'utente non deve restare a crederci: o il turno torna indietro al
  // modello, o sotto la risposta c'è la riga che dice che non è successo
  // niente. È quello che fa la chat della home con la stessa frase.
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  const avvisato = /non l'ha fatto|non è partito|non ha eseguito|non è stata|nessuna segnalazione/i.test(testo);
  expect(turni > 1 || avvisato).toBe(true);
});

test('nel formato giusto, la sveglia raccontata e mai messa non resta muta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteCheRisponde(page, JSON.stringify({
    text: 'Ti ho messo una sveglia alle 19:00 per stasera.',
    status: 'done',
  }));
  await apriAiutoEChiedi(page, 'mettimi una sveglia alle 19 per stasera');

  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);

  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  const avvisato = /non l'ha fatto|non è partito|non ha eseguito|non è stata|nessuna sveglia/i.test(testo);
  expect(turni > 1 || avvisato).toBe(true);
});
