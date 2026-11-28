// Fonti verificate nelle risposte (#2383): dopo una lettura vera la frase porta il nome del sito, anche presa oltre il
// pezzo che il modello ha letto; passaggio, clic sulla frase, tasto destro. Un indirizzo non letto nel turno e il
// markdown che imita l'etichetta non ne producono. Logica pura: tests/unit/fontiCitate.test.mjs.

import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const NEWTAB = 'filo://newtab/';
const FRASE = 'Il ponte di Calatrava fu inaugurato il 16 giugno 2015 dopo sei anni di lavori.';
const PAGINA = `<!doctype html><html lang="it"><head><title>Storia del ponte</title></head><body><main><article>
<h1>Storia del ponte</h1>
${'<p>Una lunga premessa sul quartiere, sulle sue strade e sulle piazze che lo attraversano da secoli.</p>\n'.repeat(400)}
<p>${FRASE}</p>
<p>Oggi lo attraversano ogni giorno migliaia di persone.</p>
</article></main></body></html>`;

// Il modello finto: legge la pagina dei risultati, poi risponde col testo dato, dove $URL è l'indirizzo letto.
async function stubModello(app, finale) {
  await app.evaluate(async (_e, finale) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const esiti = messages.filter((m) => m.role !== 'system').map((m) => String(m.content || '')).join('\n');
      const url = (/http:\/\/sito-pubblico\.test:\d+\/\d+/.exec(esiti) || [''])[0];
      if (n === 0) {
        const c = { id: 'c0', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'quando è stato inaugurato il ponte' }) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      if (n === 1) {
        const c = { id: 'c1', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url }) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      globalThis.__vistoDalModello = esiti;
      const text = finale.split('$URL').join(url);
      // In diretta arriva a pezzi, marcatori compresi: a schermo non devono mai vedersi.
      for (let i = 0; i < text.length; i += 7) { try { onDelta && onDelta(text.slice(i, i + 7)); } catch (_) {} }
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, finale);
}

async function preparaRete(app, risultati) {
  await app.evaluate(({ net }, results) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results });
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    // Lo scaricatore vero rifiuta il server di prova, che risponde dalla rete di casa: qui passa, col suo nome.
    globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, opts) => net.fetch(u, opts);
  }, risultati);
}

