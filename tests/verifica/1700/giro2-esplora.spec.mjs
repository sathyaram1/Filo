// Verifica #1700 giro 2: esplorazione dei due cammini (seguito al ricaricamento, «Chat nuova» dopo la finestra piena).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

async function copione(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__v_orig) globalThis.__v_orig = { stream: P.streamCompleteWithFallback, secca: P.completeWithFallback };
    globalThis.__v_calls = [];
    let n = 0;
    const chat = async ({ attempts, messages, onDelta, signal }) => {
      globalThis.__v_calls.push(JSON.stringify(messages));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.ritardoMs) {
        await new Promise((ok, no) => {
          const t = setTimeout(ok, giro.ritardoMs);
          if (signal) signal.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('fermato'), { name: 'AbortError' })); }, { once: true });
        });
      }
      if (giro.pieno) throw Object.assign(new Error('This endpoint\'s maximum context length exceeded. Please reduce the length of the messages.'), { status: 400 });
      const calls = giro.toolCalls || [];
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
    P.streamCompleteWithFallback = chat;
    P.completeWithFallback = async (o) => {
      if (Array.isArray(o.tools) && o.tools.length) return chat(o);
      return { model: o.attempts[0].model, provider: o.attempts[0].provider, usage: {}, text: '', toolCalls: [], finishReason: 'stop' };
    };
  }, giri);
}
const chiamate = (app) => app.evaluate(() => globalThis.__v_calls || []);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    const o = globalThis.__v_orig;
    if (o) { globalThis.SN_PROVIDERS.streamCompleteWithFallback = o.stream; globalThis.SN_PROVIDERS.completeWithFallback = o.secca; }
  }).catch(() => {});
});

// Un'immagine w×h di un colore, incollata come dagli appunti.
function incolla(page, w, h, colore) {
  return page.evaluate(async ([w, h, colore]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = colore; x.fillRect(0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [w, h, colore]);
}
function allegaDocumento(page, percorso) {
  return page.evaluate((p) => {
    const dt = new DataTransfer();
    dt.setData('application/x-filo-file', p);
    document.getElementById('inputForm').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, percorso);
}
const larghezzeAnteprime = (page) => page.$$eval('#imgPreviews .dash-img-preview img', (xs) => xs.map((i) => i.naturalWidth));

test.skip('E1 chat nuova: testo, immagine, documento, bozza con la sua foto', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ pieno: true }]);
  await incolla(page, 7, 7, '#c00');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await allegaDocumento(page, '/tmp/guide/sentieri.pdf');
  await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveCount(1);
  await page.locator('#input').fill('cerca sentieri come quello della foto e leggimi le guide');
  await page.locator('#sendBtn').click();
  const nuova = page.locator('.dash-action-btn', { hasText: 'Chat nuova' });
  await expect(nuova).toBeVisible({ timeout: 30_000 });
  await page.locator('#input').fill('solo la prima guida');
  await incolla(page, 3, 3, '#00c');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await nuova.click();
  await expect(page.locator('#input')).toHaveValue('cerca sentieri come quello della foto e leggimi le guide\nsolo la prima guida');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(2);
  expect(await larghezzeAnteprime(page)).toEqual([7, 3]);
  await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/v1700-e1.png' });
  // E poi la si manda davvero: parte con le foto e il documento.
  await copione(app, [{ text: 'Ecco le guide.' }]);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco le guide.' })).toBeVisible({ timeout: 20_000 });
  const c = await chiamate(app);
  const ultima = c[c.length - 1];
  expect(ultima).toContain('sentieri.pdf');
  expect(ultima).toContain('solo la prima guida');
  await expect(page.locator('.dash-bubble-user').last().locator('.dash-bubble-img')).toHaveCount(2);
});

