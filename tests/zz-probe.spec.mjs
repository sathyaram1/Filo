// SONDA DI VERIFICA #439 — scritta dal verifier, da cancellare a fine giro.
//
// Sintomo dell'utente: "Traduci la pagina" non entra nei componenti isolati
// (web component / shadow DOM): quel testo resta in lingua originale, e alla
// fine l'avviso dice comunque "Pagina tradotta" invece di "solo in parte".
//
// Qui si verifica il COMPORTAMENTO che l'utente vede, black-box.

import { test, expect } from './fixtures/electron.mjs';

// ── Pagine di prova ─────────────────────────────────────────────────────────

// 1) Componente APERTO: il caso normalissimo dei siti moderni.
const OPEN = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="p1">A normal paragraph living in the light DOM of the document.</p>
  <my-card id="card"></my-card>
  <script>
    class MyCard extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<h2 id="stitle">A headline locked inside a component</h2>' +
          '<div id="sbody">Body copy that lives inside the component and used to stay in English forever.</div>';
      }
    }
    customElements.define('my-card', MyCard);
  </script>
</body></html>`;

// 2) Componente APERTO dentro un altro componente APERTO.
const NESTED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="p1">An ordinary paragraph outside of any component at all.</p>
  <outer-box id="outer"></outer-box>
  <script>
    class InnerBox extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML =
          '<div id="deep">Text buried two components deep inside the page.</div>';
      }
    }
    customElements.define('inner-box', InnerBox);
    class OuterBox extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML =
          '<div id="mid">Text one component deep inside the page.</div><inner-box></inner-box>';
      }
    }
    customElements.define('outer-box', OuterBox);
  </script>
</body></html>`;

// 3) Componente CHIUSO + testo normale: metà pagina è illeggibile per chiunque.
const CLOSED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="p1">A normal paragraph that any script on the page can read and translate.</p>
  <sealed-box id="sealed"></sealed-box>
  <script>
    class SealedBox extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<div style="width:420px;height:90px;font:16px sans-serif">' +
          'Sealed headline nobody can read from outside the component itself.</div>';
        window.__sealed = r; // solo il test tiene il riferimento
      }
    }
    customElements.define('sealed-box', SealedBox);
  </script>
</body></html>`;

// 4) SOLO componenti chiusi: non c'è NIENTE di leggibile.
const ONLY_CLOSED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <sealed-only id="s1"></sealed-only>
  <script>
    class SealedOnly extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<div style="width:500px;height:200px;font:16px sans-serif">' +
          'Every single word of this page is sealed inside a closed component.</div>';
        window.__sealed = r;
      }
    }
    customElements.define('sealed-only', SealedOnly);
  </script>
</body></html>`;

// 5) Pagina NORMALE piena di decorazioni (icone SVG, immagini, canvas, riquadri
//    vuoti): qui "solo in parte" sarebbe un FALSO ALLARME. È il rischio che il
//    lavoro stesso dichiara di aver accettato: va misurato.
const DECORATED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">An ordinary article with a lot of decoration around it</h1>
  <svg width="24" height="24"><circle cx="12" cy="12" r="10"></circle></svg>
  <svg width="32" height="32"><rect width="32" height="32"></rect></svg>
  <canvas width="300" height="120"></canvas>
  <div style="width:200px;height:200px;background:#eee"></div>
  <div style="width:120px;height:60px;background:#ddd"></div>
  <img width="150" height="150" alt="">
  <p id="p1">The first paragraph of an article that is entirely readable by any script.</p>
  <p id="p2">The second paragraph, equally readable, with nothing sealed anywhere on this page.</p>
</body></html>`;

// 6) Contenuto proiettato con <slot>: il testo sta nel light DOM ma si VEDE
//    dentro il componente. Se venisse raccolto due volte uscirebbe "IT IT ".
const SLOTTED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="p1">A plain paragraph sitting next to the slotted component here.</p>
  <slot-box><span id="light">Projected text that the component displays through a slot.</span></slot-box>
  <script>
    class SlotBox extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div>';
      }
    }
    customElements.define('slot-box', SlotBox);
  </script>
</body></html>`;

