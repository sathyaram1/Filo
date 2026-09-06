// Verifica indipendente (giro 5) — parte B: diario, fallimenti, conferme, retry.
import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

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

async function scriptProvider(app, script) {
  await app.evaluate(async (electron, s) => {
    globalThis.__rounds = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onToolCall, onDelta }) => {
      globalThis.__rounds.push(JSON.parse(JSON.stringify(messages)));
      const step = s[Math.min(i, s.length - 1)];
      i += 1;
      if (step.boom) throw new Error('provider caduto');
      const calls = (step.toolCalls || []).map((c) => ({ ...c, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {}) }));
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      for (const c of calls) { try { onToolCall && onToolCall(c); } catch (_) {} }
      return { text: step.text || '', toolCalls: calls, reasoningDetails: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, script);
}

async function ask(page, msg) {
  await page.locator('#input').fill(msg);
  await page.locator('#sendBtn').click();
}

const rows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.dash-activity-row')).map((e) => e.textContent.trim()));

// ── 1. Sole azioni silenziose: il blocco c'è comunque, con le loro righe ──
test('appunto + lezione e basta: il blocco compare con entrambe le righe', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { id: 'a1', name: 'SALVA_APPUNTO', arguments: { testo: 'pane', contesto: 'spesa' } },
      { id: 'a2', name: 'SALVA_LEZIONE', arguments: { testo: "L'utente preferisce il tè" } },
    ] },
    { text: 'Segnato.' },
  ]);
  await ask(page, 'segna il pane e ricorda che preferisco il tè');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Segnato', { timeout: 20_000 });
  await expect(page.locator('.dash-activity')).toHaveCount(1, { timeout: 8_000 });
  const r = (await rows(page)).join(' | ');
  expect(r).toMatch(/Appunto salvato/);
  expect(r).toMatch(/Memorizzato/);
  const head = await page.locator('.dash-activity-label').last().textContent();
  expect(head).toMatch(/salvato un appunto/i);
  expect(head).toMatch(/memorizzato una cosa/i);
});

// ── 2. Comandi finestra + aspetto app + regole proxy: ognuno la sua riga ──
test('comando finestra, aspetto e regola proxy hanno la loro riga nel diario', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { id: 'b1', name: 'COMANDO_FINESTRA', arguments: { comando: 'settings' } },
      { id: 'b2', name: 'IMPOSTA_ESTETICA', arguments: { token: 'radius', valore: '12px' } },
      { id: 'b3', name: 'REGOLA_PROXY_DOMINIO', arguments: { country: 'us', dominio: 'netflix.com' } },
      { id: 'b4', name: 'RIMUOVI_REGOLA_PROXY', arguments: { dominio: 'netflix.com' } },
      { id: 'b5', name: 'RIMUOVI_PROXY_TUTTE', arguments: {} },
    ] },
    { text: 'Fatto.' },
  ]);
  await ask(page, 'fai un po di cose');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Fatto', { timeout: 20_000 });
  const r = (await rows(page)).join(' | ');
  expect(r, r).toMatch(/Impostazioni aperte|Comando/i);
  expect(r, r).toMatch(/Aspetto · radius/);
  expect(r, r).toMatch(/Regola · netflix\.com/);
  expect(r, r).toMatch(/Regola tolta · netflix\.com/);
  expect(r, r).toMatch(/schede riportate in Italia/i);
});

// ── 3. Azioni fallite: riga che lo dice, e fuori dal riassunto ──
test('documento inesistente: riga di errore e il riassunto non dice «letto un documento»', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { id: 'd1', name: 'LEGGI_DOCUMENTO', arguments: { percorso: 'non-esiste-questo-file.pdf' } },
      { id: 'd2', name: 'TIMER', arguments: { secondi: 'non-un-numero', etichetta: 'rotto' } },
    ] },
    { text: 'Non ci sono riuscito.' },
  ]);
  await ask(page, 'leggi il documento non-esiste-questo-file.pdf e metti un timer');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Non ci sono riuscito', { timeout: 20_000 });
  const r = (await rows(page)).join(' | ');
  expect(r, r).toMatch(/⚠|non riuscit|non letto|Timer non avviato/i);
  const head = await page.locator('.dash-activity-label').last().textContent();
  expect(head).not.toMatch(/letto un documento/i);
  expect(head).not.toMatch(/avviato un timer/i);
});

