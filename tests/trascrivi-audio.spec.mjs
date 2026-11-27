// #1815 (#1660, #519): il parlato di un audio o di un video diventa testo. Dal tasto destro su un <audio>, su un lettore
// disegnato dal sito (con l'audio nascosto o suonato fuori dal documento), e dalla chat con un indirizzo. Il modello della
// dettatura è finto nel main: risponde col numero del pezzo, così si vede che i pezzi arrivano tutti e in ordine.

import { test, expect } from './fixtures/electron.mjs';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { menuDi } from './helpers/menuContestuale.mjs';
import { statoDi, paginaDelloStrato, conta } from './helpers/riquadri.mjs';

// WAV vero (8 kHz, 16 bit): `secondi` di tono, che Chromium decodifica come un file qualunque.
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

// Il modello della dettatura risponde «PEZZO-n» al pezzo n-esimo che riceve e tiene i secondi di ciascuno.
async function trascrittoreFinto(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models },
    });
    globalThis.__pezzi = [];
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64, format }) => {
      const byte = Buffer.from(String(audioBase64 || ''), 'base64');
      const secondi = (byte.length - 44) / 32000;
      const n = globalThis.__pezzi.push({ format, secondi });
      return { text: ` PEZZO-${n} `, usage: { seconds: secondi, costUsd: 0.0001 }, generationId: null };
    };
  });
}

async function apriMenu(page, selettore) {
  await page.locator(selettore).click({ button: 'right', position: { x: 10, y: 10 } });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  return menu;
}

const testoDelRiquadro = async (app, page) => (await statoDi(app, page, '.sn-popup-body'))?.testo || '';

test('tasto destro su un <audio>: «Trascrivi» scrive il parlato pezzo dopo pezzo, «Salva audio come…» salva i byte', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  const audio = wav(70);
  const src = testServer.asset(audio, 'audio/wav');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Intervista</h1><audio id="a" src="${src}" controls style="display:block;width:320px"></audio></body></html>`);

  let menu = await apriMenu(page, '#a');
  await expect(menu.voce('Trascrivi')).toBeVisible();
  await expect(menu.voce('Salva audio come')).toBeVisible();
  await menu.voce('Trascrivi').click();

  // 70 s → tre pezzi di al più mezzo minuto che insieme fanno tutto l'audio: il testo li ha tutti, in ordine.
  await expect.poll(() => testoDelRiquadro(app, page), { timeout: 60_000 }).toMatch(/PEZZO-\d[\s\S]*PEZZO-\d[\s\S]*PEZZO-\d/);
  const pezzi = await app.evaluate(() => globalThis.__pezzi);
  expect(pezzi.length).toBe(3);
  expect(pezzi.every((p) => p.format === 'wav' && p.secondi <= 32)).toBe(true);
  expect(Math.abs(pezzi.reduce((s, p) => s + p.secondi, 0) - 70)).toBeLessThan(0.1);
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-meta'))?.testo || '', { timeout: 10_000 }).toMatch(/durata 1:10/);
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-popup .sn-msg-copia')).toBeVisible();
  await strato.screenshot({ path: join('tests', '.shots', 'trascrivi-audio-riquadro.png') });

  // «Salva audio come…»: il file arriva negli scaricamenti coi byte giusti.
  menu = await apriMenu(page, '#a');
  await menu.voce('Salva audio come').click();
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  let nome = '';
  await expect.poll(() => {
    nome = existsSync(dir) ? readdirSync(dir).find((f) => !/\.(part|crdownload)$/.test(f) && readFileSync(join(dir, f)).length === audio.length) || '' : '';
    return nome;
  }, { timeout: 20_000 }).not.toBe('');
  expect(readFileSync(join(dir, nome)).equals(audio)).toBe(true);
});

test('un lettore disegnato dal sito con l\'audio blob: nascosto, e uno che suona fuori dal documento: «Trascrivi» c\'è e trascrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  const b64 = wav(4).toString('base64');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <div class="bolla" id="nascosto" style="width:300px;height:56px;border-radius:12px;background:#dcf8c6;display:flex;align-items:center;gap:8px;padding:0 12px">
      <span class="tasto">▶</span><span class="onda" id="onda1" style="flex:1;height:20px;background:#9c9">&nbsp;</span>
      <audio id="nascosto-audio" style="display:none"></audio>
    </div>
    <div style="height:600px"></div>
    <div class="bolla" id="staccato" style="width:300px;height:56px;border-radius:12px;background:#dcf8c6;display:flex;align-items:center;gap:8px;padding:0 12px">
      <button id="play" type="button">▶</button><span class="onda" id="onda2" style="flex:1;height:20px;background:#9c9">&nbsp;</span>
    </div>
    <p id="altro">Un messaggio di testo qualunque, lontano dai vocali.</p>
    <script>
      const bytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      document.getElementById('nascosto-audio').src = url;
      // Come WhatsApp Web: l'audio nasce al clic, fuori dal documento, e suona da lì.
      document.getElementById('play').addEventListener('click', () => { const a = new Audio(url); a.muted = true; a.play().catch(() => {}); });
    </script></body></html>`);

  // Un testo lontano dai lettori non porta «Trascrivi»: il menu non promette quello che non c'è.
  let menu = await apriMenu(page, '#altro');
  await expect(menu.voce('Trascrivi')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Il vocale suonato fuori dal documento non ha ancora il file prima del primo ascolto: niente voce.
  menu = await apriMenu(page, '#onda2');
  await expect(menu.voce('Trascrivi')).toHaveCount(0);
  await page.keyboard.press('Escape');

  menu = await apriMenu(page, '#onda1');
  await expect(menu.voce('Trascrivi')).toBeVisible();
  await expect(menu.voce('Salva audio come')).toBeVisible();
  await menu.voce('Trascrivi').click();
  await expect.poll(() => testoDelRiquadro(app, page), { timeout: 60_000 }).toContain('PEZZO-1');
  await (await paginaDelloStrato(app, page)).locator('.sn-popup-close').click();
  await expect.poll(() => conta(app, page, '.sn-popup'), { timeout: 10_000 }).toBe(0);

  await page.locator('#play').click();
  menu = await apriMenu(page, '#onda2');
  await expect(menu.voce('Trascrivi')).toBeVisible();
  await expect(menu.voce('Salva audio come')).toBeVisible();
  await menu.voce('Trascrivi').click();
  await expect.poll(() => testoDelRiquadro(app, page), { timeout: 60_000 }).toContain('PEZZO-2');
});

