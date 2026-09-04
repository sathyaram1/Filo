// #521 — «non posso leggere i blocchi di reasoning una volta che il messaggio è
// finito» + «con conversazione lunga il box dove scrivo viene tagliato».
//
// Sopra ogni risposta della chat della home c'è il blocco di attività della
// domanda: UNO per messaggio dell'utente, chiuso di default. La riga in testa
// dice cosa succede adesso (rotella e «Aspetto la risposta…», poi «Sta
// ragionando · …ultima frase», poi l'azione in corso) e a lavoro finito il
// riassunto («Ha avviato un timer · 3 s»). Un click apre la cronologia
// completa: ragionamento (tutto, non le ultime tre righe), azioni come righe
// con icona, note intermedie dei turni automatici.
//
// Ogni test asserisce il successo dal punto di vista dell'utente, e senza il
// fix sarebbe rosso:
//  (A) prima, all'arrivo della risposta l'indicatore veniva DISTRUTTO: non
//      esisteva niente da cliccare e la prima frase del ragionamento era già
//      sparita dallo schermo (restavano le ultime 3). Qui la si ritrova dopo.
//  (B) prima, senza ragionamento del modello scorrevano frasi a caso che
//      cambiavano ogni 900 ms. Qui la riga d'attesa resta ferma.
//  (C) prima, il campo di scrittura usciva dalla finestra appena cresceva.
//  (D) prima, un lavoro in due turni lasciava DUE risposte in chat (il
//      commento a metà e quella vera) e due indicatori. Qui un blocco solo.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}

const THOUGHTS = [
  'Per prima cosa interpreto la domanda dell’utente.',
  'Poi confronto le informazioni che ho a disposizione.',
  'Quindi soppeso le possibili risposte una per una.',
  'Infine scelgo la formulazione più chiara e utile.',
];

