// #418 — "Le risposte di Filo perdono la formattazione e i link": nella chat
// della home il testo del modello veniva mostrato grezzo (asterischi, parentesi
// quadre) e i link non erano cliccabili.
//
// Fix: a fine turno la risposta viene renderizzata con la formattazione leggera
// condivisa (grassetto/corsivo/codice/elenchi + LINK). I link sono contenuto NON
// FIDATO: solo http/https/mailto diventano cliccabili e aprono in nuova scheda;
// un link verso una pagina interna (filo://) resta testo, non un <a>.
//
// SUCCESSO asserito:
//  (A) il grassetto diventa <strong> e un link markdown diventa un <a> cliccabile
//      con href e target giusti;
//  (B) cliccando quel link si APRE davvero una nuova scheda su quell'indirizzo;
//  (C) un link filo:// interno NON diventa cliccabile (nessun <a>), ma il testo
//      resta visibile.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

test('la risposta di Filo mostra grassetto e link cliccabili; il link interno resta testo', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Pagina locale reale a cui punterà il link (niente rete esterna).
  const linkUrl = testServer.html('<!doctype html><title>Meta</title><h1>meta</h1>');
  const linkHost = new URL(linkUrl).host;
  // Grassetto + un link markdown esterno + un link interno filo:// (da scartare).
  const responseText = `Ecco un punto **importante**. Vedi [la fonte](${linkUrl}) e le [impostazioni](filo://preferences/preferences.html).`;

  await app.evaluate(async (_e, responseText) => {
    globalThis.__mockText = responseText;
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreMd = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const full = JSON.stringify({ text: globalThis.__mockText, actions: [] });
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, responseText);

  await page.locator('#input').fill('spiegami');
  await page.locator('#sendBtn').click();

  // (A) bolla renderizzata: grassetto in <strong>, link esterno in <a.filo-md-link>.
  const bubble = page.locator('.dash-bubble-filo.dash-bubble-md').last();
  await expect(bubble).toBeVisible({ timeout: 8_000 });
  await expect(bubble.locator('strong', { hasText: 'importante' })).toBeVisible();
  const link = bubble.locator(`a.filo-md-link[href="${linkUrl}"]`);
  await expect(link).toBeVisible();
  await expect(link).toHaveText('la fonte');
  await expect(link).toHaveAttribute('target', '_blank');

  // (C) il link interno filo:// NON è un <a> (contenuto non fidato), ma il testo
  // "impostazioni" resta visibile.
  await expect(bubble.locator('a[href^="filo://"]')).toHaveCount(0);
  await expect(bubble).toContainText('impostazioni');

  // (B) cliccando il link si apre una NUOVA scheda su quell'indirizzo.
  const before = shell.locator('.tab');
  const beforeCount = await before.count();
  await link.click();
  await expect(shell.locator('.tab')).toHaveCount(beforeCount + 1, { timeout: 8_000 });
  await expect.poll(async () => {
    return app.windows().some((w) => { try { return new URL(w.url()).host === linkHost; } catch (_) { return false; } });
  }, { timeout: 8_000, intervals: [100] }).toBe(true);

  try { await page.screenshot({ path: 'tests/.shots/dashboard-chat-markdown.png' }); } catch (_) {}
  await app.evaluate(() => { try { globalThis.__restoreMd?.(); } catch (_) {} });
});

// #853.2 — il testo di un link fatto di codice usciva «0», il grassetto dentro un link restava con gli asterischi, un
// URL attaccato a del codice si portava dietro un segnaposto, e una lunga fila di [ bloccava la pagina per secondi.
test('i link della risposta tengono codice e grassetto, e una fila di quadre aperte non blocca la chat', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  const LINK = [
    'Vedi [`Array.prototype.map()`](https://developer.mozilla.org/it/docs/Web/JavaScript/Reference/Global_Objects/Array/map).',
    '',
    'Fonte: [**Wikipedia**](https://it.wikipedia.org/wiki/Roma)',
    '',
    'Pagina: https://example.com/guida`index.html` fine.',
  ].join('\n');
  // Col disegno di prima questa fila costava decine di secondi; adesso pochi millisecondi.
  const QUADRE = `Vedi ${'['.repeat(200_000)} fine della spiegazione`;
  await app.evaluate(async (_e, { LINK, QUADRE }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreMd = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const utente = [...(messages || [])].reverse().find((m) => m && m.role === 'user');
      const testo = JSON.stringify(utente ? utente.content : '').includes('quadre') ? QUADRE : LINK;
      const full = JSON.stringify({ text: testo, actions: [] });
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, { LINK, QUADRE });

  await page.locator('#input').fill('dammi i link');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo.dash-bubble-md').last();
  await expect(bolla.locator('a.filo-md-link').first()).toBeVisible({ timeout: 8_000 });
  const mdn = bolla.locator('a.filo-md-link[href*="developer.mozilla.org"]');
  await expect(mdn).toHaveText('Array.prototype.map()');
  await expect(mdn.locator('code')).toHaveText('Array.prototype.map()');
  const wiki = bolla.locator('a.filo-md-link[href="https://it.wikipedia.org/wiki/Roma"]');
  await expect(wiki).toHaveText('Wikipedia');
  await expect(wiki.locator('strong')).toHaveText('Wikipedia');
  await expect(bolla.locator('a.filo-md-link[href="https://example.com/guida"]')).toHaveText('https://example.com/guida');
  await expect(bolla.locator('code', { hasText: 'index.html' })).toBeVisible();
  const segnaposti = await bolla.evaluate((el) => {
    const re = /[]/;
    return re.test(el.textContent) || [...el.querySelectorAll('a')].some((a) => re.test(a.getAttribute('href') || ''));
  });
  expect(segnaposti, 'segnaposti interni finiti nel testo o negli indirizzi').toBe(false);
  try { await bolla.screenshot({ path: 'tests/.shots/dashboard-chat-link-codice.png' }); } catch (_) {}

  await page.locator('#input').fill('una fila di quadre');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo.dash-bubble-md').last()).toContainText('fine della spiegazione', { timeout: 10_000 });
  // La pagina risponde ancora: il campo prende quello che si scrive.
  await page.locator('#input').fill('ancora qui');
  await expect(page.locator('#input')).toHaveValue('ancora qui');
  await app.evaluate(() => { try { globalThis.__restoreMd?.(); } catch (_) {} });
});
