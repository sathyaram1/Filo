// Strumenti nativi nella chat della home: il modello chiama le azioni come
// tool calling, il main le esegue e lo richiama con gli esiti NELLO STESSO
// TURNO, e la scheda racconta tutto in diretta nel blocco di attività.
//
// Prima (JSON nel testo): «cerco, poi rispondo» costava un turno automatico
// per passo, il testo doveva venire prima delle azioni, e il modello chiudeva
// il turno annunciando cosa avrebbe fatto («appena tornano i risultati…»).
//
// Ogni test asserisce il successo dal punto di vista dell'utente, e senza il
// fix sarebbe rosso:
//  (A) un turno solo: due azioni chiamate come strumenti, gli esiti tornano
//      al modello (messaggi `tool` con `tool_call_id`, ragionamento
//      rimandato), la risposta finale è UNA bolla; il testo scritto a metà
//      lavoro è una nota nel blocco, le azioni sono righe nel blocco, e il
//      timer esiste davvero. Prima: con `toolCalls` nella risposta del
//      provider il main non eseguiva niente (leggeva solo il testo).
//  (B) un'azione di livello 2 chiamata come strumento apre il popup di
//      conferma; se il giro ha anche un esito da leggere, quello «in attesa
//      di conferma» torna al modello, che risponde con quello in mano (da
//      sola chiude il turno col pulsante: chat-comandi-secchi.spec.mjs).
//  (C) il modello nomina un'azione: la riga in testa lo dice PRIMA che gli
//      argomenti siano arrivati.

import { test, expect } from './fixtures/electron.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';

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

