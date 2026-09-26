// Verifica #536 giro 10 — la riga che l'utente legge al posto dell'avviso, e
// la coda quando il guardiano non ha un modello suo.
//
// La riga di blocco esiste per rassicurare: il motivo lo sceglie ormai Filo fra
// le sue chiavi, ma il MITTENTE lo scrive chi manda la mail. Qui si guarda se
// da quel campo può passare un recapito.
//
// E: senza un modello per il guardiano ogni avviso resta in coda. Si guarda se
// chi aspetta può capire che non è la rete, ma una casella da riempire.

import { test, expect } from './../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function prepara(app, { guardiano = 'claude, gemma-lite' } = {}) {
  await app.evaluate(async (_e, guardiano) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.NOTICE_GUARD]: guardiano,
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: '{"passa":true,"motivo":null}',
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, guardiano);
}

function proponi(dash, testo, fonte) {
  return dash.evaluate(async ({ testo, fonte }) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({
      type: MSG.FILO_AVVISO_PROPOSTO, testo, fonte, classe: 'messaggio',
      richiesta: 'avvisami delle mail importanti', modelloProduttore: 'deepseek-flash',
    });
  }, { testo, fonte });
}

test('il nome del mittente non consegna un recapito dentro la riga di blocco', async ({ app, openTab }) => {
  await prepara(app);
  const dash = await openTab(NEWTAB);

  // Il mittente lo sceglie chi manda la mail: qui ci ha messo una frase e un
  // numero verde. Il blocco scatta dai controlli statici (c'è un codice di
  // verifica), quindi nessun modello viene consultato.
  const r = await proponi(
    dash,
    'La tua banca chiede di confermare: il codice di verifica è 483920.',
    'Assistenza Banca — chiama subito lo 800 123 456',
  );
  expect(r.esito).toBe('blocca');

  const card = dash.locator('.dash-live-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  const riga = await card.locator('.dash-live-text').textContent();
  expect(riga, 'la riga di blocco riporta il numero scritto dal mittente')
    .not.toContain('800 123 456');
  try { await dash.screenshot({ path: 'tests/.shots/verifica-536-giro10-riga-blocco.png' }); } catch (_) {}
});

test('senza un modello per il guardiano l\'attesa dice cosa manca', async ({ app, openTab }) => {
  await prepara(app, { guardiano: '' });
  const dash = await openTab(NEWTAB);

  const r = await proponi(dash, 'Tre mail nuove da leggere.', 'posta@example.invalid');
  expect(r.esito).toBe('attesa');

  const card = dash.locator('.dash-live-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });

  // «Controlla adesso» è l'unica strada offerta a chi aspetta: premuto una
  // volta deve cambiare qualcosa, o dire perché non può.
  await card.locator('button', { hasText: 'Controlla adesso' }).click();
  await dash.waitForTimeout(1000);
  const testo = await card.locator('.dash-live-text').textContent();
  expect(testo, 'l\'attesa senza modello è indistinguibile da una rete giù')
    .toMatch(/modello|impostazion|Opzioni/i);
});

test('dalla riga «ho fermato un avviso» si arriva a vedere cosa è stato fermato', async ({ app, openTab }) => {
  await prepara(app);
  const dash = await openTab(NEWTAB);
  const r = await proponi(
    dash,
    'Conferma il conto: il codice di verifica è 483920.',
    'servizio@banca-esempio.invalid',
  );
  expect(r.esito).toBe('blocca');

  const card = dash.locator('.dash-live-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  // Chi ha appena letto che Filo gli ha nascosto qualcosa vuole vedere cos'era:
  // deve poterci arrivare da lì, non sapendo per conto suo che c'è una voce
  // nelle Preferenze.
  await expect(card.locator('button').filter({ hasNotText: '×' })).toHaveCount(1);
});

test('la coda non perde un avviso che sta ancora aspettando il controllo', async ({ app, openTab }) => {
  await prepara(app, { guardiano: '' });
  await openTab(NEWTAB);

  const ancoraLi = await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const atteso = await M.addNotification({
      text: 'Tua sorella scrive del regalo di papà.',
      classe: 'messaggio', guardiano: { esito: 'attesa' },
    });
    // Un uso normale di qualche settimana: gli avvisi nuovi si accumulano e
    // quelli letti restano in magazzino.
    for (let i = 0; i < 120; i++) await M.addNotification({ text: `aggiornamento ${i}` });
    const tutte = await M.listNotifications(true);
    return tutte.some((n) => n.id === atteso.id);
  });
  expect(ancoraLi, 'l\'avviso in attesa del controllo è sparito senza dirlo a nessuno').toBe(true);
});
