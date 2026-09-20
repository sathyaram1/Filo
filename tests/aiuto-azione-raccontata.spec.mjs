// #517 — il presidio dell'Aiuto (il pannello che si apre sulla pagina) deve
// guardare quello che guarda la chat della home, e guardarlo sempre.
//
// Prima il pannello teneva le azioni emesse in un mucchio solo, che valeva
// come «fatto adesso» per tutta la sessione; saltava il controllo appena il
// turno portava un'azione; non guardava mai la conferma col pronome; e non
// sapeva niente degli appunti che esistono davvero, quindi li smentiva.
//
// Le altre prove del pannello stanno in tests/aiuto-fuori-formato.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

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
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });
}

async function chiedi(page, domanda) {
  await page.fill('.sn-sidebar-input textarea', domanda);
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await page.waitForFunction(() => (window.__turni || []).length >= 1, null, { timeout: 15000 });
  // Un secondo tentativo, se ci fosse, partirebbe subito dopo.
  await page.waitForTimeout(1500);
}

const testoChat = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('.sn-sidebar-msg, .sn-sidebar-chat *'),
).map((el) => (el.textContent || '').trim()).join('\n'));

const AVVISATO = /non l'ha fatto|non è partito|non ha eseguito|non è stata/i;

test('una cosa emessa in un turno prima non copre quella raccontata adesso', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({
      text: 'Ho mandato la segnalazione agli sviluppatori.',
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', testo: 'la barra in alto sparisce' },
      status: 'done',
    }),
    JSON.stringify({ text: 'Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.', status: 'done' }),
  ]);
  await apriAiuto(page);

  await chiedi(page, 'manda un feedback: la barra in alto sparisce');
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);

  await page.evaluate(() => { window.__turni = []; });
  await chiedi(page, 'manda anche un feedback: il menu si chiude da solo');

  // La seconda segnalazione non è mai partita: l'utente non deve crederci.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);
  const turni = await page.evaluate(() => window.__turni.length);
  expect(turni > 1 || AVVISATO.test(await testoChat(page))).toBe(true);
});

test('un turno che emette un\'azione viene guardato lo stesso', async ({ openTab }) => {
  // Il pannello emette una sola azione per turno: se l'utente ne chiede due,
  // la seconda il modello la racconta e basta.
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

  await chiedi(page, 'manda un feedback: la barra in alto sparisce, e mettimi la sveglia alle 19');

  // L'azione parte davvero: il controllo non deve buttarla via…
  expect(await page.evaluate(() => window.__azioni.map((a) => a && a.type))).toEqual(['INVIA_FEEDBACK']);
  // …e la sveglia raccontata, che non esiste, l'utente la deve leggere.
  expect(await testoChat(page)).toMatch(/non l'ha fatto|la sveglia non c'è/i);
});

test('la conferma col pronome non resta muta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [JSON.stringify({ text: 'Sì, te l\'ho mandata.', status: 'done' })]);
  await apriAiuto(page);

  await chiedi(page, 'manda un feedback: la barra in alto sparisce');

  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  const turni = await page.evaluate(() => window.__turni.length);
  expect(turni > 1 || AVVISATO.test(await testoChat(page))).toBe(true);
});

test('un appunto che esiste davvero non viene smentito', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'SALVA_APPUNTO', testo: 'pane, uova, latte', contesto: 'lista della spesa',
  }));
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({ text: 'Sì, ti ho salvato l\'appunto con la lista della spesa.', status: 'done' }),
  ]);
  await apriAiuto(page);

  await chiedi(page, 'hai salvato la lista della spesa?');

  const testo = await testoChat(page);
  expect(testo).not.toMatch(/non l'ha fatto|l'appunto non c'è|non è partito niente/i);
  expect(testo).not.toMatch(/risposta rifatta/i);
});

test('anche l\'avviso della risposta fuori formato offre il tasto che rimanda la richiesta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, ['Ti ho messo una sveglia alle 19:00 per stasera.']);
  await apriAiuto(page);

  await chiedi(page, 'mettimi una sveglia alle 19 per stasera');
  await page.waitForSelector('.sn-sidebar-msg-avviso', { timeout: 10_000 });

  const tasti = await page.evaluate(() => Array.from(
    document.querySelectorAll('.sn-sidebar-conv button'),
  ).map((b) => (b.textContent || '').trim()).filter(Boolean));
  expect(tasti.some((t) => /fallo adesso/i.test(t))).toBe(true);
});

