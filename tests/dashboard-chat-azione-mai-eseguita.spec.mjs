// #517 — «Azione raccontata a parole e mai eseguita: fallimento muto».
//
// Il modello chiude il turno con «Ti ho messo una sveglia alle 19:00» e non
// chiama nessuno strumento. Prima: il testo arrivava all'utente, la sveglia no,
// e nessuno se ne accorgeva. Adesso:
//   (A) la risposta torna indietro al modello una volta — se chiama l'azione,
//       l'utente non vede nessun avviso e la sveglia c'è davvero;
//   (B) se il modello insiste con la stessa frase, sotto la risposta compare
//       scritto che la sveglia non c'è.
//
// Senza il presidio (A) fallisce sulla sveglia mancante e (B) sull'avviso che
// non compare.

import { test, expect } from './fixtures/electron.mjs';

const FRASE = 'Ti ho messo una sveglia alle 19:00 per ognuna di quelle notti';

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
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Provider a copione: un elemento per giro ({ text, toolCalls }); le richieste
// ricevute finiscono in globalThis.__captured.
async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    globalThis.__captured = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)) });
      await new Promise((r) => setTimeout(r, 40));
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: step.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, script);
}

test('la sveglia raccontata e mai chiamata torna indietro: al secondo giro esiste davvero', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: `${FRASE}, buonanotte!` },                       // dichiarata e basta
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"19:00","label":"sera"}' }] },
    { text: 'Ecco, adesso la sveglia delle 19:00 c\'è.' },
  ]);
  await page.locator('#input').fill('mettimi una sveglia alle 19 per stasera');
  await page.locator('#sendBtn').click();

  // SUCCESSO dal punto di vista dell'utente: la sveglia esiste.
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toEqual(['sera']);
  // Niente avviso: l'azione è stata fatta.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // La risposta in chat è quella rifatta, non la frase rimangiata.
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('adesso la sveglia delle 19:00');
  // Il modello ha ricevuto il motivo del rimbalzo, con la sua stessa frase.
  const spinta = await app.evaluate(() => {
    const ultima = globalThis.__captured[1];
    return ultima.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  });
  expect(spinta).toContain(FRASE);
  expect(spinta).toContain('non hai chiamato nessuno strumento');
});

test('se il modello insiste, l\'utente legge che la sveglia non c\'è', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [{ text: `${FRASE}, buonanotte!` }]); // insiste, uguale
  await page.locator('#input').fill('mettimi una sveglia alle 19 per stasera');
  await page.locator('#sendBtn').click();

  const avviso = page.locator('.dash-bubble-avviso');
  await expect(avviso).toBeVisible({ timeout: 25_000 });
  await expect(avviso).toContainText('la sveglia non c\'è');
  await expect(avviso).toContainText('chiediglielo di nuovo');
  // La risposta resta leggibile: l'avviso la corregge, non la nasconde.
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ti ho messo una sveglia');
  // E di sveglie non ne esiste nessuna: è proprio il punto.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers).toHaveLength(0);
  // Il rimbalzo è UNO: due chiamate al modello, non un ciclo.
  const giri = await app.evaluate(() => globalThis.__captured.length);
  expect(giri).toBe(2);
});

test('una risposta onesta non fa comparire nessun avviso', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [{ text: 'Non ho messo nessuna sveglia: dimmi tu a che ora la vuoi.' }]);
  await page.locator('#input').fill('mi serve una sveglia');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo').last()).toContainText('dimmi tu a che ora', { timeout: 25_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // Una sola chiamata: nessun rimbalzo su una risposta che non dichiara niente.
  const giri = await app.evaluate(() => globalThis.__captured.length);
  expect(giri).toBe(1);
});

