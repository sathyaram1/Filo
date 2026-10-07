// Verifica #515 — giro 2, la strada della chat.
//
// Il giro 1 ha provato un documento alla volta. Qui si guarda cosa succede
// quando in uno stesso turno il modello ne chiede due — uno scritto e uno no —
// e quando il nome arriva sporco. Serve a sapere se il diario del turno e il
// testo che riparte verso il fornitore restano onesti anche lì.

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

// Il modello finto chiede uno o più documenti al primo giro, poi risponde.
async function fakeProvider(app, docs) {
  await app.evaluate((_electron, d) => { globalThis.__docsChiesti = d; }, docs);
  await app.evaluate(() => {
    globalThis.__calls = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const n = globalThis.__calls.push({
        messages: JSON.parse(JSON.stringify(messages)),
        tools: JSON.parse(JSON.stringify(tools || [])),
      });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        const chiamate = globalThis.__docsChiesti.map((d, i) => ({
          id: `t${i + 1}`,
          name: 'LEGGI_TRASPARENZA',
          arguments: d === null ? '{}' : JSON.stringify({ doc: d }),
        }));
        for (const c of chiamate) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
        return { ...base, text: '', toolCalls: chiamate, reasoningDetails: [], finishReason: 'tool_calls' };
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

async function apriChat(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  return page;
}

test('due documenti in un turno solo: il diario racconta il letto E il mancante', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  const mancante = previsti.find((i) => !esistenti.includes(i));
  test.skip(!mancante, 'tutte le sezioni hanno il loro documento');

  const page = await apriChat(app, shell);
  await fakeProvider(app, [esistenti[0], mancante]);
  await chiedi(page, 'perché questi modelli, e che fine fanno i miei dati?');

  // Al modello devono tornare DUE esiti distinti: il testo del documento che
  // c'è, e il no esplicito per quello che non c'è.
  const calls = await app.evaluate(() => globalThis.__calls);
  const tools = calls[1].messages.filter((x) => x.role === 'tool');
  expect(tools.length, 'non sono tornati due esiti distinti').toBe(2);
  expect(tools.map((t) => t.content).join('\n')).toContain('NON esiste');
  expect(tools.map((t) => t.content).join('\n')).toContain('Politica sui modelli');

  // L'utente: nel diario devono comparire tutte e due le cose. Raccontare solo
  // la lettura riuscita è la stessa promessa di troppo tolta nel giro 1.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveAttribute('data-phase', 'done');
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  await expect(body.locator('.dash-activity-row', { hasText: 'Documento non disponibile' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Rileggo la pagina di trasparenza' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/515-giro2-due-documenti.png' });
});

test('il nome del documento non scritto torna al modello riconoscibile, anche sporco', async ({ app }) => {
  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  const mancante = previsti.find((i) => !esistenti.includes(i));
  test.skip(!mancante, 'tutte le sezioni hanno il loro documento');

  const forme = [mancante.toUpperCase(), ` ${mancante} `, `${mancante}\n${mancante}`, 'x'.repeat(10_000)];
  for (const forma of forme) {
    const testo = await app.evaluate((_e, f) => globalThis.SN_TRANSPARENCY.asText(f), forma);
    expect(testo, `"${String(forma).slice(0, 20)}": nessun no esplicito`).toContain('NON esiste');
    expect(testo.length, 'la risposta si porta dietro il nome intero').toBeLessThan(600);
    expect(testo).not.toMatch(/\n[^\n]*NON esiste/);
  }
});