test('la frase presa da una pagina letta porta il nome del sito: passaggio, clic sulla frase, tasto destro, finti e imitazioni no', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html(PAGINA, { pubblico: true });
  await preparaRete(app, [{ title: 'Storia del ponte', url, snippet: 'La storia del ponte nuovo.' }]);
  await stubModello(app, [
    'Il ponte è stato inaugurato nel giugno 2015. [[fonte: $URL | il ponte di Calatrava fu inaugurato il 16 giugno 2015]]',
    'Ci passano in tanti ogni giorno. [[fonte: $URL | ogni giorno lo attraversano centinaia di persone]]',
    'Costa 3 euro attraversarlo. [[fonte: https://inventato.example/prezzi | costa 3 euro]]',
    'Imitazione: <span class="filo-fonte">wikipedia</span>',
  ].join('\n\n'));
  const page = await openTab(NEWTAB);
  await page.locator('#input').fill('quando è stato inaugurato il ponte?');
  await page.locator('#sendBtn').click();

  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Il ponte è stato inaugurato nel giugno 2015.' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla).not.toContainText('[[fonte');
  await expect(bolla).toContainText('Costa 3 euro attraversarlo.');
  await expect(bolla).toContainText('<span class="filo-fonte">wikipedia</span>');

  // Due etichette sole: la verificata e quella col punto di domanda; l'indirizzo inventato e l'imitazione niente.
  const etichette = bolla.locator('.filo-fonte');
  await expect(etichette).toHaveCount(2);
  const buona = etichette.nth(0);
  await expect(buona).toHaveText('sito-pubblico.test');
  await expect(etichette.nth(1)).toHaveText('sito-pubblico.test?');
  await expect(etichette.nth(1)).toHaveAttribute('data-tip', /Filo non ha trovato questa frase nella pagina/);
  // La frase sta oltre il pezzo che il modello ha letto: verificata lo stesso, sulla pagina intera.
  expect(await app.evaluate(() => globalThis.__vistoDalModello)).not.toContain('Calatrava');
  await expect(bolla.locator('.filo-fonte', { hasText: 'inventato' })).toHaveCount(0);

  // Il fumetto porta la frase com'è nella pagina, il titolo e quando l'ha letta.
  const tip = await buona.getAttribute('data-tip');
  expect(tip).toContain('«Il ponte di Calatrava fu inaugurato il 16 giugno 2015»');
  expect(tip).toContain('Storia del ponte');
  expect(tip).toMatch(/Letta da Filo il \d+ \S+ alle \d\d:\d\d/);

  // Il colore è quello delle righe di servizio della home, non dei link, e senza sottolineatura.
  const stile = await buona.evaluate((el) => {
    const s = getComputedStyle(el);
    const prova = document.createElement('div');
    prova.className = 'dash-pagine-testa';
    document.body.appendChild(prova);
    const servizio = getComputedStyle(prova).color;
    const link = document.createElement('a');
    link.className = 'filo-md-link';
    el.closest('.dash-bubble-md').appendChild(link);
    const colLink = getComputedStyle(link).color;
    prova.remove(); link.remove();
    return { colore: s.color, servizio, link: colLink, linea: s.textDecorationLine };
  });
  expect(stile.colore).toBe(stile.servizio);
  expect(stile.colore).not.toBe(stile.link);
  expect(stile.linea).toBe('none');

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema, { timeout: 10_000 });
    await buona.hover();
    await page.screenshot({ path: `tests/.shots/2383-fonte-${tema === 'dark' ? 'scuro' : 'chiaro'}.png` }).catch(() => {});
  }

  // Tasto destro: copia la citazione, copia l'indirizzo, apri.
  await buona.click({ button: 'right' });
  // A icone (#2555): un'icona, o una variante nel menu dell'icona dello stesso verbo.
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 10_000 });
  for (const voce of ['Copia la citazione', 'Copia l’indirizzo', 'Apri la pagina sulla frase']) expect(await menu.haVoce(voce), voce).toBe(true);
  await page.keyboard.press('Escape');
  await buona.click({ button: 'right' });
  await menu.scegli('Copia la citazione');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8_000 })
    .toBe('Il ponte di Calatrava fu inaugurato il 16 giugno 2015');

  // Il clic apre la pagina in una scheda scesa fino alla frase.
  await buona.click();
  const scheda = await aspettaFinestra(app, (w) => w.url().includes(':~:text='), 'il clic sull\'etichetta non ha aperto la pagina sulla frase');
  expect(scheda.url()).toContain(url.replace('http://', ''));
  await expect.poll(() => scheda.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(500);
  const visibile = await scheda.evaluate((frase) => {
    const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes(frase));
    const r = p.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  }, FRASE);
  expect(visibile).toBe(true);
});

test('riaperta, la conversazione ridisegna le etichette dall\'archivio, e il testo salvato non porta marcatori né pagine', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html(PAGINA, { pubblico: true });
  await preparaRete(app, [{ title: 'Storia del ponte', url, snippet: 'La storia del ponte nuovo.' }]);
  await stubModello(app, 'Inaugurato nel 2015. [[fonte: $URL | fu inaugurato il 16 giugno 2015 dopo sei anni di lavori]]');
  const page = await openTab(NEWTAB);
  await page.locator('#input').fill('quando hanno aperto il ponte?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo .filo-fonte')).toHaveText('sito-pubblico.test', { timeout: 30_000 });

  let salvata = null;
  await expect.poll(async () => {
    salvata = await app.evaluate(async () => {
      const msgs = (await globalThis.SN_FILO_CHATS.list()).flatMap((c) => (c && Array.isArray(c.messages) ? c.messages : []));
      return msgs.filter((m) => m.role === 'filo').pop() || null;
    });
    return salvata && salvata.text;
  }, { timeout: 10_000 }).toBe('Inaugurato nel 2015.');
  expect(salvata.fonti).toHaveLength(1);
  expect(salvata.fonti[0]).toMatchObject({ esito: 'verificata', sito: 'sito-pubblico.test', titolo: 'Storia del ponte' });
  expect(JSON.stringify(salvata.fonti)).not.toContain('premessa sul quartiere');

  // Riaperta, la fonte giudicata col turno si apre ancora sulla frase senza chiedere l'OK (dopo un riavvio: unit).
  await page.reload();
  const riaperta = page.locator('.dash-bubble-filo .filo-fonte').first();
  await expect(riaperta).toHaveText('sito-pubblico.test', { timeout: 20_000 });
  await riaperta.click();
  await aspettaFinestra(app, (w) => w.url().includes(':~:text=fu%20inaugurato'), 'riaperta, l\'etichetta non ha aperto la pagina sulla frase');
});