// ── 4. Impostazione di livello 2: riga nel diario dopo l'OK, e il modello lo sa ──
test('conferma nel popup: riga nel diario e il modello la vede al turno dopo', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [{ id: 'k1', name: 'IMPOSTA_PREFERENZA', arguments: { chiave: 'modalita_terminale', valore: true } }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await ask(page, 'attiva la modalità terminale');
  // Il popup si apre da sé.
  await expect.poll(() => confirmText(page), { timeout: 25_000 }).toMatch(/terminale/i);
  // La riga «Conferma chiesta» è breve, non un paragrafo.
  const chiesta = (await rows(page)).find((t) => /Conferma chiesta/.test(t)) || '';
  expect(chiesta, chiesta).toBeTruthy();
  expect(chiesta.length, chiesta).toBeLessThan(90);

  await clickConfirm(page, 'ok');
  // Riga nel diario dopo l'OK.
  await expect.poll(async () => (await rows(page)).join(' | '), { timeout: 10_000 }).toMatch(/Impostato/);
  const applied = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).terminalMode);
  expect(applied).toBe(true);

  // Turno dopo: il modello deve vedere la conferma nel contesto.
  await scriptProvider(app, [{ text: 'Sì, è attivo.' }]);
  await ask(page, 'è attivo?');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('è attivo', { timeout: 20_000 });
  const ctx = await app.evaluate(() => JSON.stringify(globalThis.__rounds[0]));
  expect(ctx, ctx.slice(0, 2000)).toMatch(/terminale/i);
});

// ── 5. Blocco con la sola frase intermedia: non si intitola «Ragionamento» ──
test('un blocco senza ragionamento non si intitola «Ragionamento»', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'Un momento…', toolCalls: [{ id: 'z1', name: 'IMPOSTA_PREFERENZA', arguments: { chiave: 'protezione_ip', valore: true } }] },
    { text: 'Ecco.' },
  ]);
  await ask(page, 'attiva la protezione ip');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ecco', { timeout: 25_000 });
  const head = await page.locator('.dash-activity-label').last().textContent();
  expect(head, head).not.toMatch(/^Ragionamento/);
});

// ── 6. «Riprova» dopo un guasto a metà: quel che era fatto è nel contesto ──
test('Riprova dopo un guasto: il timer già avviato è nel contesto e non si rifà', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: 'Avvio il timer…', toolCalls: [{ id: 'r1', name: 'TIMER', arguments: { secondi: 120, etichetta: 'uova' } }] },
    { boom: true },
    { text: 'Il timer è già in corsa.' },
  ]);
  await ask(page, 'timer uova 2 minuti');
  // Bolla d'errore con il Riprova.
  const retry = page.locator('button', { hasText: 'Riprova' });
  await expect(retry.first()).toBeVisible({ timeout: 25_000 });
  // Il timer c'è davvero.
  let timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.filter((t) => /uova/.test(t.label || '')).length).toBe(1);

  await retry.first().click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('già in corsa', { timeout: 25_000 });
  // Il contesto del nuovo tentativo cita il timer già avviato.
  const ctx = await app.evaluate(() => JSON.stringify(globalThis.__rounds[globalThis.__rounds.length - 1]));
  expect(ctx.toLowerCase(), ctx.slice(0, 3000)).toContain('uova');
  // E non ne è nato un secondo.
  timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.filter((t) => /uova/.test(t.label || '')).length).toBe(1);
});

// ── 7. Byte nullo nell'etichetta: né nel timer salvato né nella riga ──
test('byte nullo nell’etichetta: assente dal timer salvato e dalla riga del diario', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'TIMER', arguments: { secondi: 90, etichetta: 'uo\u0000va' } }] },
    { text: 'Timer partito.' },
  ]);
  await ask(page, 'timer strano');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Timer partito', { timeout: 20_000 });
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  const t = timers.find((x) => /uo/.test(x.label || ''));
  expect(t, JSON.stringify(timers)).toBeTruthy();
  expect(t.label.includes('\u0000'), `etichetta salvata: ${JSON.stringify(t.label)}`).toBe(false);
  const r = (await rows(page)).join(' | ');
  expect(r.includes('\u0000'), `riga: ${JSON.stringify(r)}`).toBe(false);
});

// ── 8. NAVIGA con javascript:/file: niente bottone che al click non fa nulla ──
test('NAVIGA con javascript: e file: non lascia bottoni ciechi', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { id: 'j1', name: 'NAVIGA', arguments: { url: 'javascript:alert(1)', etichetta: 'js' } },
      { id: 'j2', name: 'NAVIGA', arguments: { url: 'file:///C:/Windows/win.ini', etichetta: 'file' } },
    ] },
    { text: 'Non posso aprirli.' },
  ]);
  await ask(page, 'apri javascript:alert(1)');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Non posso aprirli', { timeout: 20_000 });
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('.dash-action-link-chip')).map((e) => e.textContent.trim()));
  expect(chips.join(' | '), chips.join(' | ')).not.toMatch(/↗\s*(js|file)\b/);
  const r = (await rows(page)).join(' | ');
  expect(r, r).toMatch(/indirizzo non ammesso|non riuscit/i);
});
