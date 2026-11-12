// #1296.1 — Un seguito in attesa sembra già mandato: non si perde con la pagina. Ricaricata la scheda torna nella
// casella com'era (testo e immagine); chiusa la scheda resta nella conversazione, dopo la risposta alla domanda di prima.
// Il modello è finto e lento (helpers/copione.mjs): il seguito si scrive mentre Filo lavora.

import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina } from './helpers/copione.mjs';

const LENTO = { pensa: ['Ci penso. ', 'Ancora. ', 'Quasi. ', 'Ecco. '], ogni: 700, testo: 'Prima risposta.' };

async function incollaFoto(page) {
  await page.evaluate(async () => {
    const cv = new OffscreenCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#5a8';
    ctx.fillRect(0, 0, 16, 16);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
}

async function seguitoMentreLavora(page, testo, { foto = false } = {}) {
  await page.locator('#input').fill('prima domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.dash-activity-trama').first()).toContainText('Ci penso', { timeout: 5_000 });
  if (foto) await incollaFoto(page);
  await page.locator('#input').fill(testo);
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-user.dash-bubble-attesa', { hasText: testo })).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('#input')).toHaveValue('');
}

const messaggiDellaChat = (app, testo) => app.evaluate(async (_e, t) => {
  const elenco = await globalThis.SN_FILO_CHATS.list();
  for (const c of elenco) {
    const chat = await globalThis.SN_FILO_CHATS.get(c.id);
    if (chat && chat.messages.some((m) => m.text === t)) return chat.messages.map((m) => `${m.role}: ${m.text}${m.images ? ` [${m.images}]` : ''}`);
  }
  return [];
}, testo);

const idDellaChat = (app, testo) => app.evaluate(async (_e, t) => {
  for (const c of await globalThis.SN_FILO_CHATS.list()) {
    const chat = await globalThis.SN_FILO_CHATS.get(c.id);
    if (chat && chat.messages.some((m) => m.text === t)) return c.id;
  }
  return null;
}, testo);

test('ricaricata la pagina, il seguito con un\'immagine torna nella casella com\'era', async ({ app, shell }) => {
  test.setTimeout(60_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await copione(app, [LENTO, { testo: 'Risposta al seguito.' }]);
    await seguitoMentreLavora(page, 'seguito importante', { foto: true });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#input')).toHaveValue('seguito importante', { timeout: 10_000 });
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1);
    await page.screenshot({ path: 'tests/.shots/chat-seguito-ricarica.png' });
    // Ripreso una volta: un altro ricaricamento non lo raddoppia, e la casella lo tiene finché c'è la pagina.
    await page.waitForTimeout(4_000);
    expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
    await page.locator('#input').fill('');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);
    await expect(page.locator('#input')).toHaveValue('');
  } finally {
    await ripristina(app);
  }
});

test('ricaricata la pagina, un seguito di sole parole torna nella casella e non parte due volte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await copione(app, [LENTO, { testo: 'Risposta al seguito.' }]);
    await seguitoMentreLavora(page, 'e anche il meteo');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#input')).toHaveValue('e anche il meteo', { timeout: 10_000 });
    // La prima risposta arriva nell'archivio; il seguito, ripreso dalla pagina, non entra in quel turno.
    await expect.poll(() => messaggiDellaChat(app, 'prima domanda'), { timeout: 15_000 }).toContain('filo: Prima risposta.');
    expect(await messaggiDellaChat(app, 'prima domanda')).not.toContain('user: e anche il meteo');
    expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
  } finally {
    await ripristina(app);
  }
});

test('chiusa la scheda, il seguito resta nella conversazione dopo la risposta di prima', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await configureModel(app);
    await copione(app, [LENTO, { testo: 'Risposta al seguito.' }]);
    const page = await openTab('filo://newtab/');
    await seguitoMentreLavora(page, 'seguito con la foto', { foto: true });
    const foto = await page.locator('.dash-bubble-attesa img.dash-bubble-img').getAttribute('src');
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
      tm.closeTab(tm.activeId);
    });
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await expect.poll(() => messaggiDellaChat(app, 'prima domanda'), { timeout: 20_000 })
      .toEqual(['user: prima domanda', 'filo: Prima risposta.', 'user: seguito con la foto [1]']);
    // Come un messaggio mandato: riaperta la conversazione, la foto è nella sua bolla, non «non conservata».
    const id = await idDellaChat(app, 'prima domanda');
    const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
    const bolla = riaperta.locator('.dash-bubble-user', { hasText: 'seguito con la foto' });
    await expect(bolla.locator('img.dash-bubble-img')).toHaveAttribute('src', foto, { timeout: 10_000 });
    await expect(riaperta.locator('.dash-thread')).not.toContainText('non conservata');
  } finally {
    await ripristina(app);
  }
});

