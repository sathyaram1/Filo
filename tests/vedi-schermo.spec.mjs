// #778 — «cosa mi sta chiedendo questa finestra?»: Filo guarda la finestra, la fa leggere al modello di «Descrivi
// immagine» e risponde col testo che c'è. Il contenitore delle prove non ha finestre di altre app (Xvfb senza window
// manager): il sistema sotto la cattura è finto e dipinge ogni finestra di un colore suo, il modello che vede è finto e
// «legge» il testo noto solo se il colore della finestra giusta gli è arrivato davvero. La finestra di Filo invece si
// cattura per davvero. Le asserzioni sono quelle della segnalazione: testo noto nella risposta, un popup solo nella
// richiesta, niente cattura da spenta, nessuna immagine su disco.

import { test, expect } from './fixtures/electron.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { home, chiedi } from './helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd } from './helpers/confirm.mjs';

const ESTERNA = 'Errore - Programma di prova';
const NOTO = 'TESTO-NOTO-778';
const VERDE = [0x12, 0xab, 0x34];
const ROSA = [0xe0, 0x40, 0xa0];

// Le finestre delle altre app: ognuna del suo colore. Conta le richieste al sistema e le catture.
async function finestreFinte(app) {
  await app.evaluate(({ nativeImage }, { verde, rosa, esterna }) => {
    globalThis.__vs_fonti = 0;
    globalThis.__vs_catture = 0;
    const tinta = ([r, g, b], w = 640, h = 360) => {
      const buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < buf.length; i += 4) { buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h });
    };
    globalThis.SN_SCHERMO._perProve.usaSistema({
      piattaforma: () => 'win32',
      wayland: () => false,
      permessoMac: () => 'granted',
      fonti: async ({ lato = 0 } = {}) => {
        globalThis.__vs_fonti += 1;
        if (lato > 0) globalThis.__vs_catture += 1;
        return [
          { id: 'window:4242:0', nome: esterna, tipo: 'finestra', displayId: '', immagine: lato > 0 ? tinta(verde) : null },
          { id: 'window:4343:0', nome: 'Note - Blocco note', tipo: 'finestra', displayId: '', immagine: lato > 0 ? tinta(rosa) : null },
          { id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: '1', immagine: lato > 0 ? tinta(rosa, 1280, 720) : null },
        ];
      },
    });
  }, { verde: VERDE, rosa: ROSA, esterna: ESTERNA });
}

// Il modello che vede: legge il testo noto solo se al centro dell'immagine c'è il verde della finestra giusta.
async function occhioFinto(app) {
  await app.evaluate(({ nativeImage }, { verde, noto }) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__vs_occhio = [];
    P.completeWithFallback = async ({ attempts, messages }) => {
      const parti = (messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const img = parti.find((p) => p && p.type === 'image_url');
      let colore = null;
      if (img) {
        const ni = nativeImage.createFromDataURL(img.image_url.url);
        const { width, height } = ni.getSize();
        const b = ni.toBitmap();
        const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
        colore = [b[i + 2], b[i + 1], b[i]];
        globalThis.__vs_occhio.push({
          colore,
          domanda: parti.filter((p) => p.type === 'text').map((p) => p.text).join('\n'),
          pezzo: img.image_url.url.slice(400, 480),
        });
      }
      const giusta = colore && colore.every((c, k) => Math.abs(c - verde[k]) < 24);
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop',
        text: giusta ? `Il dialogo chiede: «${noto}: salvare le modifiche?». Pulsanti: Sì, No.` : 'Non è la finestra giusta.',
      };
    };
  }, { verde: VERDE, noto: NOTO });
}

// Il modello della chat: giri dati. `eco` risponde con il testo noto se gli è arrivato; `prima` fa un gesto
// dell'utente (cambiare scheda) prima di rispondere.
async function chatFinta(app, giri, { acceso = true } = {}) {
  await app.evaluate(async (_e, { g, acceso: on }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.DESCRIBE_IMAGE]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...(on ? { schermo: { guarda: true } } : {}),
    });
    globalThis.__vs_chat = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__vs_chat.push(JSON.stringify(messages));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.prima && globalThis.__vs_prima) await globalThis.__vs_prima(giro.prima);
      let text = giro.text || '';
      if (giro.eco) {
        const m = JSON.stringify(messages).match(new RegExp(giro.eco));
        text = m ? `La finestra dice: ${m[0]}` : 'Non ho visto niente.';
      }
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { g: giri, acceso });
}

const vedi = (id, args = {}) => ({ toolCalls: [{ id, name: 'VEDI_SCHERMO', arguments: JSON.stringify(args) }] });

async function contaPopup(page) {
  await page.evaluate(() => {
    window.__popup = [];
    const U = window.SN_CONFIRM_UI;
    const ok = U.confirm;
    const digita = U.confirmTyped;
    U.confirm = (o) => { window.__popup.push({ tipo: 'ok', testo: o.text }); return ok(o); };
    U.confirmTyped = (o) => { window.__popup.push({ tipo: 'conferma', testo: o.text }); return digita(o); };
  });
}

