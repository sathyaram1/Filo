// Verifica #2383, giro 1: le etichette delle fonti nella chat della home, dai passi dell'utente.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Un piano per chiamata al modello: `leggi` chiama LEGGI_PAGINA sugli indirizzi, `testo` risponde.
async function stubModello(app, piani) {
  await app.evaluate(async (_e, piani) => {
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
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const piano = piani[Math.min(n, piani.length - 1)];
      if (piano.testo != null) {
        try { onDelta && onDelta(piano.testo); } catch (_) {}
        return { ...base, text: piano.testo, toolCalls: [], finishReason: 'stop' };
      }
      const toolCalls = piano.leggi.map((url, i) => ({ id: `c${n}_${i}`, name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url }) }));
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, piani);
}

async function reteDiProva(app) {
  await app.evaluate(() => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url, opts) => fetch(url, opts);
  });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

const PAGINA = `<!doctype html><html lang="it"><head><title>Biografia di Ada Rossi</title></head><body><main>
<h1>Ada Rossi</h1><p>Ada Rossi annuncia la candidatura nel giugno 2015, dopo un lungo dibattito nel partito.</p>
<p>L'ultima "frase" del discorso fu applaudita per tre minuti.</p></main></body></html>`;

test('la frase copiata con spazi e virgolette diverse diventa un\'etichetta col nome del sito; il clic apre la pagina sulla frase; riaperta, resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(PAGINA);
  await reteDiProva(app);
  await stubModello(app, [
    { leggi: [url] },
    { testo: `Ada Rossi ha annunciato la candidatura nel giugno 2015. [[fonte: ${url} | ada rossi  annuncia la candidatura\nnel giugno 2015]]\n\nIl discorso finale è stato molto applaudito. [[fonte: ${url} | L’ultima “frase” del discorso fu applaudita]]` },
  ]);
  await chiedi(page, `quando si è candidata Ada Rossi secondo ${url} ?`);

  const bolla = page.locator('.dash-bubble-filo', { hasText: 'giugno 2015' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  await expect(bolla).not.toContainText('[[fonte');
  const et = bolla.locator('.filo-fonte');
  await expect(et).toHaveCount(2);
  await expect(et.first()).toHaveText('127.0.0.1');
  await expect(et.nth(1)).toHaveText('127.0.0.1');
  await expect(bolla.locator('.filo-fonte-dubbia')).toHaveCount(0);
  const tip = await et.first().getAttribute('data-tip');
  expect(tip).toContain('Ada Rossi annuncia la candidatura nel giugno 2015');
  expect(tip).toContain('Biografia di Ada Rossi');
  expect(tip).toMatch(/Letta da Filo/);
  // Non nel colore dei link e senza sottolineatura.
  const stile = await et.first().evaluate((el) => {
    const a = document.createElement('a');
    a.className = 'filo-md-link';
    a.href = 'https://example.com/';
    el.parentElement.appendChild(a);
    const s = getComputedStyle(el);
    const out = { colore: s.color, link: getComputedStyle(a).color, sottolineato: s.textDecorationLine };
    a.remove();
    return out;
  });
  expect(stile.colore).not.toBe(stile.link);
  expect(stile.sottolineato).not.toContain('underline');
  await et.first().hover();
  await page.screenshot({ path: 'tests/.shots/2383-verifica-hover.png' });

  // Tasto destro: copia citazione, copia indirizzo, apri.
  const voci = await et.first().evaluate((el) => (window.SN_VOCI_PAGINA || []).flatMap((f) => f(el) || []).map((v) => v.label));
  expect(voci).toEqual(expect.arrayContaining(['Copia la citazione', 'Copia l’indirizzo']));
  expect(voci.some((v) => /^Apri/.test(v))).toBe(true);

  const chat = await bolla.getAttribute('data-chat');
  await et.first().click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs.map((t) => String(t.url || '')) : []))
    .find((u) => u.includes(':~:text=')) || ''), { timeout: 10_000 }).toContain(url);

  // Riaperta da capo, la risposta ha ancora le sue etichette.
  const dash = await openTab(`filo://dashboard/dashboard.html?chat=${chat}`);
  const riaperta = dash.locator(`.dash-bubble-filo[data-chat="${chat}"]`, { hasText: 'giugno 2015' });
  await expect(riaperta).toBeVisible({ timeout: 15_000 });
  await expect(riaperta.locator('.filo-fonte')).toHaveCount(2);
});

