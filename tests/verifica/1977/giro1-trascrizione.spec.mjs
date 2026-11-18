// #1977 giro 1 — prove avversariali: la traccia vuota (come YouTube fa senza il gettone del suo lettore) e il pannello
// «Mostra trascrizione» al suo posto, il passaggio a un video senza trascrizione senza ricaricare, un video lunghissimo.
// YouTube finto in https sotto www.youtube.com, come tests/trascrizione-youtube.spec.mjs.

import { test as base, expect } from '../../fixtures/electron.mjs';
import { createServer as createHttpsServer } from 'node:https';
import { certificato } from '../../helpers/immagineFirmata.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

base.use({
  hostInPiu: ['www.youtube.com'],
  argomentiInPiu: ['--ignore-certificate-errors', '--no-proxy-server'],
});

const NEWTAB = 'filo://newtab/';
const CON = 'paneInCasa1';
const SENZA = 'senzaSottot';
const PANNELLO = 'pannelloOk1';
const LUNGO = 'videoLungo1';

const lettore = (id) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: id, title: `Titolo ${id}` },
  ...(id !== SENZA ? { captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: `/api/timedtext?v=${id}&lang=it&kind=asr&exp=xpe`, languageCode: 'it', kind: 'asr' },
  ] } } } : {}),
});

const pagina = (id) => `<!doctype html><html><head><meta charset="utf-8"><title>Titolo ${id} - YouTube</title></head>
<body><div id="movie_player" style="width:640px;height:360px;background:#222"><video></video></div>
<h1>Titolo ${id}</h1><p>Descrizione: ricetta di casa.</p>
<script>window["ytInitialPlayerResponse"] = null;</script>
<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaFinta","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20251101.00.00","hl":"it"}}});</script>
<script>var ytInitialPlayerResponse = ${JSON.stringify(lettore(id))};</script>
${id === PANNELLO ? '<script>var ytInitialData = {"engagementPanels":[{"engagementPanelSectionListRenderer":{"content":{"continuationItemRenderer":{"continuationEndpoint":{"getTranscriptEndpoint":{"params":"CgtwYW5uZWxsbw"}}}}}}]};</script>' : ''}
</body></html>`;

const TRACCIA = JSON.stringify({ events: [
  { tStartMs: 0, segs: [{ utf8: 'ciao a tutti, oggi facciamo il pane' }] },
  { tStartMs: 4000, segs: [{ utf8: 'e vi dico subito che il segreto del pane è la biga' }] },
] });

// La risposta del pannello nella forma vera: segmenti con startMs in stringa e il testo in runs.
const RISPOSTA_PANNELLO = JSON.stringify({ actions: [{ updateEngagementPanelAction: { content: { transcriptRenderer: { content: {
  transcriptSearchPanelRenderer: { body: { transcriptSegmentListRenderer: { initialSegments: [
    { transcriptSegmentRenderer: { startMs: '0', endMs: '3000', snippet: { runs: [{ text: 'benvenuti, oggi parliamo di lievito' }] } } },
    { transcriptSegmentRenderer: { startMs: '3000', endMs: '6000', snippet: { runs: [{ text: 'il segreto del pane è la pazienza' }] } } },
  ] } } } } } } } }] });

// Tre ore e mezza: oltre il tetto, con un segno all'inizio e uno alla fine.
function tracciaLunga() {
  const events = [];
  for (let i = 0; i < 6300; i++) {
    const t = i === 0 ? 'INIZIODELVIDEO il segreto del pane è la biga' : (i === 6299 ? 'FINEDELVIDEO grazie e alla prossima'
      : `frase numero ${i} del lungo discorso sul pane e sulla farina macinata a pietra`);
    events.push({ tStartMs: i * 2000, segs: [{ utf8: t }] });
  }
  return JSON.stringify({ events });
}