// Il formato macchina in CODA alla risposta: la frase per l'utente davanti, la
// chiamata lasciata scritta sotto invece che fatta. Guardando solo l'inizio del
// testo il turno passava intero — niente ritentativo, niente avviso, e la
// sveglia che non suona. Senza il fix questo test è rosso su tutte e tre le
// asserzioni: una sola chiamata al modello, nessuna sveglia, nessuna riga.
test('la chiamata lasciata scritta DOPO la frase torna indietro come le altre', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ti metto una sveglia alle 19:00 per stasera.\n\nSVEGLIA{"time":"19:00","label":"sera"}' },
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"19:00","label":"sera"}' }] },
    { text: 'Ecco, la sveglia delle 19:00 adesso c\'è.' },
  ]);
  await page.locator('#input').fill('mettimi una sveglia alle 19 per stasera');
  await page.locator('#sendBtn').click();

  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toEqual(['sera']);
  await expect(page.locator('.dash-bubble-filo').last()).not.toContainText('SVEGLIA{');
  // La risposta cancellata a metà non sparisce senza una parola: nel blocco di
  // lavoro resta scritto che è stata rifatta.
  await expect(page.locator('.dash-activity-row')).toContainText(['Risposta rifatta']);
});

// Quando il ritentativo sul formato non basta, l'utente deve sapere che lì
// dentro non è successo niente: prima era l'unico dei due guasti a finire in
// silenzio, con un blocco di codice in chat e nient'altro.
test('il formato macchina ripetuto lascia all\'utente una riga e un tasto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [{ text: 'SVEGLIA{"time":"19:00","label":"sera"}' }]);
  await page.locator('#input').fill('mettimi una sveglia alle 19 per stasera');
  await page.locator('#sendBtn').click();

  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  const avviso = page.locator('.dash-bubble-avviso');
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await expect(avviso).toContainText('non è stato fatto');
  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(0);
  // E il tasto che rifà la richiesta al posto dell'utente.
  await expect(page.locator('.dash-bubble-actions button')).toContainText(['Fallo adesso']);
});

// Filo apre un programma con un comando di shell — è la strada vera — e poi lo
// racconta. L'avviso non deve smentirlo: un avviso che sbaglia si smette di
// leggere, e il presidio torna muto.
test('un\'apertura fatta con un comando non viene smentita all\'utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      terminal: { enabled: true },
    });
  });
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo apro il blocco note"}' }] },
    { text: 'Ho aperto il blocco note.' },
  ]);
  await page.locator('#input').fill('aprimi il blocco note');
  await page.locator('#sendBtn').click();

  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // Due chiamate e basta: nessun rimbalzo su una frase che era vera.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(2);
});

// Giro 2 della verifica. Il presidio taceva anche quando lo strumento era
// stato chiamato ma non aveva fatto nascere niente, e parlava quando non
// doveva: la risposta che l'utente aveva chiesto veniva buttata, rifatta e poi
// smentita.

test('una sveglia chiamata ma non riuscita non copre la frase che la dà per fatta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Lo strumento parte con un orario che Filo non sa leggere: nessuna sveglia
  // nasce. Poi il modello la racconta lo stesso.
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'k1', name: 'SVEGLIA', arguments: '{"time":"quando fa buio","label":"sera"}' }] },
    { text: FRASE + '.' },
  ]);
  await page.locator('#input').fill('mettimi una sveglia per stasera');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(0);
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});

test('la risposta che Filo SCRIVE non viene buttata via né smentita', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // La cosa chiesta è il testo, e il testo è nella risposta: non esiste
  // nessuno strumento che possa averlo scritto.
  await installScript(app, [
    { text: "Te l'ho scritta qui sotto:\n\nGentile Marco, ti chiedo scusa per il ritardo di ieri." },
  ]);
  await page.locator('#input').fill('scrivimi una mail di scuse per il ritardo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Gentile Marco');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // Una chiamata sola: la risposta era già buona, e rifarla costa un giro e
  // fa sparire da sotto gli occhi quella che l'utente stava leggendo.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

test('una sveglia messa in una sessione precedente resta una sveglia messa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'sera', time: '19:00', repeat: ['lun', 'mar', 'mer'] });
  });
  await installScript(app, [{ text: 'Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.' }]);
  await page.locator('#input').fill('hai messo la sveglia per stasera?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});
