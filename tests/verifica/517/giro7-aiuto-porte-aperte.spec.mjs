// Verifica #517 — giro 7, dal punto di vista dell'utente, sull'altra chat.
//
// Il pannello Aiuto ha il presidio dal giro 5, ma chiama lo stesso controllo
// con metà delle informazioni. Due porte restano aperte proprio sul caso
// della segnalazione — il fallimento muto:
//
//   1. un'azione emessa UNA VOLTA nel pannello vale come «fatta» per tutto il
//      resto della sessione: la seconda segnalazione, raccontata e mai
//      emessa, non fa scattare niente. Nella chat della home il giro 6 ha
//      chiuso esattamente questo;
//   2. la conferma col PRONOME («sì, te l'ho mandata») non viene guardata
//      affatto: nel pannello la famiglia che la riconosce è esclusa. Nella
//      chat della home è vista dal giro 3, ed è la forma più probabile subito
//      dopo la richiesta dell'utente.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// L'agente risponde una cosa diversa a ogni turno (l'ultima si ripete).
async function agenteASequenza(page, risposte) {
  await page.evaluate((risposte) => {
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
        return Promise.resolve({ ok: true, executed: true, kept: true });
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

const AVVISATO = /non l'ha fatto|non è partito|non ha eseguito|non è stata|la segnalazione non/i;

test('nell\'Aiuto la seconda segnalazione raccontata e mai partita non resta muta', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    // Primo feedback: lo manda davvero.
    JSON.stringify({
      text: 'Ho mandato la segnalazione agli sviluppatori.',
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', testo: 'la barra in alto sparisce' },
      status: 'done',
    }),
    // Secondo feedback: lo racconta e basta.
    JSON.stringify({
      text: 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.',
      status: 'done',
    }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'manda un feedback: la barra in alto sparisce', 1);
  const dopoIlPrimo = await page.evaluate(() => window.__azioni.length);
  expect(dopoIlPrimo).toBe(1);

  await page.evaluate(() => { window.__turni = []; });
  await chiedi(page, 'manda anche un feedback: il menu si chiude da solo', 1);

  // La seconda segnalazione non è mai partita.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);
  // Quindi o il turno torna indietro al modello, o sotto la risposta c'è la
  // riga che dice che non è successo niente.
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  expect(turni > 1 || AVVISATO.test(testo)).toBe(true);
});

test('nell\'Aiuto un turno che emette un\'azione viene guardato lo stesso', async ({ openTab }) => {
  // Il pannello emette UNA azione per turno. Se l'utente ne chiede due, la
  // seconda il modello la racconta e basta — e in un turno con un'azione il
  // controllo non parte affatto.
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({
      text: 'Ho mandato la segnalazione agli sviluppatori e ti ho messo la sveglia alle 19:00 per stasera.',
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', testo: 'la barra in alto sparisce' },
      status: 'done',
    }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'manda un feedback: la barra in alto sparisce, e mettimi la sveglia alle 19', 1);

  // Di sveglie non ne nasce nessuna: è partita solo la segnalazione.
  const tipi = await page.evaluate(() => window.__azioni.map((a) => a && a.type));
  expect(tipi).toEqual(['INVIA_FEEDBACK']);
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  expect(turni > 1 || /non l'ha fatto|non è partito|la sveglia non c'è/i.test(testo)).toBe(true);
});

test('nell\'Aiuto la conferma col pronome non resta muta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({ text: 'Sì, te l\'ho mandata.', status: 'done' }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'manda un feedback: la barra in alto sparisce', 1);

  // Di segnalazioni non ne parte nessuna.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  expect(turni > 1 || AVVISATO.test(testo)).toBe(true);
});

test('nell\'Aiuto un appunto che esiste davvero non viene smentito', async ({ app, openTab }) => {
  // Il rovescio: al pannello i titoli degli appunti non arrivavano mai,
  // quindi la frase vera diventava un'accusa. Nella chat della home la stessa
  // frase resta muta dal giro 3.
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'SALVA_APPUNTO', testo: 'pane, uova, latte', contesto: 'lista della spesa',
  }));
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({ text: 'Sì, ti ho salvato l\'appunto con la lista della spesa.', status: 'done' }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'hai salvato la lista della spesa?', 1);

  const testo = await testoChat(page);
  expect(testo).not.toMatch(/non l'ha fatto|non è partito niente|l'appunto non c'è/i);
  expect(testo).not.toMatch(/risposta rifatta/i);
});

test('nell\'Aiuto l\'avviso del formato offre lo stesso tasto dell\'altro avviso', async ({ openTab }) => {
  // Il giro 6 ha messo il tasto «Fallo adesso» sotto l'avviso dell'azione
  // raccontata. L'altro avviso dello stesso presidio — la risposta arrivata
  // fuori dal formato, che è l'altra metà della segnalazione — è rimasto un
  // vicolo cieco: dice «chiediglielo di nuovo» e basta.
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    'Ti ho messo una sveglia alle 19:00 per stasera.',
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'mettimi una sveglia alle 19 per stasera', 2);
  await page.waitForSelector('.sn-sidebar-msg-avviso', { timeout: 10_000 });

  const tasti = await page.evaluate(() => Array.from(
    document.querySelectorAll('.sn-sidebar-conv button'),
  ).map((b) => (b.textContent || '').trim()).filter(Boolean));
  expect(tasti.some((t) => /fallo adesso|rifallo|riprova/i.test(t))).toBe(true);
});