// 7) Testo ostile DENTRO il componente: se la sostituzione passasse per l'HTML
//    invece che per il testo, qui nascerebbe uno <script> vero.
const HOSTILE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="p1">A harmless paragraph that keeps the page from being empty here.</p>
  <evil-card id="evil"></evil-card>
  <script>
    class EvilCard extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        const d = document.createElement('div');
        d.id = 'hostile';
        d.textContent = '<script>window.__pwned = 1;<\\/script> and <img src=x onerror="window.__pwned=2">';
        r.appendChild(d);
      }
    }
    customElements.define('evil-card', EvilCard);
  </script>
</body></html>`;

// ── Stub del modello: "IT " davanti a ogni blocco ───────────────────────────

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

// Testo dentro un componente CHIUSO: solo il test può leggerlo.
const sealedText = (page) => page.evaluate(() => (window.__sealed ? window.__sealed.textContent : ''));

// ── Il sintomo ──────────────────────────────────────────────────────────────

test('#439 il testo dentro un componente aperto viene tradotto', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, OPEN);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(page.locator('#stitle')).toHaveText(/^IT /);
  await expect(page.locator('#sbody')).toHaveText(/^IT /);

  await page.screenshot({ path: 'tests/.shots/probe-439-open.png' }).catch(() => {});

  // Niente è rimasto fuori: qui "solo in parte" sarebbe un falso allarme.
  const t = await toasts(page);
  expect(t).toContain('Pagina tradotta');
  expect(t.join(' | ')).not.toContain('solo in parte');
});

test('#439 traduce anche i componenti annidati', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, NESTED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(page.locator('#mid')).toHaveText(/^IT /);
  await expect(page.locator('#deep')).toHaveText(/^IT /);
});

test('#439 con un componente chiuso lo dice: "solo in parte"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, CLOSED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  // Ciò che è leggibile viene comunque tradotto.
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  // Ciò che è sigillato resta com'era (nessuno può toccarlo).
  expect(await sealedText(page)).toContain('Sealed headline');

  await expect
    .poll(async () => (await toasts(page)).some((x) => x.includes('solo in parte')), { timeout: 30000 })
    .toBe(true);
  // …e NON deve dichiarare di aver finito.
  expect(await toasts(page)).not.toContain('Pagina tradotta');

  await page.screenshot({ path: 'tests/.shots/probe-439-closed.png' }).catch(() => {});
});

test('#439 pagina fatta SOLO di componenti chiusi: lo dice invece di tacere', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, ONLY_CLOSED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#s1');

  await expect
    .poll(async () => (await toasts(page)).some((x) => x.includes('componenti chiusi')), { timeout: 30000 })
    .toBe(true);
  expect(await toasts(page)).not.toContain('Non ho trovato testo da tradurre in questa pagina');
});

// ── Il rischio dichiarato: il falso "solo in parte" ─────────────────────────

test('#439 una pagina normale piena di decorazioni NON diventa "solo in parte"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, DECORATED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(page.locator('#p2')).toHaveText(/^IT /);

  const t = await toasts(page);
  expect(t).toContain('Pagina tradotta');
  expect(t.join(' | ')).not.toContain('solo in parte');
});

// ── Doppioni e ritorno indietro ─────────────────────────────────────────────

test('#439 il testo proiettato con slot non viene tradotto due volte', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SLOTTED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#light')).toHaveText(/^IT /);
  await expect(page.locator('#light')).not.toHaveText(/^IT IT /);
});

test('#439 "Mostra originale" riporta indietro anche il testo dentro i componenti', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, OPEN);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#stitle')).toHaveText(/^IT /);

  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#stitle')).toHaveText('A headline locked inside a component');
  await expect(page.locator('#sbody')).toHaveText('Body copy that lives inside the component and used to stay in English forever.');
  await expect(page.locator('#p1')).toHaveText('A normal paragraph living in the light DOM of the document.');
});

// ── Testo ostile dentro il componente ───────────────────────────────────────

test('#439 il testo ostile dentro un componente resta testo', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, HOSTILE);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#p1')).toHaveText(/^IT /);
  // Niente è stato eseguito e niente è diventato un elemento vero.
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  const injected = await page.evaluate(() => {
    const host = document.querySelector('evil-card');
    const r = host && host.shadowRoot;
    if (!r) return { scripts: -1, imgs: -1 };
    return { scripts: r.querySelectorAll('script').length, imgs: r.querySelectorAll('img').length };
  });
  expect(injected.scripts).toBe(0);
  expect(injected.imgs).toBe(0);
});