// Un seguito già partito non è più in attesa: né un ricaricamento né la scheda chiusa lo rimettono in giro.
test('un seguito partito a turno finito non torna nella casella al ricaricamento, e a scheda chiusa non si ripete', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await configureModel(app);
    await copione(app, [LENTO, { testo: 'Risposta al seguito.' }]);
    const page = await openTab('filo://newtab/');
    // Con la foto il turno non lo legge: parte dalla pagina quando il turno finisce.
    await seguitoMentreLavora(page, 'seguito che parte dopo', { foto: true });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al seguito.' })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page.locator('#input')).toHaveValue('');
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
      tm.closeTab(tm.activeId);
    });
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await new Promise((ok) => setTimeout(ok, 1_500));
    expect((await messaggiDellaChat(app, 'prima domanda')).filter((m) => m.includes('seguito che parte dopo'))).toHaveLength(1);
  } finally {
    await ripristina(app);
  }
});

test('un seguito letto dal turno in corso non torna nella casella al ricaricamento, e a scheda chiusa non si ripete', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await configureModel(app);
    await copione(app, [
      { pensa: ['Metto il timer. '], ogni: 200, dopoStrumenti: 2_000, strumenti: [{ id: 'b1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
      { testo: 'Timer messo, e ho letto anche il seguito.' },
    ]);
    const page = await openTab('filo://newtab/');
    await page.locator('#input').fill('metti un timer di due minuti');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
    await page.locator('#input').fill('e poi dimmi che ore sono');
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'ho letto anche il seguito' })).toBeVisible({ timeout: 15_000 });
    expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(2);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await expect(page.locator('#input')).toHaveValue('');
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
      tm.closeTab(tm.activeId);
    });
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await new Promise((ok) => setTimeout(ok, 1_500));
    expect((await messaggiDellaChat(app, 'metti un timer di due minuti')).filter((m) => m.includes('e poi dimmi che ore sono'))).toHaveLength(1);
  } finally {
    await ripristina(app);
  }
});

// #2173 — Un turno lento a partire (i cambi chiesti alla rete prima del modello) legge il seguito già alla prima
// chiamata: il comando secco di quella chiamata non chiude il turno, o il seguito resta senza risposta.
test('un seguito letto prima della prima chiamata riceve la sua risposta anche dopo un comando secco', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  try {
    await app.evaluate(() => {
      globalThis.__fetchPrimaDeiCambi = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (/frankfurter/.test(String(url))) {
          await new Promise((ok) => setTimeout(ok, 1_500));
          return new Response(JSON.stringify({ base: 'EUR', date: '2026-11-04', rates: { USD: 1.08 } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return globalThis.__fetchPrimaDeiCambi(url, init);
      };
    });
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await configureModel(app);
    await copione(app, [
      { strumenti: [{ id: 'b1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
      { testo: 'Timer messo, e sono le cinque.' },
    ]);
    const page = await openTab('filo://newtab/');
    await page.locator('#input').fill('metti un timer di due minuti');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
    await page.locator('#input').fill('e poi dimmi che ore sono');
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'sono le cinque' })).toBeVisible({ timeout: 15_000 });
    const chiamate = await app.evaluate(() => globalThis.__messaggi.map((m) => JSON.stringify(m)));
    expect(chiamate).toHaveLength(2);
    expect(chiamate[0]).toContain('e poi dimmi che ore sono');
    await expect(page.locator('#input')).toHaveValue('');
  } finally {
    await app.evaluate(() => { if (globalThis.__fetchPrimaDeiCambi) globalThis.fetch = globalThis.__fetchPrimaDeiCambi; });
    await ripristina(app);
  }
});