// Il turno di (A): un primo giro che ragiona, scrive una nota e chiama due azioni, un secondo che ragiona e risponde.
async function giroCercaAgisce(app) {
  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onReasoning, onDelta, onToolCall }) => {
      const n = globalThis.__calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools: (tools || []).map((t) => t.function.name) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onReasoning && onReasoning('Serve un timer e una verifica. '); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
        const nota = 'Avvio il timer e controllo cosa so fare.';
        try { onDelta && onDelta(nota); } catch (_) {}
        try { onToolCall && onToolCall({ id: 'c1', name: 'TIMER' }); } catch (_) {}
        try { onToolCall && onToolCall({ id: 'c2', name: 'CAPACITA_DETTAGLIO' }); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
        return {
          ...base, text: nota,
          toolCalls: [
            { id: 'c1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
            { id: 'c2', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
          ],
          reasoningDetails: [{ type: 'reasoning.text', text: 'Serve un timer e una verifica.' }],
          finishReason: 'tool_calls',
        };
      }
      try { onReasoning && onReasoning('Ora rispondo. '); } catch (_) {}
      const finale = 'Fatto: timer di 5 minuti avviato.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
}

// Il turno di (A) finito, col blocco srotolato.
async function bloccoDelGiro(page) {
  // La risposta finale è l'unica bolla di Filo: la nota a metà lavoro non è
  // rimasta in chat.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto: timer di 5 minuti avviato.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Avvio il timer e controllo' })).toHaveCount(0);

  // Un blocco solo, chiuso, col riassunto di tutto il lavoro.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await expect(activity.locator('.dash-activity-label')).toHaveText(/^Ha avviato un timer e verificato cosa sa fare · \d+ s$/);

  // Dentro, nell'ordine: il nodo del primo giro (ragionamento, nota di lavoro,
  // righe delle due azioni chiamate insieme), poi la coda col ragionamento del
  // secondo giro (#578: due strumenti insieme fanno un nodo solo).
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  await expect(body.locator('.dash-activity-note')).toHaveText('Avvio il timer e controllo cosa so fare.');
  const timerRow = body.locator('.dash-activity-row', { hasText: 'Timer avviato' });
  await expect(timerRow).toHaveCount(1);
  await expect(timerRow).toContainText('Pasta');
  await expect(body.locator('.dash-activity-row', { hasText: 'Verifico cosa so fare' })).toHaveCount(1);
  await expect(body).toContainText('Serve un timer e una verifica.');
  await expect(body).toContainText('Ora rispondo.');
  const segs = await body.evaluate((el) => Array.from(el.children).map((c) => c.dataset.stato));
  expect(segs).toEqual(['agisce', 'coda']);
  await expect(activity.locator('.dash-activity-nodo')).toHaveCount(1);
  await expect(activity.locator('.dash-activity-seg-head').first()).toHaveText('2 azioni · timer, capacità');
  const nodo = body.locator('.dash-activity-seg').first().locator('.dash-activity-seg-body');
  const order = await nodo.evaluate((el) => Array.from(el.children).map((c) => c.className.split(' ').find((k) => k.startsWith('dash-activity-'))));
  expect(order).toEqual(['dash-activity-reasoning', 'dash-activity-note', 'dash-activity-esiti']);
  expect(await nodo.locator('.dash-activity-esiti > .dash-activity-row').count()).toBe(2);
  await expect(body.locator('.dash-activity-seg[data-stato="coda"]')).toContainText('Ora rispondo.');
}

test('A — cerca, agisce e risponde in un turno solo; note e azioni nel blocco, una bolla sola', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await giroCercaAgisce(app);

  await page.locator('#input').fill('metti un timer per la pasta e dimmi se sai salvare per dopo');
  await page.locator('#sendBtn').click();
  await bloccoDelGiro(page);
  await page.screenshot({ path: 'tests/agent/.out/strumenti-aperto.png' });

  // Al modello sono tornati gli esiti nello stesso turno, nella forma del
  // fornitore: il suo messaggio con le chiamate e il ragionamento, poi un
  // messaggio `tool` per chiamata.
  const calls = await app.evaluate(() => globalThis.__calls);
  expect(calls.length).toBe(2);
  expect(calls[0].tools).toContain('CERCA_WEB');
  expect(calls[0].tools).toContain('TIMER');
  const sys = calls[0].messages[0];
  expect(sys.role).toBe('system');
  expect(sys.content).not.toContain('"actions"');
  const m = calls[1].messages;
  const assistant = m[m.length - 3];
  expect(assistant.role).toBe('assistant');
  expect(assistant.tool_calls.map((c) => c.function.name)).toEqual(['TIMER', 'CAPACITA_DETTAGLIO']);
  expect(assistant.reasoning_details[0].text).toBe('Serve un timer e una verifica.');
  expect(m[m.length - 2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  expect(m[m.length - 2].content).toMatch(/timer/i);
  expect(m[m.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'c2' });
  expect(m[m.length - 1].content).toContain('[Dettaglio delle capacità');

  // Il timer esiste davvero.
  const timers = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
  expect(timers).toContain('Pasta');

  await app.evaluate(() => { try { globalThis.__restoreProvider?.(); } catch (_) {} });
});

// #1321 — Con la scheda occupata, la risposta del turno le arrivava prima degli eventi in diretta ancora in coda: la
// chat chiudeva la diretta e li buttava, e il blocco perdeva la nota e l'ultimo pensiero. Qui lo si fa succedere apposta.
test('A2 — la risposta arriva prima degli ultimi eventi in diretta: nota e ultimo pensiero restano nel blocco', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await giroCercaAgisce(app);

  // Dalla fine del primo giro il main trattiene gli eventi in diretta verso la home; la risposta invece parte.
  await app.evaluate(({ ipcMain, webContents }) => {
    const home = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://newtab'));
    const manda = home.send.bind(home);
    const trattenuti = [];
    home.send = (canale, ...args) => {
      if (globalThis.__trattieni && /^filo:(reasoning|answer|action)$/.test(canale)) trattenuti.push([canale, args]);
      else manda(canale, ...args);
    };
    globalThis.__consegna = () => { globalThis.__trattieni = false; for (const [c, a] of trattenuti.splice(0)) manda(c, ...a); };
    const finto = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    let giri = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      const r = await finto(o);
      if (++giri === 1) globalThis.__trattieni = true;
      return r;
    };
    const gestore = ipcMain._invokeHandlers.get('filo:message');
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const r = await gestore(event, msg);
      if (msg && msg.type === globalThis.SN_MSG.MSG.FILO_CHAT) globalThis.__rispostaPartita = true;
      return r;
    });
  });

  await page.locator('#input').fill('metti un timer per la pasta e dimmi se sai salvare per dopo');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => !!globalThis.__rispostaPartita), { timeout: 20_000 }).toBe(true);
  // Le risposte arrivano alla scheda nell'ordine in cui partono: quando torna questa, quella del turno è già arrivata.
  await page.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GET_TIMERS }, ok)));
  await app.evaluate(() => globalThis.__consegna());

  await bloccoDelGiro(page);
  await page.screenshot({ path: 'tests/.shots/strumenti-diretta-in-ritardo.png' });
});

