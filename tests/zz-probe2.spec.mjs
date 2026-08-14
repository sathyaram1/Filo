// SONDA 2 di verifica #439 — il rischio DICHIARATO: il falso "solo in parte".
// Da cancellare a fine giro.
//
// Il riconoscimento di un componente chiuso è per forza un'euristica: da fuori
// un componente sigillato e un'icona decorativa si somigliano. Se l'euristica è
// troppo larga, pagine tradotte per intero si sentono dire "solo in parte" —
// che è di nuovo una bugia, solo nell'altro verso.

import { test, expect } from './fixtures/electron.mjs';

// Icone di design system costruite come componenti CHIUSI (pratica comunissima):
// piccole, senza una parola di testo.
const CLOSED_ICONS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">An article on a site whose icons are sealed components</h1>
  <ds-icon></ds-icon><ds-icon></ds-icon><ds-icon></ds-icon><ds-icon></ds-icon>
  <p id="p1">The first paragraph of the article, perfectly readable by any script on the page.</p>
  <ds-icon></ds-icon><ds-icon></ds-icon>
  <p id="p2">The second paragraph of the article, also perfectly readable from the outside.</p>
</body></html>
<script>
  class DsIcon extends HTMLElement {
    connectedCallback() {
      const r = this.attachShadow({ mode: 'closed' });
      r.innerHTML = '<svg width="24" height="24"><circle cx="12" cy="12" r="10"></circle></svg>';
    }
  }
  customElements.define('ds-icon', DsIcon);
</script>`;

// Contenitore di impaginazione costruito come componente CHIUSO ma VUOTO di
// testo: grande sullo schermo, e però non nasconde una parola.
const CLOSED_LAYOUT = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">An article wrapped in a sealed layout shell</h1>
  <ds-shell></ds-shell>
  <p id="p1">The only real paragraph of this page, sitting outside the sealed shell entirely.</p>
</body></html>
<script>
  class DsShell extends HTMLElement {
    connectedCallback() {
      const r = this.attachShadow({ mode: 'closed' });
      r.innerHTML = '<div style="width:600px;height:240px;background:#f2f2f2"></div>';
    }
  }
  customElements.define('ds-shell', DsShell);
</script>`;

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
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP),
        provider: 'test', model: 'test-translate', usage: {},
      };
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

test('#439 icone costruite come componenti chiusi non fanno scattare "solo in parte"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, CLOSED_ICONS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(page.locator('#p2')).toHaveText(/^IT /);

  const t = await toasts(page);
  expect(t).toContain('Pagina tradotta');
  expect(t.join(' | ')).not.toContain('solo in parte');
});

test('#439 un guscio di impaginazione chiuso ma senza testo non fa scattare "solo in parte"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, CLOSED_LAYOUT);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#p1')).toHaveText(/^IT /);

  const t = await toasts(page);
  expect(t).toContain('Pagina tradotta');
  expect(t.join(' | ')).not.toContain('solo in parte');
});

test('#439 la traduzione non tocca il menu di Filo dentro la pagina', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, CLOSED_ICONS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /);

  // Il menu di Filo è costruito dentro la pagina: se finisse nel giro della
  // traduzione, le sue voci si ritroverebbero "tradotte" (qui: con "IT ").
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  // A traduzione finita la stessa icona propone il ritorno all'originale: se il
  // menu fosse finito nel giro della traduzione, sarebbe "IT Mostra originale".
  await expect(page.locator('[data-sn-icon-id="translate"]')).toHaveAttribute('aria-label', 'Mostra originale');
  expect(await menu.textContent()).not.toContain('IT ');
  await page.screenshot({ path: 'tests/.shots/probe-439-menu.png' }).catch(() => {});
});