test('un turno che aziona un comando della barra viene guardato come gli altri', async ({ openTab }) => {
  // Il pannello mostra in chat il testo scritto insieme al comando, e quel
  // testo non lo guardava nessuno: né ritentativo, né riga sotto la risposta.
  // È il caso del feedback in un turno di prosecuzione dopo un comando.
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  await page.evaluate(() => { window.__shell = []; });
  await agenteASequenza(page, [
    JSON.stringify({
      action: 'shell',
      command: 'settings',
      text: 'Apro le impostazioni. Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.',
      status: 'done',
    }),
  ]);
  await page.evaluate(() => {
    window.__shell = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'shell_action') {
        window.__shell.push(msg.command);
        return Promise.resolve({ ok: true });
      }
      return orig(msg, ...rest);
    };
  });
  await apriAiuto(page);

  await chiedi(page, 'apri le impostazioni e manda un feedback: la barra in alto sparisce');

  // Le impostazioni si aprono, la segnalazione no.
  expect(await page.evaluate(() => window.__shell.length)).toBe(1);
  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  expect(await testoChat(page)).toMatch(AVVISATO);
});

test('una cosa già smentita non torna vera perché il modello la ripete', async ({ openTab }) => {
  // Premuto «Fallo adesso», il modello ripete la stessa cosa con un «già»
  // davanti: senza il ricordo dell'avviso, un'azione emessa prima nella
  // sessione tornava a coprirla e il presidio taceva.
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    // Primo turno: la segnalazione parte davvero.
    JSON.stringify({
      text: 'Ho mandato la segnalazione agli sviluppatori.',
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', testo: 'la barra in alto sparisce' },
      status: 'done',
    }),
    // Secondo turno: la racconta e basta, anche dopo il ritentativo.
    JSON.stringify({ text: 'Ho mandato la segnalazione agli sviluppatori.', status: 'done' }),
    JSON.stringify({ text: 'Ho mandato la segnalazione agli sviluppatori.', status: 'done' }),
    // Terzo turno, quello del tasto: la ripete guardando indietro.
    JSON.stringify({ text: 'Te l\'ho già mandata, come ti dicevo.', status: 'done' }),
  ]);
  await apriAiuto(page);

  await chiedi(page, 'manda un feedback: la barra in alto sparisce');
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);

  await chiedi(page, 'manda anche un feedback: il menu si chiude da solo');
  await page.waitForSelector('.sn-sidebar-msg-avviso', { timeout: 10_000 });
  const primi = await page.evaluate(() => document.querySelectorAll('.sn-sidebar-msg-avviso').length);

  await page.evaluate(() => { window.__turni = []; });
  await chiedi(page, 'Non l\'hai fatto davvero: fallo adesso.');

  // La seconda segnalazione non esiste ancora: l'utente deve leggerlo anche
  // stavolta, non credere che premendo il tasto sia andata.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);
  const dopo = await page.evaluate(() => document.querySelectorAll('.sn-sidebar-msg-avviso').length);
  expect(dopo).toBeGreaterThan(primi);
});

test('un\'azione emessa e non riuscita non copre la frase che la dà per fatta', async ({ openTab }) => {
  // Nella chat della home un'azione chiamata che non ha fatto nascere niente
  // non prova niente. Nel pannello bastava che partisse: se il registro la
  // rifiutava, se non riusciva o se l'utente premeva Annulla al popup, la
  // frase che la dava per fatta non la smentiva nessuno, e da lì in poi quel
  // tipo restava fra le cose fatte per tutta la sessione.
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  await page.evaluate(() => {
    window.__turni = [];
    window.__azioni = [];
    const risposte = [
      JSON.stringify({
        action: 'filo',
        filo: { type: 'INVIA_FEEDBACK', testo: 'la barra in alto sparisce' },
        text: 'Ho mandato la segnalazione agli sviluppatori.',
        status: 'done',
      }),
      JSON.stringify({ text: 'Te l\'ho già mandata agli sviluppatori.', status: 'done' }),
    ];
    let i = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        window.__turni.push(1);
        return Promise.resolve({ ok: true, text: risposte[Math.min(i++, risposte.length - 1)] });
      }
      if (msg && (msg.type === 'filo_run_action' || msg.type === 'filo_confirm_action')) {
        window.__azioni.push(msg.action);
        // Il registro la rifiuta: non parte niente.
        return Promise.resolve({ ok: true, executed: false, kept: false });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  });
  await apriAiuto(page);

  await chiedi(page, 'manda un feedback: la barra in alto sparisce');
  // Il primo turno lo dice già: l'azione non è andata.
  expect(AVVISATO.test(await testoChat(page))).toBe(true);

  await page.fill('.sn-sidebar-input textarea', 'mandala davvero, per favore');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await page.waitForFunction(() => (window.__turni || []).length >= 2, null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Di segnalazioni ne è partita una sola, e non è andata: l'utente non può
  // restare convinto di aver segnalato.
  expect(await page.evaluate(() => window.__azioni.length)).toBe(1);
  const turni = await page.evaluate(() => window.__turni.length);
  expect(turni > 2 || AVVISATO.test(await testoChat(page))).toBe(true);
});