test.skip('E2 seguito con foto, ricarico: torna nella casella', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 6000, text: 'Risposta alla prima.' }, { text: 'Risposta al seguito.' }]);
  await page.locator('#input').fill('pensaci a lungo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await incolla(page, 5, 5, '#0c0');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await page.locator('#input').fill('seguito importante');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(1);
  const urlPrima = page.url();
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toHaveValue(/seguito importante/, { timeout: 10_000 });
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  console.log('URL prima', urlPrima, 'dopo', page.url(), 'stato', await page.evaluate(() => document.body.dataset.state));
  await page.waitForTimeout(8000);
  console.log('stato dopo 8s', await page.evaluate(() => document.body.dataset.state), 'bolle', await page.locator('.dash-bubble').count());
  await page.screenshot({ path: 'tests/.shots/v1700-e2.png' });
  // Mandarlo adesso: continua la conversazione di prima?
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al seguito.' })).toBeVisible({ timeout: 20_000 });
  const c = await chiamate(app);
  console.log('ultima chiamata contiene la prima domanda:', c[c.length - 1].includes('pensaci a lungo'), 'e la sua risposta:', c[c.length - 1].includes('Risposta alla prima.'));
  console.log('risposta alla prima a schermo:', await page.locator('.dash-bubble-filo', { hasText: 'Risposta alla prima.' }).count());
  await page.screenshot({ path: 'tests/.shots/v1700-e2b.png' });
});

test.skip('E3 seguito di solo testo, ricarico durante il turno: non arriva due volte', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 2500 }, { ritardoMs: 4000, text: 'Risposta alla prima.' }, { text: 'Altro.' }]);
  await page.locator('#input').fill('pensaci a lungo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await page.locator('#input').fill('seguito solo testo');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toHaveValue(/seguito solo testo/, { timeout: 10_000 });
  await page.waitForTimeout(9000);
  const c = await chiamate(app);
  console.log('chiamate', c.length, c.map((x) => x.includes('seguito solo testo')));
  expect(c.some((x) => x.includes('seguito solo testo'))).toBe(false);
});

test.skip('E4 seguito risposto, poi ricarico: la casella resta vuota', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 2500, text: 'Risposta alla prima.' }, { text: 'Risposta al seguito.' }]);
  await page.locator('#input').fill('pensaci a lungo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await incolla(page, 5, 5, '#0c0');
  await page.locator('#input').fill('seguito con foto');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al seguito.' })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(0);
});

test.skip('E5 seguito con foto e scheda chiusa: resta nella conversazione con la foto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await home(app);
  await copione(app, [{ ritardoMs: 4000, text: 'Risposta alla prima.' }]);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await page.locator('#input').fill('domanda della scheda che chiudo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await incolla(page, 5, 5, '#0c0');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await page.locator('#input').fill('seguito della scheda chiusa');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(1);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs; if (!tm) continue;
      tm.closeTab(tm.activeId);
    }
  });
  await new Promise((ok) => setTimeout(ok, 8000));
  const chat = await app.evaluate(async () => {
    const lista = await globalThis.SN_FILO_CHATS.listIndex();
    for (const x of lista) {
      const c = await globalThis.SN_FILO_CHATS.get(x.id);
      if (c && c.messages.some((m) => String(m.text || '').includes('domanda della scheda che chiudo'))) {
        return { id: x.id, messages: c.messages.map((m) => ({ role: m.role, text: m.text, images: m.images })) };
      }
    }
    return null;
  });
  console.log(JSON.stringify(chat));
  expect(chat.messages.filter((m) => String(m.text).includes('seguito della scheda chiusa'))).toHaveLength(1);
  const p2 = await openTab(`filo://newtab/?chat=${chat.id}`);
  await expect(p2.locator('.dash-bubble-user', { hasText: 'seguito della scheda chiusa' })).toBeVisible({ timeout: 10_000 });
  await p2.waitForTimeout(1000);
  await p2.screenshot({ path: 'tests/.shots/v1700-e5.png' });
  await expect(p2.locator('.dash-bubble-user', { hasText: 'seguito della scheda chiusa' }).locator('img')).toHaveCount(1);
});

