// #1669 — Filo scriveva il nome dell'utente nei feedback che manda dalla chat («L'utente (Giulia) sta cercando di…»).
// L'utente chiede la segnalazione: il riquadro di conferma e quello che parte non portano il suo nome né la sua email,
// che vengano dall'account Google o dalla memoria. Senza la rete il nome passa e i test sono rossi.

import { test, expect } from './fixtures/electron.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { confirmText, clickConfirm, nelMondoDiFilo } from './helpers/confirm.mjs';
import { confermaNelloStrato, nelloStrato, paginaDelloStrato } from './helpers/riquadri.mjs';

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

// Il riquadro vive in uno shadow root chiuso: si cattura il testo che l'utente leggerebbe, e si risponde sì.
async function catturaConferme(page) {
  await page.evaluate(() => {
    window.__confirmSeen = [];
    window.SN_CONFIRM_UI = {
      confirm: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
      confirmTyped: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
    };
  });
}

async function registraInvii(app) {
  await app.evaluate(() => {
    globalThis.__submitted = [];
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__submitted.push(payload);
      return { id: `fb-test-${globalThis.__submitted.length}` };
    };
  });
}

test('in chat, con un account che ha un nome, il feedback chiesto non porta né il nome né l\'email', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await livelloAutonomia(app, 'conservativo');
  await registraInvii(app);

  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    M._cache[k].exports.getProfile = () => ({ email: 'giulia.ferraris@example.com', name: 'Giulia Ferraris', picture: '' });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 'f1', name: 'INVIA_FEEDBACK' }); } catch (_) {}
        const args = {
          testo: 'L\'utente (Giulia) sta cercando di esportare la chat in PDF ma il bottone non fa niente. Giulia Ferraris ha riprovato due volte; per dettagli scrivere a giulia.ferraris@example.com.',
          titolo: 'Export PDF di Giulia',
        };
        return { ...base, text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify(args) }], reasoningDetails: [], finishReason: 'tool_calls' };
      }
      const finale = 'Ti ho preparato la segnalazione: conferma e parte.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  await catturaConferme(page);

  await page.locator('#input').fill('manda un feedback su questo problema');
  await page.locator('#sendBtn').click();

  const bottone = page.locator('.dash-action-btn', { hasText: 'Inviare questo feedback' });
  await expect(bottone).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window.__confirmSeen || []).length), { timeout: 10_000 }).toBeGreaterThan(0);
  const visto = await page.evaluate(() => window.__confirmSeen.join('\n'));
  expect(visto).toContain('L\'utente sta cercando di esportare la chat in PDF');
  expect(visto).toContain('Export PDF dell\'utente');
  expect(visto).not.toMatch(/Giulia|Ferraris|@/);

  // Confermato, parte lo stesso testo che l'utente ha letto: la conferma non viene respinta per una firma diversa.
  await expect.poll(() => app.evaluate(() => globalThis.__submitted.length), { timeout: 10_000 }).toBe(1);
  const inviato = await app.evaluate(() => globalThis.__submitted[0]);
  expect(inviato.text).toContain('L\'utente sta cercando di esportare la chat in PDF');
  expect(`${inviato.text}\n${inviato.name}`).not.toMatch(/Giulia|Ferraris|@/);
  await expect(bottone).toContainText('✓', { timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/1669-feedback-senza-nome.png' }).catch(() => {});
});

test('la segnalazione che Filo propone da sé toglie il nome che la memoria ricorda', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await registraInvii(app);

  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'L\'utente si chiama Luca Moretti e lavora come grafico.', PREFERENZE: '' });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Non ho accesso al saldo dei crediti, Luca: lo trovi in Opzioni, alla voce Crediti e consumi.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  await catturaConferme(page);

  await page.locator('#input').fill('sono Luca, quanti crediti ho?');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-actions .dash-action-btn-primary', { hasText: /Inviare questo feedback/i })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window.__confirmSeen || []).join('\n')), { timeout: 10_000 }).toMatch(/quanti crediti ho/i);
  const visto = await page.evaluate(() => window.__confirmSeen.join('\n'));
  expect(visto).toContain('sono l\'utente, quanti crediti ho?');
  expect(visto).not.toMatch(/Luca|Moretti/);
  await expect.poll(() => app.evaluate(() => globalThis.__submitted.length), { timeout: 10_000 }).toBe(1);
  const inviato = await app.evaluate(() => globalThis.__submitted[0]);
  expect(`${inviato.text}\n${inviato.name}`).not.toMatch(/Luca|Moretti/);
});

// Dall'Aiuto su un sito la conferma rimanda il testo del modello: la riscrittura deve combaciare, o l'OK sarebbe respinto.
test('dall\'Aiuto su un sito il riquadro mostra il testo senza il nome, e l\'OK lo spedisce così', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><h1>Ricette</h1></body></html>');
  await registraInvii(app);
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    M._cache[k].exports.getProfile = () => ({ email: 'giulia.ferraris@example.com', name: 'Giulia Ferraris', picture: '' });
  });
  const host = new URL(page.url()).hostname;
  await expect.poll(() => nelMondoDiFilo(app, host, 'typeof window.SN_SIDEBAR?.open'), { timeout: 8000 }).toBe('function');
  await nelMondoDiFilo(app, host, 'window.SN_SIDEBAR.open(); 1');
  const strato = await paginaDelloStrato(app, page);
  await strato.waitForSelector('.sn-sidebar-input textarea');
  await nelloStrato(app, page, (a) => {
    window.__esito = 'in corso';
    window.__filoSidebarTest.runFiloAction(a).then((v) => { window.__esito = v; });
    return 1;
  }, { type: 'INVIA_FEEDBACK', testo: 'Giulia non trova la ricetta salvata ieri.', titolo: 'Ricetta di Giulia sparita' });
  const vista = await confermaNelloStrato(app, page, { timeout: 15_000 });
  const visto = await confirmText(vista);
  expect(visto).toContain('L\'utente non trova la ricetta salvata ieri.');
  expect(visto).not.toMatch(/Giulia|Ferraris/);
  await clickConfirm(vista, 'ok');
  await expect.poll(() => nelloStrato(app, page, () => window.__esito)).toBe(true);
  const inviato = await app.evaluate(() => globalThis.__submitted[0]);
  expect(inviato.text).toBe('L\'utente non trova la ricetta salvata ieri.');
  expect(inviato.name).toBe('Ricetta dell\'utente sparita');
});