test('B —un\'azione che chiede, chiamata come strumento, apre la conferma, e il modello risponde sapendolo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // A Conservativo il costo 2 chiede anche a compito pulito (#530).
  await livelloAutonomia(app, 'conservativo');

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls2 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__calls2.push({ messages: JSON.parse(JSON.stringify(messages)) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 'f1', name: 'INVIA_FEEDBACK' }); } catch (_) {}
        try { onToolCall && onToolCall({ id: 'f2', name: 'CAPACITA_DETTAGLIO' }); } catch (_) {}
        return {
          ...base, text: '',
          toolCalls: [
            { id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' },
            { id: 'f2', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
          ],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      const finale = 'Ti ho preparato la segnalazione: conferma e parte.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('segnala che il timer non suona');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti ho preparato la segnalazione' })).toBeVisible({ timeout: 10_000 });
  // Il popup di conferma si apre da sé (vive in uno shadow root chiuso: si
  // vede l'host), e il bottone di ripiego sotto la risposta dice cosa parte.
  await expect(page.locator('.sn-confirm-host')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.dash-action-btn', { hasText: 'Inviare questo feedback' })).toBeVisible();
  await page.screenshot({ path: 'tests/agent/.out/strumenti-conferma.png' });

  const calls = await app.evaluate(() => globalThis.__calls2);
  expect(calls.length).toBe(2);
  const m = calls[1].messages;
  expect(m[m.length - 2]).toMatchObject({ role: 'tool', tool_call_id: 'f1' });
  expect(m[m.length - 2].content).toMatch(/In attesa della conferma/);
  expect(m[m.length - 2].content).toMatch(/NON richiamare/);

  await app.evaluate(() => { try { globalThis.__restoreProvider2?.(); } catch (_) {} });
});