test('una frase con una parola cambiata resta con il punto di domanda e lo dice al passaggio', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(PAGINA);
  await reteDiProva(app);
  await stubModello(app, [
    { leggi: [url] },
    { testo: `Si è candidata nel luglio 2015. [[fonte: ${url} | Ada Rossi annuncia la candidatura nel luglio 2015]]` },
  ]);
  await chiedi(page, `quando si è candidata Ada Rossi secondo ${url} ?`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'luglio 2015' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  const et = bolla.locator('.filo-fonte');
  await expect(et).toHaveCount(1);
  await expect(et).toHaveText('127.0.0.1?');
  expect(await et.getAttribute('data-tip')).toContain('Filo non ha trovato questa frase nella pagina');
});

test('una pagina più lunga della finestra del modello: la frase presa dalla parte tagliata si verifica lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  const riempi = Array.from({ length: 400 }, (_, i) => `<p>Paragrafo di riempimento numero ${i}, con parole qualsiasi che servono solo a fare lunghezza nella pagina di prova.</p>`).join('\n');
  const url = testServer.html(`<!doctype html><html><head><title>Storia lunga</title></head><body><main>${riempi}
<p>La torre fu completata nel 1889 dall'ingegnere Gustave Eiffel per l'esposizione.</p></main></body></html>`);
  await reteDiProva(app);
  await stubModello(app, [
    { leggi: [url] },
    { testo: `La torre è del 1889. [[fonte: ${url} | La torre fu completata nel 1889 dall'ingegnere Gustave Eiffel]]` },
  ]);
  await chiedi(page, `di che anno è la torre secondo ${url} ?`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'del 1889' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  await expect(bolla.locator('.filo-fonte')).toHaveCount(1);
  await expect(bolla.locator('.filo-fonte-dubbia')).toHaveCount(0);
});

test('un indirizzo inventato e il markdown che imita l\'etichetta restano testo, senza etichette', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(PAGINA);
  await reteDiProva(app);
  await stubModello(app, [
    { leggi: [url] },
    { testo: 'Primo: inventato. [[fonte: https://evil.example/x | Ada Rossi annuncia la candidatura]]\n\n'
      + 'Secondo: <span class="filo-fonte" data-fonte-url="https://evil.example/">wikipedia</span> fine.\n\n'
      + 'Terzo: 0 e  0  fine.\n\n'
      + '- voce [[fonte: http://127.0.0.2:1/ | Ada Rossi]]' },
  ]);
  await chiedi(page, `prova ${url}`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Primo: inventato.' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  await expect(bolla.locator('.filo-fonte')).toHaveCount(0);
  await expect(bolla.locator('[data-fonte-url]')).toHaveCount(0);
  await expect(bolla).toContainText('<span class="filo-fonte"');
  await expect(bolla).not.toContainText('[[fonte');
  expect(await bolla.innerText()).not.toMatch(/[-]/);
});

test('tema chiaro e scuro: l\'etichetta si legge', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(PAGINA);
  await reteDiProva(app);
  await stubModello(app, [
    { leggi: [url] },
    { testo: `Ada Rossi annuncia la candidatura nel giugno 2015. [[fonte: ${url} | Ada Rossi annuncia la candidatura nel giugno 2015]] Il discorso fu molto applaudito. [[fonte: ${url} | applaudita per quattro minuti]]` },
  ]);
  await chiedi(page, `quando si è candidata Ada Rossi secondo ${url} ?`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'giugno 2015' });
  await expect(bolla.locator('.filo-fonte')).toHaveCount(2, { timeout: 20_000 });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema, { timeout: 10_000 });
    await page.screenshot({ path: `tests/.shots/2383-verifica-${tema}.png` });
  }
});