function fileSotto(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    let s;
    try { s = statSync(p); } catch (_) { continue; }
    if (s.isDirectory()) out.push(...fileSotto(p));
    else if (s.isFile() && s.size < 50 * 1024 * 1024) out.push(p);
  }
  return out;
}

test('accesa: la finestra di un\'altra app si guarda dopo un solo OK, e la risposta dice il testo che c\'è', async ({ app }) => {
  test.setTimeout(120_000);
  await finestreFinte(app);
  await occhioFinto(app);
  await chatFinta(app, [
    vedi('v1'),
    vedi('v2', { finestra: ESTERNA, domanda: 'cosa chiede il dialogo' }),
    { text: 'Aspetto il tuo OK per guardarla.' },
    // Dopo l'OK la richiesta riprende da sola: guarda di nuovo la stessa finestra (senza popup) e risponde.
    vedi('v3', { finestra: ESTERNA }),
    { eco: `${NOTO}[^»"\\\\]*` },
  ]);
  const page = await home(app);
  await contaPopup(page);
  await chiedi(page, 'cosa mi sta chiedendo la finestra del programma di prova?');

  // Il popup si apre da solo, dice quale finestra, e basta un clic (niente «conferma» da scrivere).
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  const stato = await confirmState(page);
  expect(stato.text).toContain(ESTERNA);
  expect(stato.hasInput).toBe(false);
  await page.screenshot({ path: 'tests/.shots/vedi-schermo-popup.png' });
  // Prima dell'OK niente è stato catturato.
  expect(await app.evaluate(() => globalThis.__vs_catture)).toBe(0);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');

  await expect(page.locator('.dash-bubble-filo', { hasText: NOTO })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'tests/.shots/vedi-schermo-risposta.png' });
  const popup = await page.evaluate(() => window.__popup);
  expect(popup.map((p) => p.tipo)).toEqual(['ok']);
  // Due occhiate alla finestra verde: quella dell'OK e quella della prosecuzione, con la domanda dell'utente.
  const viste = await app.evaluate(() => globalThis.__vs_occhio);
  expect(viste).toHaveLength(2);
  for (const v of viste) expect(v.colore.every((c, k) => Math.abs(c - VERDE[k]) < 24)).toBe(true);
  expect(viste[0].domanda).toContain('cosa mi sta chiedendo la finestra del programma di prova?');
  expect(viste[0].domanda).toContain(ESTERNA);
  // Il testo è arrivato al giro della chat imbustato come contenuto esterno.
  const chat = await app.evaluate(() => globalThis.__vs_chat);
  const ultimo = chat[chat.length - 1];
  expect(ultimo).toContain(NOTO);
  expect(ultimo).toContain('<<<FINESTRA_GUARDATA>>>');
  // L'elenco era arrivato al modello come titoli scritti da altri.
  expect(chat[1]).toContain('<<<FINESTRE_APERTE>>>');
  expect(chat[1]).toContain(ESTERNA);
  // La prima che dà il sistema è quella appena lasciata: il modello sa che è «questa finestra».
  expect(chat[1]).toContain(`${ESTERNA} (in primo piano`);

  // Dopo il turno: l'immagine non c'è in nessun file di Filo, e l'archivio della chat tiene il nome della finestra.
  const dati = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const archivio = join(dati, 'filo', 'eventi.jsonl');
  await expect.poll(() => { try { return readFileSync(archivio, 'utf8').includes('"guardate"'); } catch (_) { return false; } }, { timeout: 10_000 }).toBe(true);
  expect(readFileSync(archivio, 'utf8')).toContain(ESTERNA);
  for (const f of fileSotto(dati)) {
    const testo = readFileSync(f).toString('latin1');
    for (const v of viste) expect(testo.includes(v.pezzo), `${f} contiene l'immagine`).toBe(false);
    if (/storage\.json$|eventi\.jsonl$/.test(f)) expect(testo.includes('data:image/'), f).toBe(false);
  }
});