test('D — un\'azione eseguita senza bottone in chat torna al modello come eseguita; la sveglia tolta ha la sua riga; chiamate senza id', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Uovo', seconds: 600 }); });

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider4 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls4 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__calls4.push({ messages: JSON.parse(JSON.stringify(messages)) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        // Il fornitore non manda gli id delle chiamate.
        try { onToolCall && onToolCall({ id: '', name: 'IMPOSTA_PREFERENZA' }); } catch (_) {}
        try { onToolCall && onToolCall({ id: '', name: 'CANCELLA_SVEGLIA' }); } catch (_) {}
        // Una lettura nel giro: senza, due comandi secchi riusciti chiuderebbero il turno (#1130).
        try { onToolCall && onToolCall({ id: '', name: 'CAPACITA_DETTAGLIO' }); } catch (_) {}
        return {
          ...base, text: '',
          toolCalls: [
            { id: '', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' },
            { id: '', name: 'CANCELLA_SVEGLIA', arguments: '{"etichetta":"Uovo"}' },
            { id: '', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
          ],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      const finale = 'Tema scuro, e ho tolto il timer dell\'uovo.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('metti il tema scuro e togli il timer dell\'uovo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Tema scuro, e ho tolto' })).toBeVisible({ timeout: 10_000 });

  // Al modello: il tema risulta ESEGUITO (non c'è niente da mostrare in
  // chat, ma è andata a buon fine), la sveglia risulta TOLTA, e le risposte
  // agli strumenti citano gli stessi id delle chiamate.
  const calls = await app.evaluate(() => globalThis.__calls4);
  expect(calls.length).toBe(2);
  const m = calls[1].messages;
  const assistant = m[m.length - 4];
  const ids = assistant.tool_calls.map((c) => c.id);
  expect(ids.every((id) => id)).toBe(true);
  expect(m[m.length - 3].tool_call_id).toBe(ids[0]);
  expect(m[m.length - 2].tool_call_id).toBe(ids[1]);
  expect(m[m.length - 1].tool_call_id).toBe(ids[2]);
  expect(m[m.length - 3].content).toMatch(/^Eseguita/);
  expect(m[m.length - 3].content).not.toMatch(/NON eseguita/);
  expect(m[m.length - 2].content).toMatch(/^Tolte:\n<<<TESTO_SALVATO>>>\n.*Uovo/);

  // La riga della sveglia tolta c'è, una volta sola; il timer non c'è più.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await expect(activity.locator('.dash-activity-label')).toContainText('cancellato una sveglia');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-row', { hasText: 'Cancellata' })).toHaveCount(1);
  await expect(activity.locator('.dash-activity-row', { hasText: 'Uovo' })).toHaveCount(1);
  const timers = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
  expect(timers).not.toContain('Uovo');

  await app.evaluate(() => { try { globalThis.__restoreProvider4?.(); } catch (_) {} });
});

test('E — un modello che chiama azioni senza mai rispondere viene fermato, la chat dice dopo quanti passi e «Continua» riparte da lì', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider5 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls5 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const n = globalThis.__calls5.push(messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'));
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n > 12) {
        try { onDelta && onDelta('Ecco quello che ho trovato.'); } catch (_) {}
        return { ...base, text: 'Ecco quello che ho trovato.', toolCalls: [], finishReason: 'stop' };
      }
      try { onDelta && onDelta('ancora…'); } catch (_) {}
      return {
        ...base, text: 'ancora…', finishReason: 'tool_calls',
        toolCalls: [{ id: `k${n}`, name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' }],
      };
    };
  });

  await page.locator('#input').fill('non finire mai');
  await page.locator('#sendBtn').click();
  const bubble = page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato' });
  await expect(bubble).toBeVisible({ timeout: 30_000 });
  await expect(bubble).toContainText('Mi sono fermato dopo 12 passi senza arrivare a una risposta.');
  expect(await app.evaluate(() => globalThis.__calls5.length)).toBe(12);
  const continua = bubble.locator('.dash-continua');
  await expect(continua).toHaveText('Continua');
  // La stessa offerta di un turno fermato: il tasto d'invio riprende anche lui.
  await expect(page.locator('#sendBtn')).toHaveAttribute('data-modo', 'riprendi');
  await page.screenshot({ path: 'tests/.shots/chat-senza-risposta-continua.png' });

  await continua.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco quello che ho trovato.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(0);
  await expect(page.locator('#sendBtn')).toHaveAttribute('data-modo', 'invia');
  // Il giro riparte sapendo cosa ha già fatto, con la sua frase davanti.
  const ultimo = await app.evaluate(() => globalThis.__calls5[12]);
  expect(ultimo).toContain('Mi sono fermato dopo 12 passi');
  expect(ultimo).toContain('continuare il lavoro che si era fermato');

  await app.evaluate(() => { try { globalThis.__restoreProvider5?.(); } catch (_) {} });
});

