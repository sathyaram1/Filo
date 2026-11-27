// Esplorazione della verifica #1815 giro 1: video, avanzamento, chiusura a metà, chat su una scheda aperta, errori.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { statoDi, paginaDelloStrato, conta } from '../../helpers/riquadri.mjs';

const DIR = process.env.ESPLORA_DIR || '';

function wav(secondi) {
  const sr = 8000;
  const n = Math.round(sr * secondi);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin(i / 3)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function trascrittoreFinto(app, { ritardo = 0, errore = null } = {}) {
  await app.evaluate(async (_e, { ritardo, errore }) => {
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models },
    });
    globalThis.__pezzi = [];
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64 }) => {
      const byte = Buffer.from(String(audioBase64 || ''), 'base64');
      const n = globalThis.__pezzi.push({ secondi: (byte.length - 44) / 32000 });
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      if (errore) { const e = new Error(errore.message); e.status = errore.status; throw e; }
      return { text: ` PEZZO-${n} `, usage: { seconds: 1, costUsd: 0.0001 }, generationId: null };
    };
  }, { ritardo, errore });
}

async function apriMenu(page, selettore) {
  await page.locator(selettore).click({ button: 'right', position: { x: 10, y: 10 } });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  return menu;
}
const testo = async (app, page, sel = '.sn-popup-body') => (await statoDi(app, page, sel))?.testo || '';

test('video mp4 in <video>: Trascrivi c\'è e trascrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  const src = testServer.asset(readFileSync(join(DIR, 'prova.mp4')), 'video/mp4');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <video id="v" src="${src}" controls style="display:block;width:320px;height:240px"></video></body></html>`);
  const menu = await apriMenu(page, '#v');
  console.log('VOCI VIDEO:', await menu.principale.innerText());
  await menu.voce('Trascrivi').click();
  await expect.poll(() => testo(app, page), { timeout: 60_000 }).toMatch(/PEZZO-1[\s\S]*PEZZO-2/);
  console.log('META VIDEO:', await testo(app, page, '.sn-popup-meta'));
  const strato = await paginaDelloStrato(app, page);
  await strato.screenshot({ path: join('tests', '.shots', 'v1815-video.png') });
});

test('ogg opus in <audio>: trascrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  const src = testServer.asset(readFileSync(join(DIR, 'prova.ogg')), 'audio/ogg');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <audio id="a" src="${src}" controls style="display:block;width:320px"></audio></body></html>`);
  const menu = await apriMenu(page, '#a');
  await menu.voce('Trascrivi').click();
  await expect.poll(() => testo(app, page), { timeout: 60_000 }).toContain('PEZZO-1');
});

test('avanzamento visibile e chiusura a metà ferma le chiamate', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app, { ritardo: 2500 });
  const src = testServer.asset(wav(300), 'audio/wav');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <audio id="a" src="${src}" controls style="display:block;width:320px"></audio></body></html>`);
  const menu = await apriMenu(page, '#a');
  await menu.voce('Trascrivi').click();
  await expect.poll(() => testo(app, page, '.sn-popup'), { timeout: 30_000 }).toMatch(/di 10/);
  console.log('POPUP MID:', await testo(app, page, '.sn-popup'));
  const strato = await paginaDelloStrato(app, page);
  await strato.screenshot({ path: join('tests', '.shots', 'v1815-avanzamento.png') });
  await expect.poll(() => testo(app, page), { timeout: 30_000 }).toContain('PEZZO-1');
  await strato.locator('.sn-popup-close').click();
  await expect.poll(() => conta(app, page, '.sn-popup'), { timeout: 10_000 }).toBe(0);
  const allaChiusura = await app.evaluate(() => globalThis.__pezzi.length);
  await page.waitForTimeout(9000);
  const dopo = await app.evaluate(() => globalThis.__pezzi.length);
  console.log('PEZZI alla chiusura', allaChiusura, 'dopo 9s', dopo);
  expect(dopo).toBeLessThanOrEqual(allaChiusura + 1);
});

test('crediti finiti: avviso', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await trascrittoreFinto(app, { errore: { status: 402, message: 'Insufficient credits' } });
  const src = testServer.asset(wav(5), 'audio/wav');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <audio id="a" src="${src}" controls style="display:block;width:320px"></audio></body></html>`);
  const menu = await apriMenu(page, '#a');
  await menu.voce('Trascrivi').click();
  await expect.poll(() => testo(app, page, '.sn-popup'), { timeout: 30_000 }).toMatch(/credit/i);
  console.log('POPUP 402:', await testo(app, page, '.sn-popup'));
});

async function chatFinta(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' } });
    globalThis.SN_TRASCRIVI_MEDIA_MAIN._dip.scarica = (url, opts) => fetch(url, opts);
    globalThis.SN_TRASCRIVI_MEDIA_MAIN._ricordate.clear();
    globalThis.__esiti = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const ultima = messages.map((m) => m.role).lastIndexOf('user');
      const esiti = messages.slice(ultima + 1).filter((m) => m.role === 'tool').map((m) => String(m.content || ''));
      if (!esiti.length) {
        const url = (/https?:\/\/\S+/.exec(String(messages[ultima]?.content || '')) || [''])[0];
        return { ...base, text: '', toolCalls: [{ id: `t${ultima}`, name: 'web', arguments: JSON.stringify({ azione: 'trascrivi', url }) }], finishReason: 'tool_calls' };
      }
      globalThis.__esiti.push(...esiti);
      const tutto = esiti.join('\n');
      const t = /PEZZO-\d/.test(tutto) ? `RISPOSTA: ${(tutto.match(/PEZZO-\d/g) || []).join(' ')}` : `ALTRO: ${tutto.slice(0, 300)}`;
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
  });
}

test('chat: indirizzo di una scheda aperta con un audio blob: usa quel media', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  await chatFinta(app);
  const b64 = wav(4).toString('base64');
  const scheda = await testServer.openReady(openTab, `<!doctype html><html><body>
    <audio id="a" controls></audio>
    <script>const b = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0));
    document.getElementById('a').src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));</script></body></html>`);
  const url = scheda.url();
  const page = await openTab('filo://newtab/');
  await page.locator('#input').fill(`trascrivi ${url}`);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText(/RISPOSTA|ALTRO/, { timeout: 60_000 });
  console.log('CHAT SCHEDA:', await page.locator('.dash-bubble-filo').last().innerText());
  console.log('ESITI SCHEDA:', (await app.evaluate(() => globalThis.__esiti)).join('\n').slice(0, 800));
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA: PEZZO-1');
});

test('chat: indirizzo di un mp4', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  await chatFinta(app);
  const src = testServer.asset(readFileSync(join(DIR, 'prova.mp4')), 'video/mp4');
  const page = await openTab('filo://newtab/');
  await page.locator('#input').fill(`trascrivi ${src}`);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText(/RISPOSTA|ALTRO/, { timeout: 60_000 });
  console.log('CHAT MP4:', await page.locator('.dash-bubble-filo').last().innerText());
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA: PEZZO-1 PEZZO-2');
});