const test = base.extend({
  youtube: async ({}, use) => {
    const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: 'www.youtube.com', usi: [] });
    const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    const richieste = [];
    const lunga = tracciaLunga();
    const srv = createHttpsServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
      const u = new URL(req.url, 'https://www.youtube.com');
      richieste.push(`${req.method} ${u.pathname}${u.search}`);
      const v = u.searchParams.get('v');
      if (u.pathname === '/watch') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pagina(v));
        return;
      }
      if (u.pathname === '/api/timedtext') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Senza il gettone del lettore YouTube risponde 200 e corpo vuoto.
        res.end(v === PANNELLO || v === SENZA ? '' : (v === LUNGO ? lunga : TRACCIA));
        return;
      }
      if (u.pathname === '/youtubei/v1/get_transcript' && req.method === 'POST') {
        let corpo = '';
        req.on('data', (c) => { corpo += c; });
        req.on('end', () => {
          richieste.push(`CORPO ${corpo}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(RISPOSTA_PANNELLO);
        });
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

test('traccia vuota: la chat legge la trascrizione dal pannello «Mostra trascrizione»', async ({ app, openTab, youtube }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  const url = youtube.url(`/watch?v=${PANNELLO}`);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => youtube.richieste.some((r) => r.startsWith('POST /youtubei/v1/get_transcript')), { timeout: 15_000 }).toBe(true);
  const corpo = youtube.richieste.find((r) => r.startsWith('CORPO ')) || '';
  expect(corpo).toContain('CgtwYW5uZWxsbw');
  expect(corpo).toContain('"clientName":"WEB"');

  await modelli(app);
  await chatFinta(app, url);
  await page.locator('#input').fill('di cosa parla il video che ho aperto?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'il segreto del pane è la pazienza' })).toBeVisible({ timeout: 20_000 });
  const giri = await app.evaluate(() => globalThis.__chiamate);
  const letto = giri[1].filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');
  expect(letto).toContain('[0:00] benvenuti, oggi parliamo di lievito il segreto del pane è la pazienza');
});

test('passando senza ricaricare a un video senza trascrizione, l\'Aiuto dice che non ce l\'ha', async ({ app, shell, openTab, youtube }) => {
  test.setTimeout(90_000);
  const page = await openTab(youtube.url(`/watch?v=${CON}`));
  await expect.poll(() => youtube.richieste.some((r) => r.includes(`timedtext?v=${CON}`)), { timeout: 15_000 }).toBe(true);
  const id = await idScheda(app, CON);
  await page.evaluate((v) => history.pushState({}, '', `/watch?v=${v}`), SENZA);
  await modelli(app);
  await aiutoFinto(app);
  const aiuto = await chiediAllAiuto(app, shell, page, id, 'di cosa parla questo video?');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('Questo video non ha trascrizione.', { timeout: 20_000 });
});

test('un video di tre ore e mezza: l\'Aiuto ha inizio e fine, e sa cosa manca', async ({ app, shell, openTab, youtube }) => {
  test.setTimeout(120_000);
  const page = await openTab(youtube.url(`/watch?v=${LUNGO}`));
  await expect.poll(() => youtube.richieste.some((r) => r.includes(`timedtext?v=${LUNGO}`)), { timeout: 15_000 }).toBe(true);
  await modelli(app);
  await aiutoFinto(app);
  const aiuto = await chiediAllAiuto(app, shell, page, await idScheda(app, LUNGO), 'di cosa parla questo video?');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('Parla del pane: il segreto è la biga.', { timeout: 30_000 });
  const primo = JSON.stringify((await app.evaluate(() => globalThis.__visti))[0]);
  expect(primo).toContain('INIZIODELVIDEO');
  expect(primo).toContain('FINEDELVIDEO');
  expect(primo).toMatch(/qui mancano \d+ righe della trascrizione/);
  expect(primo).toMatch(/manca il tratto da \d+:\d\d:\d\d a \d+:\d\d:\d\d/);
});