const leggi = (id) => ({ id, name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['contatori-anonimi'] }) });
const chatCon = (app, testo) => app.evaluate(async (_e, testo) => {
  for (const x of await globalThis.SN_FILO_CHATS.listIndex()) {
    const c = await globalThis.SN_FILO_CHATS.get(x.id);
    if (c && c.messages.some((m) => String(m.text || '').includes(testo))) return { id: x.id, messages: c.messages.map((m) => ({ role: m.role, text: m.text, images: m.images })) };
  }
  return null;
}, testo);

test.skip('E7 seguito letto dal turno, poi ricarico: nella conversazione una volta, casella vuota', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 2500, toolCalls: [leggi('c1')] }, { ritardoMs: 5000, text: 'Risposta finale.' }]);
  await page.locator('#input').fill('domanda con strumenti');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await page.locator('#input').fill('seguito letto dal turno');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await new Promise((ok) => setTimeout(ok, 8000));
  await expect(page.locator('#input')).toHaveValue('');
  const chat = await chatCon(app, 'domanda con strumenti');
  console.log('E7', JSON.stringify(chat));
  const c = await chiamate(app);
  console.log('E7 chiamate', c.length, c.map((x) => (x.match(/seguito letto dal turno/g) || []).length));
});

test.skip('E8 turno che rifiuta per finestra piena con un seguito con foto, poi bozza e Chat nuova', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 3000, pieno: true }]);
  await incolla(page, 7, 7, '#c00');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await page.locator('#input').fill('primo messaggio');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await incolla(page, 5, 5, '#0c0');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await page.locator('#input').fill('seguito con foto');
  await page.locator('#input').press('Enter');
  const nuova = page.locator('.dash-action-btn', { hasText: 'Chat nuova' });
  await expect(nuova).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#input')).toHaveValue('seguito con foto', { timeout: 5000 });
  await page.locator('#input').fill('seguito con foto\nbozza mia');
  await incolla(page, 3, 3, '#00c');
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(2);
  await nuova.click();
  await expect(page.locator('#input')).toHaveValue('primo messaggio\nseguito con foto\nbozza mia');
  console.log('E8 larghezze', await larghezzeAnteprime(page));
  await page.screenshot({ path: 'tests/.shots/v1700-e8.png' });
});

async function citaERicordaSeguito(page, app) {
  await copione(app, [{ text: 'Risotto ai funghi oppure pasta.' }, { ritardoMs: 5000, text: 'Risposta lenta.' }, { text: 'Risposta al seguito.' }]);
  await page.locator('#input').fill('cosa cucino?');
  await page.locator('#sendBtn').click();
  const risposta = page.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risotto ai funghi' });
  await expect(risposta).toBeVisible({ timeout: 20_000 });
  await expect(risposta).toHaveAttribute('data-key', /^m:/, { timeout: 10_000 });
  await page.locator('#input').fill('una domanda lenta');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await risposta.hover();
  await risposta.locator('.dash-msg-azioni').getByRole('button', { name: 'Rispondi' }).click();
  await expect(page.locator('#citazione')).toBeVisible();
  await page.locator('#input').fill('il risotto per favore');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(1);
}

test('E9 seguito che cita, ricarico: torna con la citazione', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await citaERicordaSeguito(page, app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toHaveValue(/il risotto per favore/, { timeout: 10_000 });
  await expect(page.locator('#citazione')).toBeVisible();
  await expect(page.locator('#citazione')).toContainText('Risotto ai funghi');
});

test('E10 seguito che cita, scheda chiusa: nella conversazione con la citazione', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await home(app);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await citaERicordaSeguito(page, app);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) { const tm = w._filoTabs; if (tm) tm.closeTab(tm.activeId); }
  });
  await new Promise((ok) => setTimeout(ok, 8000));
  const r = await app.evaluate(async () => {
    const chats = await globalThis.SN_IL_FILO.chats();
    const mia = chats.flatMap((c) => c.messages).filter((m) => m.role === 'user' && m.text === 'il risotto per favore');
    return mia.map((m) => m.rispostaA || null);
  });
  console.log('E10', JSON.stringify(r));
  expect(r).toHaveLength(1);
  expect(r[0]).not.toBeNull();
});
