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

// La stessa sveglia, confermata come si conferma in italiano quando la cosa
// l'ha appena nominata l'utente: col pronome. La prova dello stato copriva
// solo la frase lunga che ripete la parola «sveglia», cioè la forma meno
// probabile subito dopo la domanda.
test('la sveglia che esiste regge anche la conferma detta col pronome', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.addAlarm({ label: 'sera', time: '19:00' }));
  await installScript(app, [{ text: 'Sì, te l\'ho messa alle 19:00 come mi avevi chiesto.' }]);
  await page.locator('#input').fill('hai messo la sveglia per stasera?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(1);
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

// L'evento di calendario non si esegue da solo: Filo chiama lo strumento e in
// chat compare il bottone che preme l'utente. Filo ha fatto tutto quello che
// poteva, e veniva smentito — con la risposta buttata via e rifatta prima.
test('l\'evento proposto come bottone non fa buttare né smentire la risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'EVENTO_CALENDARIO', arguments: '{"data":"2026-09-21","ora":"10:00","titolo":"Riunione"}' }] },
    { text: 'Ti ho aggiunto l\'evento in calendario per domani alle 10.' },
  ]);
  await page.locator('#input').fill('aggiungimi al calendario la riunione di domani alle 10');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-filo').last()).toContainText('in calendario per domani');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // Due chiamate al modello, non tre: la risposta non è stata rifatta.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(2);
});

// Giro 5 della verifica. Bastava che una sveglia fosse partita UNA volta
// nella conversazione perché ogni sveglia raccontata dopo, a qualunque ora,
// passasse muta: è il caso del feedback in un turno di prosecuzione, cioè
// dove il feedback lo colloca. Adesso la prova è l'ORA: la sveglia a
// quell'ora deve esistere davvero.

test('una sveglia messa prima non copre quella raccontata adesso a un\'altra ora', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"07:00","label":"mattina"}' }] },
    { text: 'Fatto, sveglia alle 7.' },
    { text: 'Ti ho messo la sveglia alle 19:00 per stasera.' },
  ]);
  await page.locator('#input').fill('mettimi la sveglia alle 7');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#input').fill('mettimi anche la sveglia alle 19 per stasera');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  // Di sveglie ce n'è una sola, quella delle 7.
  const timers = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.map((t) => t.label)).toEqual(['mattina']);
  // Quindi l'utente legge che la sveglia delle 19 non c'è.
  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
  await expect(page.locator('.dash-bubble-avviso').last()).toContainText('la sveglia non c\'è');
});

test('«ti ho GIÀ messo la sveglia» non passa in silenzio', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Una parolina fra «ho» e il participio, e il presidio non vedeva niente:
  // niente secondo tentativo, niente avviso, niente sveglia.
  await installScript(app, [{ text: 'Ti ho già messo la sveglia alle 19 per stasera.' }]);
  await page.locator('#input').fill('mettimi una sveglia alle 19 per stasera');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(0);
  // Il turno è tornato indietro al modello, e siccome ha insistito l'utente
  // legge che la sveglia non c'è.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBeGreaterThan(1);
  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
});

test('l\'ora scritta col punto non fa smentire una sveglia che c\'è', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Filo la sveglia la mette DAVVERO, e poi la racconta scrivendo l'ora col
  // punto, che in italiano si usa quanto i due punti. Il pezzo di frase su
  // cui il presidio cercava l'ora veniva tagliato proprio lì: si leggeva
  // «alle 19», la sveglia delle 19:30 non corrispondeva, e la risposta
  // giusta veniva buttata, rifatta e poi smentita.
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'm1', name: 'SVEGLIA', arguments: '{"time":"19:30","label":"stasera"}' }] },
    { text: 'Ho messo la sveglia alle 19.30 per stasera.' },
  ]);
  await page.locator('#input').fill('mettimi la sveglia alle 19 e mezza per stasera');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  expect(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).toHaveLength(1);
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // E il turno non costa una chiamata in più al modello per rifare una
  // risposta che andava bene.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(2);
});

test('un appunto scritto prima non copre quello raccontato adesso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
  ]);
  await page.locator('#input').fill('segnami che la riunione è lunedì alle 10');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#input').fill('segnami anche la lista della spesa: pane, uova, latte');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  // Della spesa non resta traccia: l'utente deve leggerlo.
  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
});

test('una richiesta scritta come domanda non spegne il presidio', async ({ app, shell }) => {
  // In italiano una richiesta si scrive quasi sempre col punto interrogativo
  // («mi segni anche la spesa?»). Prima bastava quello perché tutto ciò che
  // era stato fatto prima nella conversazione coprisse quello che veniva
  // raccontato adesso, e il presidio tornava muto.
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
  ]);
  await page.locator('#input').fill('segnami che la riunione è lunedì alle 10');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#input').fill('mi segni anche la lista della spesa: pane, uova, latte?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
});

test('a una domanda sul già fatto Filo può rispondere di sì senza essere smentito', async ({ app, shell }) => {
  // La controprova: «l'hai salvata?» → «sì, te l'avevo già salvata» resta
  // muto, perché l'appunto in questa conversazione è stato scritto davvero.
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"pane, uova, latte","contesto":"spesa"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    { text: 'Sì, te l\'avevo già salvata negli appunti poco fa.' },
  ]);
  await page.locator('#input').fill('segnami la lista della spesa: pane, uova, latte');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#input').fill('hai salvato la lista della spesa?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
});