test('spenta: la stessa richiesta non cattura niente e propone di accenderla con un clic', async ({ app }) => {
  test.setTimeout(90_000);
  await finestreFinte(app);
  await occhioFinto(app);
  await chatFinta(app, [
    vedi('v1', { finestra: ESTERNA }),
    { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'guarda_schermo', valore: true }) }] },
    { text: 'Per guardarla devo poter vedere lo schermo: te lo chiedo.' },
    { text: 'Ora posso guardare lo schermo.' },
  ], { acceso: false });
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).schermo)).toEqual({ guarda: false });
  const page = await home(app);
  await contaPopup(page);
  await chiedi(page, 'cosa mi sta chiedendo la finestra del programma di prova?');

  // L'offerta è il popup dell'impostazione, con quello che comporta: un OK, non la parola da scrivere.
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  const stato = await confirmState(page);
  expect(stato.text).toMatch(/guardare lo schermo/i);
  expect(stato.text).toMatch(/modello che vede le immagini/);
  expect(stato.hasInput).toBe(false);
  await page.screenshot({ path: 'tests/.shots/vedi-schermo-spenta.png' });
  expect(await app.evaluate(() => globalThis.__vs_fonti)).toBe(0);
  expect(await app.evaluate(() => globalThis.__vs_occhio.length)).toBe(0);
  const chat = await app.evaluate(() => globalThis.__vs_chat);
  expect(chat[1]).toContain('è spenta');
  expect(chat[1]).toContain('IMPOSTA_PREFERENZA');

  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).schermo)).guarda, { timeout: 10_000 }).toBe(true);
  // Con l'OK la richiesta riprende da sola.
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ora posso guardare lo schermo.' })).toBeVisible({ timeout: 20_000 });
  expect(await app.evaluate(() => globalThis.__vs_catture)).toBe(0);
});

test('la finestra di Filo si guarda senza chiedere, con la cattura vera della scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await occhioFinto(app);
  const url = testServer.html('<title>Ricetta della pasta</title><body style="margin:0;background:#12ab34;height:100vh"></body>');
  await openTab(url);
  await app.evaluate(({ BrowserWindow }, indirizzo) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const scheda = (cosa) => tm.tabs.find((t) => (cosa === 'pagina' ? String(t.url).startsWith(indirizzo) : /^filo:\/\/newtab/.test(String(t.url))));
    // L'utente torna alla pagina mentre Filo lavora, poi alla chat.
    globalThis.__vs_prima = async (cosa) => { tm.activate(scheda(cosa).id); await new Promise((r) => setTimeout(r, 400)); };
    tm.activate(scheda('home').id);
  }, url);
  await chatFinta(app, [
    { prima: 'pagina', ...vedi('v1', { finestra: 'Ricetta della pasta' }) },
    { prima: 'home', eco: `${NOTO}[^»"\\\\]*` },
  ]);
  const page = await home(app);
  await contaPopup(page);
  await chiedi(page, 'cosa c\'è nella finestra della ricetta?');
  await expect(page.locator('.dash-bubble-filo', { hasText: NOTO })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__popup)).toEqual([]);
  const viste = await app.evaluate(() => globalThis.__vs_occhio);
  expect(viste).toHaveLength(1);
  expect(viste[0].colore.every((c, k) => Math.abs(c - VERDE[k]) < 24)).toBe(true);
});

test('due finestre nella stessa risposta: un popup per ciascuna, in fila, e una ripresa sola dopo l\'ultimo', async ({ app }) => {
  test.setTimeout(120_000);
  await finestreFinte(app);
  await occhioFinto(app);
  // Due azioni ferme sulla conferma col testo insieme: il modello riparte una volta e risponde (#1130).
  await chatFinta(app, [
    { text: 'Aspetto i tuoi OK.', toolCalls: [
      { id: 'a1', name: 'VEDI_SCHERMO', arguments: JSON.stringify({ finestra: ESTERNA }) },
      { id: 'a2', name: 'VEDI_SCHERMO', arguments: JSON.stringify({ finestra: 'Note - Blocco note' }) },
    ] },
    { text: 'Aspetto i tuoi OK.' },
    { eco: `${NOTO}[^»"\\\\]*` },
  ]);
  const page = await home(app);
  await contaPopup(page);
  await chiedi(page, 'confronta le due finestre aperte');
  for (const nome of [ESTERNA, 'Note - Blocco note']) {
    await expect.poll(async () => (await confirmState(page))?.text || '', { timeout: 20_000 }).toContain(nome);
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
  }
  await expect(page.locator('.dash-bubble-filo', { hasText: NOTO })).toBeVisible({ timeout: 30_000 });
  expect((await page.evaluate(() => window.__popup)).length).toBe(2);
  // Un turno per la richiesta e UNA ripresa: tre chiamate al modello della chat, non quattro.
  await page.waitForTimeout(1500);
  expect((await app.evaluate(() => globalThis.__vs_chat)).length).toBe(3);
  expect((await app.evaluate(() => globalThis.__vs_occhio)).length).toBe(2);
});

test('l\'interruttore in Preferenze parte spento, accende e spegne davvero, e si legge nei due temi', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://preferences/preferences.html');
  const casella = page.locator('#schermoGuarda');
  await expect(casella).not.toBeChecked();
  const leggi = async () => (await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).schermo || {})).guarda;
  await casella.check();
  await expect.poll(leggi, { timeout: 10_000 }).toBe(true);
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } },
      { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }), tema);
    await page.waitForTimeout(500);
    await page.locator('#sec-schermo').scrollIntoViewIfNeeded();
    await page.locator('#sec-schermo').screenshot({ path: `tests/.shots/vedi-schermo-preferenze-${tema}.png` });
  }
  await casella.uncheck();
  await expect.poll(leggi, { timeout: 10_000 }).toBe(false);
});
