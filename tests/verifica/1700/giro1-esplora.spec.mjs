// Verifica #1700, giro 1: quello che l'utente scrive o allega non si perde (seguito al ricaricamento o a scheda
// chiusa, «Chat nuova» sotto la finestra piena). Modello finto: lento o che rifiuta per finestra piena.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, quadratoPronto } from '../../helpers/copione.mjs';

// `modo`: 'lento' ragiona per `ms` e risponde; 'pieno' rifiuta per finestra piena. Registra i messaggi ricevuti.
async function modello(app, modo, ms = 6000) {
  await app.evaluate(async (_, { modo, ms }) => {
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    if (!globalThis.__messaggi) globalThis.__messaggi = [];
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta }) => {
      globalThis.__messaggi.push(JSON.parse(JSON.stringify(messages)));
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (modo === 'pieno') {
        const e = new Error('This endpoint\'s maximum context length is 8192 tokens. However, you requested about 90000 tokens.');
        e.status = 400;
        throw e;
      }
      const passi = Math.max(1, Math.round(ms / 300));
      for (let i = 0; i < passi; i++) {
        try { onReasoning && onReasoning(`Penso ${i}. `); } catch (_) {}
        await new Promise((ok, ko) => {
          const t = setTimeout(ok, 300);
          if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
        });
      }
      const testo = `Risposta ${globalThis.__messaggi.length}.`;
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, { modo, ms });
}

async function incollaFoto(page, colore = '#c0392b') {
  const prima = await page.locator('#imgPreviews .dash-img-preview img').count();
  await page.evaluate(async (colore) => {
    const dt = new DataTransfer();
    const cv = new OffscreenCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = colore;
    ctx.fillRect(0, 0, 16, 16);
    dt.items.add(new File([await cv.convertToBlob({ type: 'image/png' })], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, colore);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(prima + 1, { timeout: 5000 });
}

// Un documento trascinato nel campo, come da un file trovato nella chat.
async function allegaDocumento(page, percorso) {
  await page.evaluate((percorso) => {
    const dt = new DataTransfer();
    dt.setData('application/x-filo-file', percorso);
    document.getElementById('inputForm').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, percorso);
}

const DOC = process.platform === 'win32' ? 'C:\\guide\\sentieri.pdf' : '/tmp/guide/sentieri.pdf';

test('Chat nuova sotto la finestra piena: torna testo, foto e documento, la bozza resta con la sua foto, e la chat nuova parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await modello(app, 'pieno');
  await incollaFoto(page);
  await allegaDocumento(page, DOC);
  await expect(page.locator('.dash-file-chip')).toHaveCount(1);
  await page.locator('#input').fill('cerca sentieri come quello della foto e leggimi le guide');
  await page.locator('#sendBtn').click();
  const nuova = page.locator('button', { hasText: 'Chat nuova' });
  await expect(nuova).toBeVisible({ timeout: 20_000 });
  await page.locator('#input').fill('solo la prima guida');
  await incollaFoto(page, '#2980b9');
  await nuova.click();
  await expect(page.locator('#input')).toHaveValue('cerca sentieri come quello della foto e leggimi le guide\nsolo la prima guida');
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(2);
  await expect(page.locator('.dash-file-chip')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/1700-chat-nuova.png' });
  // La chat nuova parte davvero, col modello che stavolta risponde, e porta foto e documento.
  await modello(app, 'lento', 300);
  const n = await app.evaluate(() => globalThis.__messaggi.length);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: /Risposta \d+\./ })).toBeVisible({ timeout: 20_000 });
  const ultima = await app.evaluate((n) => globalThis.__messaggi[n], n);
  const testo = JSON.stringify(ultima);
  expect(testo).toContain('solo la prima guida');
  expect(testo).toContain('sentieri.pdf');
  expect((testo.match(/data:image\//g) || []).length).toBeGreaterThanOrEqual(2);
  // Chat nuova davvero: il messaggio fallito non c'è due volte.
  expect((testo.match(/cerca sentieri come quello/g) || []).length).toBe(1);
});

test('seguito con foto e documento, pagina ricaricata: torna nella casella com\'era', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = await newtabPage(app);
  await configureModel(app);
  await modello(app, 'lento', 12_000);
  await page.locator('#input').fill('domanda lunga');
  await page.locator('#sendBtn').click();
  await quadratoPronto(page);
  // Primo seguito di sole parole (affidato al turno), secondo con foto e documento.
  await page.locator('#input').fill('primo seguito');
  await page.locator('#input').press('Enter');
  await incollaFoto(page);
  await allegaDocumento(page, DOC);
  await page.locator('#input').fill('seguito importante');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(2);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toHaveValue('primo seguito\nseguito importante', { timeout: 10_000 });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1);
  await expect(page.locator('.dash-file-chip')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/1700-ricarica.png' });
  // Il turno di prima finisce senza leggere il seguito tornato: non arriva due volte.
  await expect.poll(() => app.evaluate(() => globalThis.__messaggi.length), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(13_000);
  const tutti = JSON.stringify(await app.evaluate(() => globalThis.__messaggi));
  expect(tutti).not.toContain('primo seguito');
});

test('seguito a scheda chiusa: resta nella conversazione quando la si riapre', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await modello(app, 'lento', 5000);
  await page.locator('#input').fill('domanda lunga da scheda');
  await page.locator('#sendBtn').click();
  await quadratoPronto(page);
  await incollaFoto(page);
  await page.locator('#input').fill('seguito da non perdere');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(1);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const t = tm.tabs.find((x) => String(x.url || '').startsWith('filo://newtab'));
    tm.openTab('filo://newtab/');
    tm.closeTab(t.id);
  });
  const trova = () => app.evaluate(async () => {
    const F = globalThis.SN_FILO_CHATS;
    for (const c of await F.list()) {
      const m = (c.messages || []).map((x) => `${x.role}: ${x.text}`);
      if (m.some((x) => x.includes('domanda lunga da scheda'))) return m;
    }
    return null;
  });
  await expect.poll(async () => JSON.stringify(await trova()), { timeout: 30_000 }).toContain('seguito da non perdere');
  const m = await trova();
  // Dopo la risposta alla domanda di prima.
  expect(m.findIndex((x) => x.includes('seguito da non perdere'))).toBeGreaterThan(m.findIndex((x) => /Risposta/.test(x)));
});