test('F — nove ricerche e poi niente: la chat dice che si è fermato con «Continua»; un messaggio nuovo lo toglie, un timer muto no', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origWS = globalThis.SN_WEB_SEARCH;
    globalThis.__restoreProvider6 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; globalThis.SN_WEB_SEARCH = origWS; };
    globalThis.SN_WEB_SEARCH = { search: async ({ query }) => ({ provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'testo' }] }) };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [], text: '' };
      if (n <= 9) return { ...base, finishReason: 'tool_calls', toolCalls: [{ id: `w${n}`, name: 'CERCA_WEB', arguments: JSON.stringify({ query: `orari treni ${n}` }) }] };
      if (n === 11) return { ...base, finishReason: 'tool_calls', toolCalls: [{ id: 't11', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"Pasta"}' }] };
      return { ...base, toolCalls: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('a che ora parte il treno?');
  await page.locator('#sendBtn').click();
  const fermo = page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato' });
  await expect(fermo).toHaveText(/Mi sono fermato dopo 9 passi senza arrivare a una risposta\./, { timeout: 30_000 });
  await expect(page.locator('.dash-activity .dash-activity-label').first()).toHaveText(/^Ha cercato sul web 9 volte/);
  await expect(fermo.locator('.dash-continua')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: 'tests/.shots/chat-senza-risposta-scuro.png' });

  // Scrivere altro chiude l'offerta; un turno di sole azioni che non dice niente resta senza bolla.
  await page.locator('#input').fill('lascia stare, metti un timer per la pasta');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-continua')).toHaveCount(0);
  await expect(page.locator('.dash-activity .dash-activity-label').nth(1)).toHaveText(/^Ha avviato un timer/, { timeout: 10_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato' })).toHaveCount(1);

  await app.evaluate(() => { try { globalThis.__restoreProvider6?.(); } catch (_) {} });
});

test('G — ricerche annunciate e poi silenzio: la frase di lavoro non passa per risposta, la bolla dice che si è fermato e offre «Continua»', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origWS = globalThis.SN_WEB_SEARCH;
    globalThis.__restoreProvider7 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; globalThis.SN_WEB_SEARCH = origWS; };
    globalThis.SN_WEB_SEARCH = { search: async ({ query }) => ({ provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'testo' }] }) };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n <= 3) {
        const text = `Cerco ancora gli orari, giro ${n}…`;
        try { onDelta && onDelta(text); } catch (_) {}
        return { ...base, text, finishReason: 'tool_calls', toolCalls: [{ id: `g${n}`, name: 'CERCA_WEB', arguments: JSON.stringify({ query: `orari treni ${n}` }) }] };
      }
      if (n === 4) return { ...base, text: '', toolCalls: [], finishReason: 'stop' };
      try { onDelta && onDelta('Parte alle 8:15.'); } catch (_) {}
      return { ...base, text: 'Parte alle 8:15.', toolCalls: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('a che ora parte il treno?');
  await page.locator('#sendBtn').click();
  const fermo = page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato' });
  await expect(fermo).toContainText('Mi sono fermato dopo 3 passi senza arrivare a una risposta.', { timeout: 30_000 });
  await expect(fermo).toContainText('Cerco ancora gli orari, giro 3…');
  await expect(fermo.locator('.dash-continua')).toBeVisible();
  await expect(page.locator('#sendBtn')).toHaveAttribute('data-modo', 'riprendi');

  await fermo.locator('.dash-continua').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Parte alle 8:15.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(0);

  await app.evaluate(() => { try { globalThis.__restoreProvider7?.(); } catch (_) {} });
});

test('C — appena il modello nomina un\'azione la riga in testa lo dice, prima degli argomenti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider3 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    const vista = new Promise((r) => { globalThis.__argomenti = r; });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 't1', name: 'TIMER' }); } catch (_) {}
        // Gli argomenti «arrivano» quando la prova ha visto la riga: nel frattempo la riga deve già dirlo.
        await vista;
        // Un timer solo chiude il turno (#1130): la frase va scritta insieme.
        try { onDelta && onDelta('Un minuto, via.'); } catch (_) {}
        return { ...base, text: 'Un minuto, via.', toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Uovo"}' }], reasoningDetails: [], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('Un minuto, via.'); } catch (_) {}
      return { ...base, text: 'Un minuto, via.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('timer di un minuto per l\'uovo');
  await page.locator('#sendBtn').click();

  // La riga del nodo lo dice (#578: il filo si annoda lì), poi il gomitolo col riassunto.
  const riga = page.locator('.dash-activity .dash-activity-seg-label');
  await expect(riga).toHaveText('Avvio un timer…', { timeout: 10_000 });
  await expect(page.locator('.dash-activity')).toHaveAttribute('data-phase', 'act');
  await page.screenshot({ path: 'tests/agent/.out/strumenti-inizio.png' });
  await app.evaluate(() => globalThis.__argomenti());

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Un minuto, via.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-activity .dash-activity-label')).toHaveText(/^Ha avviato un timer · \d+ s$/);
  await expect(riga).toHaveText(/^Avviato un timer · Uovo/);

  await app.evaluate(() => { try { globalThis.__restoreProvider3?.(); } catch (_) {} });
});
