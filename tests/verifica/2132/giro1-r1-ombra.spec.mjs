// Verifica #2132 giro 1, rilievo 1: in una chat fatta di componenti con shadow root (la casella, o i messaggi) il
// controllo ragionato del correttore non riceve la conversazione, e gli si dice che la pagina non ha altro testo.
import { test, expect } from '../../fixtures/electron.mjs';
import { batti } from '../../helpers/tastiera.mjs';

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      if (t.includes('proponi SUGGERIMENTI')) globalThis.__ocra.push(messages[messages.length - 1].content);
      return { text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const MESSAGGIO = 'nelle tue preferenze c\'è un token GitHub in chiaro, ti conviene revocarlo';
const CASELLA = 'contenteditable="true" lang="it" style="min-height:60px;width:600px;font:20px monospace;border:1px solid #ccc"';

async function promptDopo(app, page) {
  await batti(page, 'ha poteri limitati, non dovrebbe essere un problema');
  await expect.poll(() => app.evaluate(() => globalThis.__ocra.length), { timeout: 15_000 }).toBeGreaterThan(0);
  return app.evaluate(() => globalThis.__ocra.at(-1));
}

test('r1 la casella della chat sta in un componente con shadow root aperto: il ragionato vede la conversazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">
<main>
  <div class="messaggi"><p>Puoi fare push e merge?</p><p>Fatto. ${MESSAGGIO}.</p></div>
  <chat-composer id="comp"></chat-composer>
</main>
<script>
customElements.define('chat-composer', class extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<div id="ce" ${CASELLA}></div>'; }
});
</script></body>`);
  await page.locator('#comp #ce').click();
  const prompt = await promptDopo(app, page);
  expect(prompt).toContain('token GitHub in chiaro');
  expect(prompt).not.toContain('non ha altro testo');
});

test('r1 i messaggi stanno in componenti con shadow root aperto, la casella nella pagina: il ragionato li vede', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">
<main>
  <chat-messaggio testo="Puoi fare push e merge?"></chat-messaggio>
  <chat-messaggio testo="Fatto. ${MESSAGGIO}."></chat-messaggio>
  <div id="ce" ${CASELLA}></div>
</main>
<script>
customElements.define('chat-messaggio', class extends HTMLElement {
  connectedCallback() { (this.shadowRoot || this.attachShadow({ mode: 'open' })).innerHTML = '<p>' + this.getAttribute('testo') + '</p>'; }
});
</script></body>`);
  await page.locator('#ce').click();
  const prompt = await promptDopo(app, page);
  expect(prompt).toContain('token GitHub in chiaro');
});