// La chat: il modello finto chiama web(trascrivi) con l'indirizzo che l'utente ha scritto, e risponde col testo che
// gli è tornato dallo strumento. Lo scaricatore vero rifiuta 127.0.0.1: qui passa.
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
      // Gli esiti di questo turno: dopo l'ultima domanda dell'utente.
      const ultimaDomanda = messages.map((m) => m.role).lastIndexOf('user');
      const esiti = messages.slice(ultimaDomanda + 1).filter((m) => m.role === 'tool').map((m) => String(m.content || ''));
      if (!esiti.length) {
        const url = (/http:\/\/127\.0\.0\.1:\d+\/\w+/.exec(String(messages[ultimaDomanda]?.content || '')) || [''])[0];
        return { ...base, text: '', toolCalls: [{ id: `t${ultimaDomanda}`, name: 'web', arguments: JSON.stringify({ azione: 'trascrivi', url }) }], finishReason: 'tool_calls' };
      }
      globalThis.__esiti.push(...esiti);
      const tutto = esiti.join('\n');
      const testo = /PEZZO-\d/.test(tutto) ? `Ecco la trascrizione: ${(tutto.match(/PEZZO-\d/g) || []).join(' ')}`
        : /non è un audio o un video/.test(tutto) ? 'Quell\'indirizzo non è un audio o un video.' : 'NIENTE';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('in chat: «trascrivi <indirizzo>» risponde col parlato; un indirizzo che non è un media lo dice', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await trascrittoreFinto(app);
  await chatFinta(app);
  const wavUrl = testServer.asset(wav(40), 'audio/wav');
  const page = await openTab('filo://newtab/');

  await chiedi(page, `trascrivi ${wavUrl}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la trascrizione: PEZZO-1 PEZZO-2' })).toBeVisible({ timeout: 60_000 });
  const esiti = await app.evaluate(() => globalThis.__esiti);
  expect(esiti.join('\n')).toMatch(/0:40/);

  const pagina = testServer.html('<!doctype html><html><body><p>Solo testo, nessun audio.</p></body></html>');
  await chiedi(page, `trascrivi ${pagina}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'non è un audio o un video' })).toBeVisible({ timeout: 30_000 });
});
