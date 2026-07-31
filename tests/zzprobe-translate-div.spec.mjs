// PROBE (audit prober, temporaneo): "Traduci la pagina" su un sito moderno
// il cui testo vive in <div> invece che in <p>.
//
// Ipotesi: extractMainTextNodes() raccoglie SOLO p/li/h1-h6/blockquote/td/dd/dt/
// figcaption; su un sito che impagina il testo in <div> (React/SPA, molto
// comune) la lista è vuota e translatePage() esce in silenzio: nessuna
// traduzione, nessun avviso. L'utente vede solo il toast "Traduzione pagina in
// corso…" e poi più nulla.
//
// Assert di SUCCESSO atteso (che devono diventare verdi solo se la feature fa
// la cosa giusta): dopo il click sull'icona Traduci, o il testo è tradotto,
// oppure compare un messaggio che spiega perché no.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(60_000);

// Sito "moderno": tutto il testo in <div> (nessun <p>).
const DIV_HTML = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:30px">
  <div id="root">
    <div class="title">The quick brown fox</div>
    <div class="body">The quick brown fox jumps over the lazy dog every single morning without fail.</div>
    <div class="body">Another paragraph of english text that is long enough to be worth translating for a reader.</div>
  </div>
</body></html>`;

// Stesso contenuto ma in <p>: cammino "buono" di controllo.
const P_HTML = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:30px">
  <div id="root">
    <p class="title">The quick brown fox</p>
    <p class="body">The quick brown fox jumps over the lazy dog every single morning without fail.</p>
    <p class="body">Another paragraph of english text that is long enough to be worth translating for a reader.</p>
  </div>
</body></html>`;

// Stub del provider nel main: qualunque richiesta AI torna il testo di input
// con ogni blocco prefissato da "[IT] ", preservando il separatore.
async function stubProvider(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__aiCalls = [];
    globalThis.__origComplete = P.completeWithFallback;
    P.completeWithFallback = async ({ messages }) => {
      const content = messages[messages.length - 1].content;
      globalThis.__aiCalls.push(content);
      // Il prompt finisce con "Testo:\n\n<chunk>"
      const idx = content.lastIndexOf('Testo:\n\n');
      const chunk = idx >= 0 ? content.slice(idx + 8) : content;
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      const out = parts.map((p) => `[IT] ${p}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'test-model', usage: {} };
    };
    // Chiavi finte così buildAttemptChain non esplode con NO_API_KEY.
    globalThis.__origGetSettings = null;
  });
}

async function aiCalls(app) {
  return app.evaluate(() => (globalThis.__aiCalls || []).length);
}

async function clickTranslate(page) {
  await page.locator('#root').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const btn = menu.locator('.sn-menu-row-btn[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// Testo di tutti i toast comparsi (accumulati con un MutationObserver, perché
// spariscono dopo ~2s).
async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent);
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

test('controllo: pagina con <p> → la traduzione arriva davvero nel DOM', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, P_HTML);
  await watchToasts(page);
  await clickTranslate(page);

  await expect(page.locator('.body').first()).toContainText('[IT]', { timeout: 15_000 });
  const toasts = await page.evaluate(() => window.__toasts);
  console.log('[probe p] toasts:', JSON.stringify(toasts), 'aiCalls:', await aiCalls(app));
});

test('sito con testo in <div>: la traduzione non fa nulla e non dice nulla', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, DIV_HTML);
  await watchToasts(page);
  const before = await page.locator('#root').innerText();
  await clickTranslate(page);
  await page.waitForTimeout(4000);

  const after = await page.locator('#root').innerText();
  const toasts = await page.evaluate(() => window.__toasts);
  const calls = await aiCalls(app);
  console.log('[probe div] toasts:', JSON.stringify(toasts), 'aiCalls:', calls);
  console.log('[probe div] testo cambiato?', before !== after);
  await page.screenshot({ path: 'tests/.shots/probe-translate-div.png' });

  // Invariante ATTESA: o traduce, o spiega perché non può.
  const translated = after !== before;
  const explained = toasts.some((t) => !/in corso/i.test(t));
  expect(translated || explained,
    `né tradotto né spiegato — toasts=${JSON.stringify(toasts)}`).toBe(true);
});
