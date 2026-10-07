// Verifica #515 — giro 1.
//
// Sintomo: chiedendo a Filo «che fine fanno i miei dati? li vendete?» l'agente
// tentava il documento di trasparenza «privacy», che nel repo non esiste, e
// tornava a mani vuote. Il prompt gliene prometteva quattro (models, privacy,
// security, business) quando ne esisteva uno.
//
// Qui si parte dall'utente che scrive in chat, non dall'azione: si guarda cosa
// arriva davvero al fornitore e cosa vede l'utente nel diario del turno.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
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

// Il modello finto: al primo giro chiede il documento `doc`, al secondo
// risponde. Registra strumenti e messaggi di ogni chiamata.
async function fakeProvider(app, doc) {
  // Il nome del documento passa da `globalThis`, non da una chiusura: la
  // funzione del provider vive oltre la fine di `evaluate`, e la chiusura
  // sull'argomento non sopravvive.
  await app.evaluate((_electron, d) => { globalThis.__docChiesto = d; }, doc);
  await app.evaluate(() => {
    globalThis.__calls = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const n = globalThis.__calls.push({
        messages: JSON.parse(JSON.stringify(messages)),
        tools: JSON.parse(JSON.stringify(tools || [])),
      });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 't1', name: 'LEGGI_TRASPARENZA' }); } catch (_) {}
        return {
          ...base, text: '',
          toolCalls: [{ id: 't1', name: 'LEGGI_TRASPARENZA', arguments: JSON.stringify({ doc: globalThis.__docChiesto }) }],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      const finale = 'Ecco cosa ho trovato.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco cosa ho trovato.' })).toBeVisible({ timeout: 20_000 });
}

test('il prompt che parte verso il fornitore non promette documenti che non esistono', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, 'privacy');

  await chiedi(page, 'che fine fanno i miei dati? li vendete?');

  const calls = await app.evaluate(() => globalThis.__calls);
  const def = calls[0].tools.find((t) => t.function.name === 'LEGGI_TRASPARENZA');
  expect(def, 'lo strumento della trasparenza non arriva al modello').toBeTruthy();

  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  expect(esistenti.length).toBeGreaterThan(0);

  // L'elenco dichiarato è quello vero, e nessuna sezione non scritta viene
  // nominata come documento leggibile.
  expect(def.function.parameters.properties.doc.enum).toEqual(esistenti);
  const promesso = `${def.function.description} ${def.function.parameters.properties.doc.description}`;
  for (const id of previsti.filter((i) => !esistenti.includes(i))) {
    expect(promesso, `il prompt nomina ancora "${id}"`)
      .not.toMatch(new RegExp(`(^|[^a-z0-9_-])${id}([^a-z0-9_-]|$)`, 'i'));
  }

  // E il sistema non promette nemmeno altrove: il messaggio di sistema del
  // turno non deve elencare i tre documenti mancanti.
  const sys = calls[0].messages.find((m) => m.role === 'system');
  for (const id of previsti.filter((i) => !esistenti.includes(i))) {
    expect(String(sys?.content || ''), `il messaggio di sistema nomina "${id}"`)
      .not.toMatch(new RegExp(`trasparenza[^.]{0,200}${id}`, 'i'));
  }
});

test('se il modello chiede lo stesso un documento non scritto, riceve un no esplicito e il diario non mente', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, 'privacy');

  await chiedi(page, 'che fine fanno i miei dati? li vendete?');

  // Al modello torna un messaggio `tool` che dice in chiaro che non c'è niente
  // da citare: è quello che gli impedisce di rispondere a memoria.
  const calls = await app.evaluate(() => globalThis.__calls);
  const m = calls[1].messages;
  const tool = m.filter((x) => x.role === 'tool').pop();
  expect(tool, 'nessun esito è tornato al modello').toBeTruthy();
  expect(tool.content).toContain('privacy');
  expect(tool.content).toContain('NON esiste');
  expect(tool.content).toMatch(/memoria/i);

  // L'utente: il riassunto del turno NON dichiara una lettura che non è
  // avvenuta, e la riga lo dice.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await expect(activity.locator('.dash-activity-label')).not.toContainText('riletto la trasparenza');
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  await expect(body.locator('.dash-activity-row', { hasText: 'Documento non disponibile' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/515-giro1-documento-mancante.png' });
});

test('il documento che esiste arriva al modello e il diario lo racconta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, 'models');

  await chiedi(page, 'perché usi proprio questi modelli?');

  const calls = await app.evaluate(() => globalThis.__calls);
  const tool = calls[1].messages.filter((x) => x.role === 'tool').pop();
  expect(tool.content).toContain('Politica sui modelli');
  expect(tool.content).not.toContain('NON esiste');

  const activity = page.locator('.dash-activity');
  await expect(activity.locator('.dash-activity-label')).toContainText('riletto la trasparenza');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body').locator('.dash-activity-row', { hasText: 'Documento non disponibile' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/515-giro1-documento-letto.png' });
});

test('il documento arriva INTERO: senza le fonti, «cita il testo» non si può fare', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, 'models');

  await chiedi(page, 'su cosa ti basi per dire queste cose sui laboratori?');

  const calls = await app.evaluate(() => globalThis.__calls);
  const tool = calls[1].messages.filter((x) => x.role === 'tool').pop();
  const intero = await app.evaluate(() => globalThis.SN_TRANSPARENCY.asText('models'));

  // Lo strumento ordina all'agente di «rispondere citando il testo»: il testo
  // deve arrivargli tutto. Quello che si perde per ultimo è l'elenco delle
  // fonti, cioè proprio ciò che rende citabile il documento.
  expect(tool.content, 'il documento arriva tagliato').not.toContain('documento troncato');
  expect(tool.content.length, `al modello arrivano ${tool.content.length} caratteri su ${intero.length}`)
    .toBeGreaterThanOrEqual(intero.length);
  expect(tool.content).toContain('Fonti:');
  expect(tool.content).toContain('Se stai forkando Filo');
});
