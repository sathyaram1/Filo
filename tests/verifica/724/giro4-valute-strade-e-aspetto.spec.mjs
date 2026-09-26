// #724 — quarto giro. Le porte dei giri passati si riaprono da qui, più le
// strade che nessun giro aveva ancora percorso: la spiegazione del TASTO
// DESTRO (fin qui provata solo la spiegazione estesa) e come si legge il
// riquadro quando resta la sola conversione.

import { test, expect } from '../../fixtures/electron.mjs';

async function modelloFinto(app, testo) {
  await app.evaluate(async (_electron, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__g4prompt = '';
    globalThis.__g4orig = globalThis.__g4orig || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__g4orig,
      complete: async ({ messages }) => {
        globalThis.__g4prompt = (messages || []).map((m) => m.content).join('\n');
        return { text: t, toolCalls: [], reasoningDetails: [], usage: {} };
      },
      streamComplete: async ({ messages, onDelta }) => {
        globalThis.__g4prompt = (messages || []).map((m) => m.content).join('\n');
        onDelta(t);
        return { text: t, usage: {} };
      },
    };
  }, testo);
}

async function selezionaEApriMenu(page, sel = '#p') {
  await page.evaluate((s) => {
    const p = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(p);
    const g = window.getSelection(); g.removeAllRanges(); g.addRange(r);
  }, sel);
  await page.locator(sel).click({ button: 'right' });
}

const PAGINA = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <p id="p">Il biglietto costa 3000 rupie.</p></body></html>`;

// La spiegazione del tasto destro è la strada che l'utente della segnalazione
// percorre per prima: fin qui i cambi erano stati controllati solo nel prompt
// della spiegazione ESTESA.
test('il tasto destro manda al modello tutte le valute della BCE, non dieci', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, '3000 rupie = circa [[calc: 3000/92 | eur]] €');
  const page = await testServer.openReady(openTab, PAGINA);
  await selezionaEApriMenu(page);
  await expect(page.locator('.sn-menu')).toContainText('€', { timeout: 30_000 });

  const prompt = await app.evaluate(() => globalThis.__g4prompt);
  expect(prompt, 'nel prompt del tasto destro non c\'è il cambio delle rupie').toMatch(/\d[\d.]*\s+INR\b/);
  for (const sigla of ['BRL', 'PLN', 'KRW', 'ZAR', 'THB', 'MXN', 'TRY', 'HUF', 'CZK']) {
    expect(prompt, `manca ${sigla}`).toContain(` ${sigla}`);
  }
});

// La lamentela, rifatta coi passi di chi ha segnalato, sulla strada del tasto
// destro: quello che si legge nel menu è un prezzo.
test('«3000 rupie» col tasto destro: nel menu si legge un prezzo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'NESSUNA SPIEGAZIONE (3000 rupie = circa [[calc: 3000/92 | eur]] €)');
  const page = await testServer.openReady(openTab, PAGINA);
  await selezionaEApriMenu(page);
  await expect(page.locator('.sn-menu')).toContainText('32,61 €', { timeout: 30_000 });
  const testo = await page.locator('.sn-menu').innerText();
  expect(testo).not.toContain('32,6086956522');
  expect(testo).not.toContain('[[calc:');
  expect(testo).not.toContain('NESSUNA SPIEGAZIONE');
  // La rinuncia tolta non deve lasciare parentesi o punteggiatura orfana.
  expect(testo, `resta un orfano di formattazione: ${testo}`).not.toMatch(/\(\s*3000 rupie/);
});

// Importi grossi: due decimali E separatore delle migliaia, come chiedeva la
// segnalazione.
test('un importo grosso si legge con le migliaia separate', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, '3 milioni di rupie = circa [[calc: 3000000/92 | eur]] €');
  const page = await testServer.openReady(openTab, PAGINA);
  await selezionaEApriMenu(page);
  await expect(page.locator('.sn-menu')).toContainText('32.608,70 €', { timeout: 30_000 });
});

// Aspetto: il riquadro con la sola conversione, in tema scuro, si legge.
test('la conversione nel menu si legge anche in tema scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' });
  });
  await modelloFinto(app, 'NESSUNA SPIEGAZIONE (3000 rupie = circa [[calc: 3000/92 | eur]] €)');
  const page = await testServer.openReady(openTab, PAGINA);
  await selezionaEApriMenu(page);
  await expect(page.locator('.sn-menu')).toContainText('32,61 €', { timeout: 30_000 });
  await page.screenshot({ path: 'tests/.shots/724-giro4-menu-scuro.png' });
  const dentro = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    const r = m.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  });
  expect(dentro, 'il menu con la conversione esce dallo schermo').toBe(true);
});

// Quando la fonte dei cambi non risponde, a Filo restano dei cambi INVENTATI
// (adesso comprese le rupie della segnalazione) e li consegna al modello come
// «Cambi attuali», con una data di nove mesi prima. Chi legge non ha modo di
// sapere che il numero in euro non è il cambio di oggi.
test('fonte dei cambi giù: Filo chiama «attuali» dei cambi inventati e nessuno lo dice a chi legge', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    // Fonte irraggiungibile e nessun cambio in memoria: il caso di chi apre
    // Filo senza rete, o di una rete che blocca la fonte.
    try { await chrome.storage.local.remove('sn_fx_rates'); } catch (_) {}
    globalThis.__g4fetch = globalThis.fetch;
    globalThis.fetch = async (...a) => {
      if (String(a[0] || '').includes('frankfurter')) throw new Error('rete giù');
      return globalThis.__g4fetch(...a);
    };
  });
  await modelloFinto(app, '3000 rupie = circa [[calc: 3000/92 | eur]] €');
  const page = await testServer.openReady(openTab, PAGINA);
  await selezionaEApriMenu(page);
  await expect(page.locator('.sn-menu')).toContainText('€', { timeout: 30_000 });

  const prompt = await app.evaluate(() => globalThis.__g4prompt);
  const m = prompt.match(/Cambi attuali al (\d{4}-\d{2}-\d{2})/);
  expect(m, 'la riga dei cambi non c\'è').not.toBeNull();
  const giorni = Math.round((Date.now() - Date.parse(m[1])) / 86400000);
  // SUCCESSO ATTESO: o i cambi sono di oggi, o chi legge viene avvertito.
  const avvisa = /dillo a chi legge|scrivilo|cambio stimato|indicativo/i.test(prompt);
  expect(giorni <= 3 || avvisa,
    `Filo consegna come «Cambi attuali» dei tassi fermi a ${giorni} giorni fa senza chiedere di avvisare chi legge`).toBe(true);

  await app.evaluate(() => { if (globalThis.__g4fetch) globalThis.fetch = globalThis.__g4fetch; });
});
