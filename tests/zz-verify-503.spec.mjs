// SONDA TEMPORANEA della verifica di #503 — da cancellare a fine verifica.
//
// Sintomo dell'utente: su una pagina tradotta PER INTERO compare comunque
// l'avviso "Pagina tradotta solo in parte: alcuni componenti di questo sito
// sono chiusi…", e chi legge va a cercare un rettangolo in lingua originale
// che sullo schermo non c'è. Succede quando la pagina ospita un componente
// chiuso ma INVISIBILE: fuori schermo, trasparente, o nascosto lasciandogli
// l'ingombro. È la forma normale di spazi pubblicitari, banner cookie e
// riquadri di statistica.
//
// Contro-prova richiesta dal feedback: un componente chiuso che sta solo PIÙ
// IN BASSO della prima schermata è contenuto vero e deve continuare a
// contare.

import { test, expect } from './fixtures/electron.mjs';

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent || '');
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);

async function clickTranslateIcon(page, anchor = 'body') {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// Articolo normale + un componente chiuso nascosto nel modo indicato dallo
// stile passato. Lo shadow root è in modalità "closed": nessuno script lo
// legge, esattamente come gli spazi pubblicitari veri.
const PAGE = (adStyle) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <p id="p2">Second paragraph of the article, also long enough to be translated.</p>
  <ad-slot id="ad" style="${adStyle}"></ad-slot>
  <script>
    const host = document.getElementById('ad');
    const sr = host.attachShadow({ mode: 'closed' });
    sr.innerHTML = '<div style="width:300px;height:250px;background:#eee">Advertisement</div>';
  <\/script>
</body></html>`;

// I quattro modi di nascondere lo spazio pubblicitario.
const HIDDEN_WAYS = [
  ['tolto dal flusso (display:none)', 'display:none;width:300px;height:250px'],
  ['fuori schermo (left:-9999px)', 'position:absolute;left:-9999px;top:0;width:300px;height:250px;display:block'],
  ['trasparente (opacity:0)', 'opacity:0;width:300px;height:250px;display:block'],
  ['nascosto con ingombro (visibility:hidden)', 'visibility:hidden;width:300px;height:250px;display:block'],
];

for (const [nome, style] of HIDDEN_WAYS) {
  test(`pagina tradotta per intero + spazio pubblicitario ${nome}: nessun avviso "solo in parte"`,
    async ({ app, openTab, testServer }) => {
      await stubTranslationProvider(app);
      const page = await testServer.openReady(openTab, PAGE(style));
      await watchToasts(page);
      await clickTranslateIcon(page, '#p1');

      // Tutto ciò che si vede è tradotto.
      await expect(page.locator('#title')).toHaveText(/^IT /);
      await expect(page.locator('#p1')).toHaveText(/^IT /);
      await expect(page.locator('#p2')).toHaveText(/^IT /);

      await expect.poll(async () => (await toasts(page)).length).toBeGreaterThan(1);
      const t = await toasts(page);
      // L'utente ha davanti una pagina tutta tradotta: l'avviso deve dirlo.
      expect(t.join(' | ')).not.toContain('solo in parte');
      expect(t).toContain('Pagina tradotta');
    });
}

// CONTRO-PROVA: sotto la prima schermata NON vuol dire invisibile.
test('spazio chiuso sotto la prima schermata: l’avviso "solo in parte" deve restare',
  async ({ app, openTab, testServer }) => {
    await stubTranslationProvider(app);
    const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
      <h1 id="title">The end of an era in European football</h1>
      <p id="p1">First paragraph of the body text, long enough to be picked up by the extractor.</p>
      <div style="height:3000px"></div>
      <news-card id="ad" style="display:block;width:600px;height:250px"></news-card>
      <script>
        const host = document.getElementById('ad');
        const sr = host.attachShadow({ mode: 'closed' });
        sr.innerHTML = '<h2>A real English headline nobody can read</h2>';
      <\/script>
    </body></html>`);
    await watchToasts(page);
    await clickTranslateIcon(page, '#p1');

    await expect(page.locator('#p1')).toHaveText(/^IT /);
    await expect.poll(async () => (await toasts(page)).length).toBeGreaterThan(1);
    expect((await toasts(page)).join(' | ')).toContain('solo in parte');
  });

// SECONDO EFFETTO: dentro una sezione ripiegata il testo normale viene
// rimandato, il componente chiuso no.
test('sezione ripiegata: il componente chiuso non deve pesare più del testo normale',
  async ({ app, openTab, testServer }) => {
    await stubTranslationProvider(app);
    const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
      <h1 id="title">The end of an era in European football</h1>
      <p id="p1">First paragraph of the body text, long enough to be picked up by the extractor.</p>
      <details id="fold">
        <summary id="sum">More about this</summary>
        <p id="inside">Text hidden inside the collapsed section, which Filo rightly defers.</p>
        <stat-box id="ad" style="display:block;width:300px;height:250px"></stat-box>
      </details>
      <script>
        const host = document.getElementById('ad');
        const sr = host.attachShadow({ mode: 'closed' });
        sr.innerHTML = '<div>hidden stats</div>';
      <\/script>
    </body></html>`);
    await watchToasts(page);
    await clickTranslateIcon(page, '#p1');

    await expect(page.locator('#p1')).toHaveText(/^IT /);
    // Il testo dentro la sezione ripiegata resta in inglese (giusto: si tradurrà
    // quando l'utente la apre).
    await expect(page.locator('#inside')).not.toHaveText(/^IT /);
    await expect.poll(async () => (await toasts(page)).length).toBeGreaterThan(1);
    // …e allora nemmeno il riquadro chiuso della stessa sezione deve contare.
    expect((await toasts(page)).join(' | ')).not.toContain('solo in parte');
  });