test('A — chiuso mentre ragiona con l’ultima frase in riga; a fine lavoro il riassunto; un click apre tutto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Provider finto in streaming: ragionamento a pezzi, poi la risposta con
  // un'azione TIMER (livello 1: il main la esegue davvero e la restituisce).
  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    // Stesse frasi di THOUGHTS (qui inline: il codice eseguito nel main non
    // vede le costanti del test).
    const thoughts = [
      'Per prima cosa interpreto la domanda dell’utente.',
      'Poi confronto le informazioni che ho a disposizione.',
      'Quindi soppeso le possibili risposte una per una.',
      'Infine scelgo la formulazione più chiara e utile.',
    ];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onReasoning, onDelta }) => {
      for (const t of thoughts) {
        try { onReasoning && onReasoning(t + ' '); } catch (_) {}
        await new Promise((r) => setTimeout(r, 450));
      }
      const text = JSON.stringify({
        text: 'Ecco la risposta finale.',
        actions: [{ type: 'TIMER', seconds: 300, label: 'Pasta' }],
      });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();

  // Mentre ragiona: chiuso, e la riga mostra l'ULTIMA frase del ragionamento
  // vero (non una frase di riempimento).
  const activity = page.locator('.dash-activity');
  const head = activity.locator('.dash-activity-head');
  const label = activity.locator('.dash-activity-label');
  const body = activity.locator('.dash-activity-body');
  await expect(activity).toHaveAttribute('data-phase', 'reason', { timeout: 4_000 });
  await expect(label).toContainText('Sta ragionando');
  await expect(body).toBeHidden();
  await expect(label).toContainText('soppeso le possibili risposte', { timeout: 4_000 });
  await page.screenshot({ path: 'tests/agent/.out/attivita-ragiona.png' });

  // Un click mentre lavora apre la cronologia: c'è TUTTO il ragionamento
  // arrivato finora, prima frase compresa.
  await head.click();
  await expect(body).toBeVisible();
  await expect(body).toContainText(THOUGHTS[0]);
  await expect(body).toContainText(THOUGHTS[2]);
  await page.screenshot({ path: 'tests/agent/.out/attivita-ragiona-aperto.png' });
  await head.click();
  await expect(body).toBeHidden();

  // Lavoro finito: la riga è il riassunto con la durata; il blocco resta.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la risposta finale.' })).toBeVisible({ timeout: 8_000 });
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await expect(label).toHaveText(/^Ha avviato un timer · \d+ s$/);
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();
  // Niente traccia della vecchia UI a 3 righe.
  await expect(page.locator('.dash-thinking')).toHaveCount(0);
  // L'azione non è un bottone spento sotto la risposta.
  await expect(page.locator('.dash-action-btn', { hasText: '⏱' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/agent/.out/attivita-chiuso.png' });

  // Un click riapre la cronologia PER INTERO: le quattro frasi del
  // ragionamento (la prima, la vecchia UI l'aveva già buttata via) e la riga
  // dell'azione con icona e due parole.
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();
  for (const t of THOUGHTS) await expect(body).toContainText(t);
  const row = body.locator('.dash-activity-row', { hasText: 'Timer avviato' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Pasta');
  await page.screenshot({ path: 'tests/agent/.out/attivita-aperto.png' });
  await head.click();
  await expect(body).toBeHidden();

  await app.evaluate(() => { try { globalThis.__restoreProvider?.(); } catch (_) {} });
});

test('B — senza ragionamento del modello: una riga d’attesa ferma, poi nessun residuo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      await new Promise((r) => setTimeout(r, 2500));
      const text = JSON.stringify({ text: 'Risposta senza reasoning.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();

  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveAttribute('data-phase', 'wait', { timeout: 3_000 });
  const label = activity.locator('.dash-activity-label');
  await expect(label).toHaveText('Aspetto la risposta…');
  // La riga NON cambia col tempo: prima le frasi ruotavano ogni 900 ms.
  await page.waitForTimeout(1_100);
  await expect(label).toHaveText('Aspetto la risposta…');
  await page.screenshot({ path: 'tests/agent/.out/attivita-attesa.png' });

  // Risposta arrivata senza ragionamento né azioni: il blocco non lascia niente.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta senza reasoning.' })).toBeVisible({ timeout: 6_000 });
  await expect(activity).toHaveCount(0);

  await app.evaluate(() => { try { globalThis.__restoreProvider2?.(); } catch (_) {} });
});

test('C — il campo di scrittura resta in fondo alla finestra con una conversazione lunga e più righe', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider3 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Va bene.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  // Entra in conversazione e riempila: molte bolle, più alte della finestra.
  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Va bene.' })).toBeVisible({ timeout: 8_000 });
  await page.evaluate(() => {
    const el = document.getElementById('bubbles');
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('div');
      d.className = `dash-bubble ${i % 2 ? 'dash-bubble-filo' : 'dash-bubble-user'}`;
      d.textContent = `Riga di prova numero ${i + 1}, abbastanza lunga da occupare spazio nella conversazione.`;
      el.appendChild(d);
    }
  });

  // Il campo cresce su più righe (Shift+Invio).
  const input = page.locator('#input');
  await input.click();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.type(`riga ${i + 1}`);
    await page.keyboard.press('Shift+Enter');
  }
  await page.keyboard.type('ultima riga');

  // Verità dell'utente: il campo sta dentro la finestra, tutto intero, e la
  // pagina non ha uno scroll suo (scorre la conversazione, non la pagina).
  const geo = await page.evaluate(() => {
    const wrap = document.getElementById('inputForm');
    const r = wrap.getBoundingClientRect();
    const se = document.scrollingElement;
    const bubbles = document.getElementById('bubbles');
    return {
      bottom: r.bottom, top: r.top, innerHeight: window.innerHeight,
      pageScroll: se.scrollHeight - se.clientHeight,
      threadScrolls: bubbles.scrollHeight > bubbles.clientHeight + 1,
    };
  });
  await page.screenshot({ path: 'tests/agent/.out/attivita-input-lungo.png' });
  expect(geo.bottom, 'il campo di scrittura esce dal fondo della finestra').toBeLessThanOrEqual(geo.innerHeight + 1);
  expect(geo.top).toBeGreaterThanOrEqual(0);
  expect(geo.pageScroll, 'la pagina ha preso uno scroll suo: il campo finisce sotto il bordo').toBeLessThanOrEqual(1);
  expect(geo.threadScrolls, 'è la conversazione che deve scorrere').toBe(true);

  await app.evaluate(() => { try { globalThis.__restoreProvider3?.(); } catch (_) {} });
});

test('D — un lavoro in due turni: un blocco solo, il commento a metà finisce nella cronologia, una sola risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Turno 1: ragiona, dice «Controllo cosa so fare.» e consulta il manifesto
  // (azione locale, senza rete). Il main la esegue e la chat prosegue da sola.
  // Turno 2: ragiona ancora e risponde.
  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider4 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let calls = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onReasoning, onDelta }) => {
      calls += 1;
      const first = calls === 1;
      try { onReasoning && onReasoning(first ? 'Devo controllare cosa so fare. ' : 'Ora ho il dettaglio, rispondo. '); } catch (_) {}
      await new Promise((r) => setTimeout(r, 300));
      const text = JSON.stringify(first
        ? { text: 'Controllo cosa so fare.', actions: [{ type: 'CAPACITA_DETTAGLIO', ids: ['save-for-later'] }] }
        : { text: 'Risposta finale dopo il controllo.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('cosa sai fare con i link?');
  await page.locator('#sendBtn').click();

  // In chat resta UNA risposta di Filo, quella vera.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta finale dopo il controllo.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Controllo cosa so fare.' })).toHaveCount(0);
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(1);

  // Un blocco solo per tutto il lavoro, col riassunto.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await expect(activity.locator('.dash-activity-label')).toHaveText(/^Ha verificato cosa sa fare · \d+ s$/);

  // Dentro, nell'ordine: ragionamento 1, il commento a metà (nota), l'azione,
  // ragionamento 2.
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  await expect(body.locator('.dash-activity-note', { hasText: 'Controllo cosa so fare.' })).toBeVisible();
  await expect(body.locator('.dash-activity-row', { hasText: 'Verifico cosa so fare' })).toBeVisible();
  const order = await body.evaluate((el) => Array.from(el.children).map((c) => c.className.split(' ').pop()));
  expect(order).toEqual(['dash-activity-reasoning', 'dash-activity-note', 'dash-activity-row', 'dash-activity-reasoning']);
  await page.screenshot({ path: 'tests/agent/.out/attivita-due-turni.png' });

  await app.evaluate(() => { try { globalThis.__restoreProvider4?.(); } catch (_) {} });
});
