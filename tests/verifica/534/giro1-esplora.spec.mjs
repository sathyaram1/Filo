// Verifica #534 giro 1: esplorazione delle strade della richiesta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';
import { paginaGmail } from '../../helpers/fintoGmail.mjs';

async function modello(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__chiamate = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      globalThis.__chiamate.push({ messages: JSON.parse(JSON.stringify(messages)), tools: (tools || []).map((t) => t.function.name) });
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = (giro.toolCalls || []).map((c) => ({ ...c, arguments: JSON.stringify(c.arguments || {}) }));
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const chiamate = (app) => app.evaluate(() => globalThis.__chiamate || []);
const esiti = (c) => (c ? c.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n\n') : '');

async function gmailDietro(app, shell, openTab, testServer, opz = {}) {
  await app.evaluate((_e, o) => { process.env.FILO_GMAIL_ORIGIN = o; }, testServer.origin);
  const gmail = await openTab(testServer.html(paginaGmail(opz)));
  await expect(gmail).toHaveTitle(/Posta in arrivo.*Gmail/);
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.activate(s.tabs.find((t) => t.url.startsWith('filo://newtab')).id);
  });
  return { gmail, page: await home(app) };
}

test('A cosa mi ha scritto Marco, la banca di marzo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const { page } = await gmailDietro(app, shell, openTab, testServer);
  await modello(app, [
    { toolCalls: [{ id: 'c1', name: 'POSTA_LEGGI', arguments: { cerca: 'Marco' } }] },
    { text: 'Uno.' },
  ]);
  await chiedi(page, 'cosa mi ha scritto Marco?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Uno.' })).toBeVisible({ timeout: 60_000 });
  console.log('MARCO>>', esiti((await chiamate(app))[1]).slice(0, 1500));
  await modello(app, [
    { toolCalls: [{ id: 'c2', name: 'POSTA_CERCA', arguments: { query: 'banca after:2026/03/01 before:2026/05/01' } }] },
    { toolCalls: [{ id: 'c3', name: 'POSTA_LEGGI', arguments: { numero: 1 } }] },
    { text: 'Due.' },
  ]);
  await chiedi(page, 'cerca la mail della banca di marzo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Due.' })).toBeVisible({ timeout: 60_000 });
  const c = await chiamate(app);
  console.log('BANCA1>>', esiti(c[1]).slice(-1200));
  console.log('BANCA2>>', esiti(c[2]).slice(-1200));
});

test('B senza scheda Gmail e con l\'interruttore spento', async ({ app }) => {
  test.setTimeout(150_000);
  const page = await home(app);
  await modello(app, [
    { toolCalls: [{ id: 'c1', name: 'POSTA_ELENCO', arguments: {} }] },
    { text: 'Uno.' },
  ]);
  await chiedi(page, 'ho mail nuove?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Uno.' })).toBeVisible({ timeout: 60_000 });
  console.log('SENZA>>', esiti((await chiamate(app))[1]));
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ schedeAperte: { leggere: false } }); });
  await modello(app, [
    { toolCalls: [{ id: 'c2', name: 'LEGGI_SCHEDA', arguments: {} }] },
    { text: 'Due.' },
  ]);
  await chiedi(page, 'leggi la scheda');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Due.' })).toBeVisible({ timeout: 60_000 });
  const c = await chiamate(app);
  console.log('SPENTO tools>>', c[0].tools.filter((t) => /SCHEDA|POSTA|FIDAT|CAMPO|ELEMENTO/.test(t)).join(','));
  console.log('SPENTO esito>>', esiti(c[1]));
});

test('C bozza nuova con una bozza dell\'utente già aperta, e testo strano', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const { gmail, page } = await gmailDietro(app, shell, openTab, testServer);
  await gmail.evaluate(() => {
    document.getElementById('scrivi').click();
    document.querySelector('#corpo').innerText = 'Testo mio che sto scrivendo';
  });
  const strano = '<b>ciao</b> <img src=x onerror="window.__xss=1"> 😀 ' + 'lungo '.repeat(2000);
  await modello(app, [
    { toolCalls: [{ id: 'n1', name: 'POSTA_BOZZA', arguments: { a: 'luca@example.org', oggetto: 'Cena 🍕', testo: strano } }] },
    { text: 'Pronta.' },
  ]);
  await chiedi(page, 'scrivi a luca');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Pronta.' })).toBeVisible({ timeout: 60_000 });
  const stato = await gmail.evaluate(() => ({
    dialoghi: [...document.querySelectorAll('[role=dialog]')].map((d) => ({
      a: [...d.querySelectorAll('[email]')].map((x) => x.getAttribute('email')),
      ogg: d.querySelector('#oggetto').value,
      inizio: d.querySelector('#corpo').innerText.slice(0, 80),
      len: d.querySelector('#corpo').innerText.length,
    })),
    xss: window.__xss || 0, inviati: window.__inviati,
  }));
  console.log('BOZZA>>', JSON.stringify(stato));
  console.log('BOZZA esito>>', esiti((await chiamate(app))[1]).slice(0, 600));
});
