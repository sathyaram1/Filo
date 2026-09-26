// Verifica del lavoro «#725» dopo il riallineamento sopra main, quarto giro.
//
// I conflitti erano due, tutti e due su testo che l'utente legge: la voce del
// manifesto sulla spiegazione del testo selezionato (main ci aveva messo la
// conversione di valute, questo lavoro ne correggeva il modo di richiamarla) e
// l'elenco delle note di versione (righe nuove in cima da tutte e due le
// parti). Qui si controlla che nessuna delle due intenzioni sia caduta:
// il menu fa quello che il manifesto rimesso insieme promette, e le note di
// versione mostrano le righe di entrambi.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Il biglietto costa 3000 rupie</h1>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al tuo conto</a></p>
  <p><a id="pulito" href="https://esempio-tranquillo.test/articolo">Un articolo qualunque</a></p>
</body></html>`;

test('la spiegazione del link e del testo selezionato arriva da sola, e il link falso lo dice a parole', async ({ openTab, testServer }) => {
  // Metà «lavoro» del conflitto: il manifesto non deve più mandare a cercare
  // una voce di menu che non esiste, e l'avviso deve essere una frase.
  const page = await testServer.openReady(openTab, HTML);
  const menu = page.locator('.sn-menu');

  await page.locator('#falso').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="link"]')).toBeVisible();
  await expect(menu.getByText(/^Spieg/)).toHaveCount(0);

  const avviso = menu.locator('.sn-menu-link-warn');
  await expect(avviso).toBeVisible({ timeout: 3000 });
  const testo = ((await avviso.textContent()) || '').trim();
  expect(testo).toContain('paypal.com');
  expect(testo).toMatch(/imitazione/i);
  expect(testo).not.toMatch(/typosquatting|side_effect|token_in_url/);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // E un indirizzo tranquillo resta senza avviso.
  await page.locator('#pulito').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(menu.locator('.sn-menu-link-warn')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // Il testo selezionato: stessa promessa, stessa voce del manifesto.
  await page.locator('h1').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.locator('h1').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="text"]')).toBeVisible();
  await expect(menu.getByText(/^Spiegazione$/)).toHaveCount(0);
});

test('la spiegazione estesa converte la valuta straniera, come promette la stessa voce del manifesto', async ({ app, openTab }) => {
  // Metà «main» dello stesso conflitto: alla descrizione della spiegazione del
  // testo selezionato main aveva appena aggiunto la conversione in euro. Se il
  // riallineamento avesse tenuto solo il testo, la promessa resterebbe senza
  // la cosa promessa.
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__promptGiro4 = '';
    globalThis.__origGiro4 = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origGiro4,
      streamComplete: async ({ messages, onDelta }) => {
        globalThis.__promptGiro4 = (messages || []).map((m) => m.content).join('\n');
        const pezzi = ['3000 rupie indiane, ', 'circa [[calc: 3000/109.3]]', ' €', ' al cambio di oggi.'];
        for (const p of pezzi) { onDelta(p); await new Promise((r) => setTimeout(r, 30)); }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });

  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: '3000 rupie', sentence: 'Il biglietto costa 3000 rupie.' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.35) },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });

  const prompt = await app.evaluate(() => globalThis.__promptGiro4);
  expect(prompt, 'il cambio della valuta non arriva al modello').toMatch(/\d[\d.]*\s+INR\b/);

  // E il numero resta un prezzo, non dodici cifre dopo la virgola.
  const meta = ((await page.locator('.sn-popup .sn-popup-meta').textContent()) || '');
  expect(meta).toMatch(/2[7-8][.,]\d{1,2}\s*€/);

  await app.evaluate(() => { if (globalThis.__origGiro4) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origGiro4; });
});

test('il recap di aggiornamento ha le righe nuove di tutte e due le parti', async ({ app, openTab }) => {
  // Secondo conflitto: nelle note di versione main e questo lavoro avevano
  // scritto in cima allo stesso elenco. Chi aggiorna deve vederle entrambe.
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async () => {
    const KEY = globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION;
    await globalThis.SN_STORAGE.setRaw(KEY, '0.0.1');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const fixes = page.locator('.dash-recap-fixes .dash-recap-list li');
  await expect(page.locator('#recapOverlay')).toBeVisible();
  await expect(fixes.filter({ hasText: 'rupie' })).toHaveCount(1);
  await expect(fixes.filter({ hasText: 'imita l’indirizzo di un sito noto' })).toHaveCount(1);
  await expect(fixes.filter({ hasText: 'una voce di menu che non esiste' })).toHaveCount(1);
});
