// Verifica #1589 giro 10, rilievo 1: il pavimento copre come password pezzi che password non sono, vicini alla parola
// «password»: gli indirizzi dei campi che l'aiuto del sito manda al modello, e il codice di una pagina di programmazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';

async function superaAvviso(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 10_000;
  while (!(await coperta())) {
    if (Date.now() > fine) throw new Error('l’avviso del sito sospetto non è comparso');
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

test('r1 aiuto del sito su un modulo di accesso: il modello riceve l’indirizzo del campo password, del modulo e del bottone «Accedi»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Accesso</title></head><body><h1>Area clienti</h1>
    <form id="accesso"><div><label for="utente">Utente</label> <input id="utente"></div>
    <div><label for="password">Password</label> <input id="password" type="password"></div>
    <button id="entra" type="button">Accedi</button></form></body></html>`);
  await superaAvviso(app);
  await page.fill('#utente', 'mario');
  await page.fill('#password', 'Gatto.Rosso.77');
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Premi «Accedi».', status: 'done' }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', 'aiutami a entrare');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });

  const testo = (await app.evaluate(() => JSON.stringify(globalThis.__visti))).replace(/\\"/g, '"');
  expect(testo, 'la password scritta non arriva').not.toContain('Gatto.Rosso.77');
  const righe = testo.split('\\n').filter((r) => / :: /.test(r));
  const riga = (sel) => righe.find((r) => r.endsWith(`:: ${sel}`) || r.includes(`:: ${sel}`)) || '';
  expect(riga('#password'), 'il campo della password, col suo indirizzo').toContain('"Password"');
  expect(riga('#entra'), 'il bottone «Accedi», col suo indirizzo').toContain('"Accedi"');
  expect(righe.filter((r) => r.includes('[dato riservato]')), 'nessun indirizzo coperto nell’elenco dei campi').toEqual([]);
});

test('r1 la chat legge una pagina di programmazione: il codice vicino alla parola «password» arriva com’è', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const h = await openTab('filo://newtab/');
  const url = testServer.html(`<!doctype html><html><head><title>Guida al login</title></head><body><main>
    <h1>Come mandare il modulo di accesso</h1><p>Il codice che usiamo:</p>
    <pre>body: JSON.stringify({ username, password: form.password.value }),</pre>
    <pre>&lt;input type="password" name="password" id="pwd1" required&gt;</pre>
    <pre>$hash = password_hash($password, PASSWORD_DEFAULT);</pre></main></body></html>`, { pubblico: true });
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.stringify(messages)) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 0) {
        const m = /(\d+)\. (?:\[FOCUS\] )?Guida al login/.exec(messages.map((x) => String(x.content || '')).join('\n'));
        const call = { id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ scheda: m ? Number(m[1]) : 0 }) };
        try { onToolCall && onToolCall({ id: call.id, name: call.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [call], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('LETTA'); } catch (_) {}
      return { ...base, text: 'LETTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('spiegami il codice della pagina Guida al login');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'LETTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n').replace(/\\"/g, '"');
  expect(mandato, 'la pagina è stata letta').toContain('Come mandare il modulo di accesso');
  expect(mandato).toContain('password: form.password.value');
  expect(mandato).toContain('id="pwd1"');
  expect(mandato).toContain('PASSWORD_DEFAULT');
});

test('r1 una domanda in chat sulla password di un prodotto: il modello riceve il nome del prodotto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const h = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__chiamate.push(JSON.stringify(messages));
      try { onDelta && onDelta('RISPOSTA'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [], text: 'RISPOSTA', toolCalls: [], finishReason: 'stop' };
    };
  });
  await h.bringToFront();
  await h.locator('#input').fill('come cambio la password del router TP-Link AX1500? E quella di Office365?');
  await h.locator('#sendBtn').click();
  await expect(h.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
  const mandato = (await app.evaluate(() => globalThis.__chiamate)).join('\n');
  expect(mandato).toContain('TP-Link AX1500');
  expect(mandato).toContain('Office365');
});
