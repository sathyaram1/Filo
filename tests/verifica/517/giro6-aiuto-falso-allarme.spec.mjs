// Verifica #517 — giro 6, dal punto di vista dell'utente, sull'altra chat.
//
// Il giro 5 ha portato il presidio dentro l'Aiuto (il pannello che si apre
// sulla pagina). Lì però lo stato di Filo non viene guardato mai: la prova
// che una sveglia esiste è vuota per definizione, e l'ORA decide comunque.
// Risultato: nell'Aiuto ogni frase che nomina un'ora viene smentita, anche
// quando la sveglia c'è — anche quando l'ha messa l'Aiuto stesso un
// messaggio prima.
//
// È il rovescio esatto della porta chiusa nella chat della home al giro 3
// («la sveglia che esiste davvero regge la frase che la racconta»), e vale la
// stessa cosa: quando il presidio parla deve avere ragione, altrimenti si
// smette di leggerlo e torna a essere muto.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

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

test('la sveglia che esiste davvero non viene smentita nell\'Aiuto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  // La sveglia delle 19 c'è: messa ieri, o dalla chat della home. L'Aiuto lo
  // stato non lo guardava mai, quindi la frase che la racconta era un'accusa.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addAlarm({ label: 'sera', time: '19:00' }));
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({ text: 'Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.', status: 'done' }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'hai messo la sveglia per stasera?', 1);

  // La frase è vera: sotto non ci deve essere nessuna accusa…
  const testo = await testoChat(page);
  expect(testo).not.toMatch(/non l'ha fatto|non è partito niente|la sveglia non c'è/i);
  // …e la risposta non deve essere buttata e rifatta con un'altra chiamata.
  expect(await page.evaluate(() => window.__turni.length)).toBe(1);
});

test('nell\'Aiuto una sveglia raccontata senza ora e mai messa resta vista', async ({ openTab }) => {
  // Il controprova: chiudendo il falso allarme il presidio deve restare
  // acceso sul caso della segnalazione.
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({ text: 'Ti ho messo una sveglia alle 19:00 per stasera.', status: 'done' }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'mettimi una sveglia alle 19 per stasera', 1);

  expect(await page.evaluate(() => window.__azioni.length)).toBe(0);
  const turni = await page.evaluate(() => window.__turni.length);
  const testo = await testoChat(page);
  const avvisato = /non l'ha fatto|non è partito|non ha eseguito|la sveglia non c'è/i.test(testo);
  expect(turni > 1 || avvisato).toBe(true);
});

test('nell\'Aiuto l\'avviso offre lo stesso tasto della chat della home', async ({ openTab }) => {
  // Nella chat della home, sotto l'avviso, c'è un tasto che rimanda la
  // richiesta da solo: Filo sa già cosa era rimasto senza azione. Qui
  // l'avviso lascia all'utente il lavoro di riscriverla.
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  await agenteASequenza(page, [
    JSON.stringify({ text: 'Ti ho messo una sveglia alle 19:00 per stasera.', status: 'done' }),
  ]);
  await apriAiuto(page);
  await page.evaluate(() => { window.__turni = []; window.__azioni = []; });

  await chiedi(page, 'mettimi una sveglia alle 19 per stasera', 1);
  await page.waitForSelector('.sn-sidebar-msg-avviso', { timeout: 10_000 });

  const tasti = await page.evaluate(() => Array.from(
    document.querySelectorAll('.sn-sidebar-chat button'),
  ).map((b) => (b.textContent || '').trim()).filter(Boolean));
  expect(tasti.some((t) => /fallo adesso|rifallo|riprova/i.test(t))).toBe(true);
});
