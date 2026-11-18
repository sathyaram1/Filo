// #1977 — la chat che legge la pagina e l'Aiuto su un video di YouTube leggono la sua trascrizione, presa appena la
// pagina è pronta; senza trascrizione lo dicono. YouTube vero dal contenitore non si raggiunge: qui è finto, in https
// sotto www.youtube.com (host-resolver-rules), con la risposta del lettore e la traccia json3 nella forma vera.

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createHttpsServer } from 'node:https';
import { certificato } from './helpers/immagineFirmata.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

test.use({
  hostInPiu: ['www.youtube.com'],
  // In https Chromium passerebbe dal proxy dell'ambiente, che il server locale non lo raggiunge.
  argomentiInPiu: ['--ignore-certificate-errors', '--no-proxy-server'],
});

const NEWTAB = 'filo://newtab/';
const CON = 'paneInCasa1';
const SENZA = 'senzaSottot';

const lettore = (id) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: id, title: id === CON ? 'Il pane in casa' : 'Un video muto' },
  ...(id !== SENZA ? { captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: `/api/timedtext?v=${id}&lang=it&kind=asr`, languageCode: 'it', kind: 'asr', name: { simpleText: 'Italiano (generati automaticamente)' } },
  ] } } } : {}),
});

const pagina = (id) => `<!doctype html><html><head><meta charset="utf-8"><title>${lettore(id).videoDetails.title} - YouTube</title></head>
<body style="font:14px sans-serif;padding:20px"><div id="movie_player" style="width:640px;height:360px;background:#222"><video></video></div>
<h1>${lettore(id).videoDetails.title}</h1><p>Descrizione: ricetta di casa, iscriviti al canale.</p>
<script>var ytInitialPlayerResponse = ${JSON.stringify(lettore(id))};</script></body></html>`;

const TRACCIA = JSON.stringify({ events: [
  { tStartMs: 0, segs: [{ utf8: 'ciao a tutti, oggi facciamo il pane' }] },
  { tStartMs: 4000, segs: [{ utf8: 'e vi dico subito che il segreto del pane è la biga' }] },
  { tStartMs: 95000, segs: [{ utf8: 'la biga riposa diciotto ore' }] },
] });

const fixture = test.extend({
  // Il finto www.youtube.com: /watch è la pagina del video, /api/timedtext la traccia. Tiene il conto delle richieste.
  youtube: async ({}, use) => {
    const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: 'www.youtube.com', usi: [] });
    const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    const richieste = [];
    const srv = createHttpsServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
      const u = new URL(req.url, 'https://www.youtube.com');
      richieste.push(u.pathname + u.search);
      if (u.pathname === '/watch') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pagina(u.searchParams.get('v')));
        return;
      }
      if (u.pathname === '/api/timedtext' && u.searchParams.get('fmt') === 'json3' && u.searchParams.get('v') === CON) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(TRACCIA);
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    await use({ url: (p) => `https://www.youtube.com:${srv.address().port}${p}`, richieste });
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  },
});

const tracce = (youtube) => youtube.richieste.filter((r) => r.startsWith('/api/timedtext'));

async function modelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// La chat finta: al primo giro legge la pagina del video, al secondo risponde con quello che la lettura le ha dato.
async function chatFinta(app, url) {
  await app.evaluate((_e, url) => {
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages))) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 0) {
        try { onToolCall && onToolCall({ id: 'c0', name: 'LEGGI_PAGINA' }); } catch (_) {}
        return { ...base, text: '', toolCalls: [{ id: 'c0', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url }) }], finishReason: 'tool_calls' };
      }
      const esiti = messages.filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');
      const m = /il segreto del pane è (la \w+)/.exec(esiti);
      const text = m ? `Il video dice che il segreto del pane è ${m[1]}.` : 'Ne conosco solo il titolo.';
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, url);
}

// L'Aiuto finto risponde dalla trascrizione se l'ha davanti, e dice che non c'è se Filo glielo dice.
async function aiutoFinto(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{"message":"Ciao.","suggestions":[],"issues":[]}' };
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const m = /il segreto del pane è (la \w+)/.exec(tutto);
      const text = m ? `Parla del pane: il segreto è ${m[1]}.`
        : (/video di YouTube che non ha trascrizione/.test(tutto) ? 'Questo video non ha trascrizione.' : 'Lo so solo dal titolo.');
      return { ...base, text: JSON.stringify({ text, status: 'done' }) };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

const idScheda = (app, pezzo) => app.evaluate(({ BrowserWindow }, p) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => String(x.url || '').includes(p));
  return t ? t.id : null;
}, pezzo);

async function chiediAllAiuto(app, shell, page, id, testo) {
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  return aiuto;
}

fixture('la chat che legge la pagina di un video ne ha la trascrizione, presa appena la pagina era pronta', async ({ app, openTab, youtube }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  const url = youtube.url(`/watch?v=${CON}`);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  // Nessuno ha ancora chiesto niente: la traccia è già stata chiesta.
  await expect.poll(() => tracce(youtube).length, { timeout: 15_000 }).toBe(1);

  await modelli(app);
  await chatFinta(app, url);
  await page.locator('#input').fill('di cosa parla il video che ho aperto?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il video dice che il segreto del pane è la biga.' })).toBeVisible({ timeout: 20_000 });

  const giri = await app.evaluate(() => globalThis.__chiamate);
  const letto = giri[1].filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');
  expect(letto).toContain('letta dalla scheda aperta');
  expect(letto).toContain('[0:00] ciao a tutti, oggi facciamo il pane e vi dico subito che il segreto del pane è la biga');
  expect(letto).toContain('[1:35] la biga riposa diciotto ore');
  expect(letto).toMatch(/È la pagina di un video di YouTube: il testo della pagina comincia con la trascrizione del video \(italiano, sottotitoli generati da YouTube\)/);
  expect(letto.indexOf('Trascrizione del video')).toBeLessThan(letto.indexOf('Descrizione: ricetta di casa'));
  expect(tracce(youtube).length, 'la lettura usa quella già presa').toBe(1);
});

fixture('l\'Aiuto su un video risponde dalla trascrizione', async ({ app, shell, openTab, youtube }) => {
  test.setTimeout(90_000);
  const page = await openTab(youtube.url(`/watch?v=${CON}`));
  await expect.poll(() => tracce(youtube).length, { timeout: 15_000 }).toBe(1);
  await modelli(app);
  await aiutoFinto(app);
  const aiuto = await chiediAllAiuto(app, shell, page, await idScheda(app, CON), 'di cosa parla questo video?');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('Parla del pane: il segreto è la biga.', { timeout: 20_000 });
  const primo = JSON.stringify((await app.evaluate(() => globalThis.__visti))[0]);
  expect(primo).toContain('qui sotto c\'è la trascrizione del video (italiano, sottotitoli generati da YouTube)');
  expect(primo).toContain('[1:35] la biga riposa diciotto ore');
  await page.screenshot({ path: 'tests/.shots/trascrizione-youtube-aiuto.png' });
});

fixture('su un video senza trascrizione l\'Aiuto lo dice invece di rispondere dal titolo', async ({ app, shell, openTab, youtube }) => {
  test.setTimeout(90_000);
  const page = await openTab(youtube.url(`/watch?v=${SENZA}`));
  await modelli(app);
  await aiutoFinto(app);
  const aiuto = await chiediAllAiuto(app, shell, page, await idScheda(app, SENZA), 'di cosa parla questo video?');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('Questo video non ha trascrizione.', { timeout: 20_000 });
  expect(tracce(youtube)).toEqual([]);
});