test('un testo incollato in chat non fa accusare Filo di non averlo letto', async ({ app, shell }) => {
  // Incollare è il modo più comune di far leggere qualcosa a Filo: il testo
  // gli arriva dentro la domanda, senza passare da nessuno strumento.
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ho letto il documento: sono 84 euro, scadenza il 12.' },
  ]);
  const bolletta = `Quanto devo pagare?\n${'FORNITURA ENERGIA ELETTRICA — dettaglio dei consumi del bimestre. '.repeat(8)}`;
  await page.locator('#input').fill(bolletta);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // E la risposta non viene buttata e rifatta con una seconda chiamata.
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

test('un documento incollato non fa accusare Filo di non averlo aperto', async ({ app, shell }) => {
  // Lo stesso fatto detto con l'altro verbo. «Aprire» è la parola più comune
  // per un documento che l'utente ha appena messo davanti a Filo, e lì non
  // c'è niente da aprire: la risposta veniva buttata, rifatta e poi smentita.
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ho aperto il contratto che hai incollato: la penale è del 5%.' },
  ]);
  const contratto = `quanto è la penale?\n${'CONDIZIONI GENERALI DI FORNITURA — consegna entro trenta giorni dall\'ordine. '.repeat(8)}`;
  await page.locator('#input').fill(contratto);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

test('dopo «Fallo adesso» la stessa cosa mai fatta non diventa muta', async ({ app, shell }) => {
  // Il tasto che Filo offre per rimediare portava dentro l'ultimo buco: il
  // modello ripete la stessa cosa con un «già» davanti, e un appunto scritto
  // prima nella conversazione tornava a coprirla.
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
    { text: 'Te l\'ho già salvato l\'appunto con la lista della spesa.' },
  ]);

  await page.locator('#input').fill('segnami che la riunione è lunedì alle 10');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#input').fill('segnami anche la lista della spesa: pane, uova, latte');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);

  await page.getByRole('button', { name: /Fallo adesso/ }).last().click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(2);
});

test('un testo sistemato dentro la risposta non viene buttato né smentito', async ({ app, shell }) => {
  // La conferma col pronome non dice di cosa parla: a dirlo è la richiesta.
  // Qui l'utente ha chiesto di sistemare un testo, e il testo è nella
  // risposta. Prima la risposta veniva cancellata, rifatta con una seconda
  // chiamata al modello e poi smentita, col tasto «Fallo adesso» per una
  // cosa che Filo aveva fatto.
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ecco la frase senza quella parola:\n\nIl gatto dorme sul divano.\n\nTe l\'ho tolta.' },
  ]);
  await page.locator('#input').fill('nella frase «il gatto grigio dorme sul divano» togli la parola grigio');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Il gatto dorme sul divano');
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});

test('la conferma più corta non diventa muta dopo una cosa fatta prima', async ({ app, shell }) => {
  // «Appunto salvato.» dopo un appunto scritto all'inizio della
  // conversazione passava senza una parola, mentre la stessa cosa detta per
  // esteso veniva vista. È il turno di prosecuzione della segnalazione.
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto.' },
    { text: 'Appunto salvato.' },
    { text: 'Appunto salvato.' },
  ]);

  await page.locator('#input').fill('segnami che la riunione è lunedì alle 10');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  await page.locator('#input').fill('segnami anche la lista della spesa: pane, uova, latte');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});

test('una richiesta detta senza nominare la cosa non spegne il presidio', async ({ app, shell }) => {
  // In italiano un promemoria si chiede quasi sempre senza nominarlo. Finché
  // la promessa doveva farsi riconoscere dalle parole dell'utente, «te l'ho
  // segnato» dopo «non farmelo dimenticare» tornava muto come prima del
  // lavoro: nessun appunto, nessun ritentativo, niente sotto la risposta.
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Te l\'ho segnato, così domani te lo ricordo.' },
    { text: 'Te l\'ho segnato, così domani te lo ricordo.' },
  ]);
  await page.locator('#input').fill('domani devo chiamare il dentista, non farmelo dimenticare');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);
});

test('un documento incollato non fa accusare Filo di non aver preso nota', async ({ app, shell }) => {
  // L'utente incolla un contratto e chiede cosa conta: Filo glielo scrive
  // nella risposta. «Ti ho segnato i punti principali» faceva cancellare la
  // risposta, rifarla con una seconda chiamata al modello e poi smentirla.
  // Nel documento incollato può esserci qualunque parola («si rinnova salvo
  // disdetta»): la richiesta è quella dell'utente, non il testo di altri.
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Le cose che contano sono tre:\n\n- la penale è del 5%\n- il preavviso è di 30 giorni\n- il rinnovo è automatico\n\nTi ho segnato i punti principali.' },
  ]);
  const contratto = `leggi questo contratto e dimmi cosa c'è di importante:\n\n${
    'Articolo 1. Il presente contratto ha durata annuale e si rinnova tacitamente salvo disdetta. '
    + 'Articolo 2. Il recesso anticipato comporta una penale pari al cinque per cento del corrispettivo residuo. '
    + 'Articolo 3. La disdetta va comunicata con un preavviso di almeno trenta giorni dalla scadenza. '
    + 'Articolo 4. Il foro competente per ogni controversia è quello della sede del fornitore. '
    + 'Articolo 5. Le parti si impegnano alla riservatezza su ogni informazione scambiata.'}`;
  await page.locator('#input').fill(contratto);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(1);
});
