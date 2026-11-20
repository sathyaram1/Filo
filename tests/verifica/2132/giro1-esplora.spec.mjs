// Verifica #2132 giro 1: il controllo ragionato del correttore riceve la conversazione sopra il campo nelle chat
// fatte in modi diversi (turni in <article>, casella in un componente con shadow root, popup di chat, chat di casa).
import { test, expect } from '../../fixtures/electron.mjs';
import { batti } from '../../helpers/tastiera.mjs';

async function prepara(app) {
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
}

async function apri(app, openTab, testServer, html) {
  await prepara(app);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const RISPOSTA = 'ha poteri limitati, non dovrebbe essere un problema';
const MESSAGGIO = 'nelle tue preferenze c\'è un token GitHub in chiaro, ti conviene revocarlo';

async function promptDopo(app, page) {
  await batti(page, RISPOSTA);
  await expect.poll(() => app.evaluate(() => globalThis.__ocra.length), { timeout: 15_000 }).toBeGreaterThan(0);
  return app.evaluate(() => globalThis.__ocra.at(-1));
}

test('turni in <article> dentro <main>, casella in un form', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">
<main>
  <article><h6>Tu hai detto:</h6><p>Puoi fare push e merge?</p></article>
  <article><h6>L'assistente ha detto:</h6><p>Fatto. ${MESSAGGIO}.</p></article>
  <form><div id="ce" contenteditable="true" lang="it" style="min-height:60px;width:600px;font:20px monospace;border:1px solid #ccc"></div></form>
</main></body>`);
  await page.locator('#ce').click();
  const prompt = await promptDopo(app, page);
  expect(prompt).toContain('token GitHub in chiaro');
});

test('casella di una chat dentro un componente con shadow root aperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">
<main>
  <div class="messaggi"><p>Puoi fare push e merge?</p><p>Fatto. ${MESSAGGIO}.</p></div>
  <chat-composer id="comp"></chat-composer>
</main>
<script>
customElements.define('chat-composer', class extends HTMLElement {
  constructor() { super(); const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = '<div id="ce" contenteditable="true" lang="it" style="min-height:60px;width:600px;font:20px monospace;border:1px solid #ccc"></div>'; }
});
</script></body>`);
  await page.locator('#comp #ce').click();
  const prompt = await promptDopo(app, page);
  expect(prompt).toContain('token GitHub in chiaro');
});

test('popup di chat in un dialog piccolo sopra una pagina lunga', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const lungo = Array.from({ length: 40 }, (_, i) => `<p>Paragrafo ${i} di un articolo che non c'entra niente con la chat.</p>`).join('');
  const page = await apri(app, openTab, testServer, `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">
<main>${lungo}
  <div role="dialog" style="position:fixed;right:10px;bottom:10px;width:640px;background:#fff;border:1px solid #999">
    <p>Luca: ${MESSAGGIO}</p>
    <div id="ce" contenteditable="true" lang="it" style="min-height:60px;width:600px;font:20px monospace;border:1px solid #ccc"></div>
  </div>
</main></body>`);
  await page.locator('#ce').click();
  const prompt = await promptDopo(app, page);
  expect(prompt).toContain('token GitHub in chiaro');
});

test('chat di casa: la risposta di Filo sopra la casella', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await prepara(app);
  const casa = await openTab('filo://dashboard/dashboard.html');
  await expect.poll(() => casa.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 8000 }).toBe('input');
  await casa.evaluate((m) => {
    const b = document.getElementById('bubbles');
    const d = document.createElement('div');
    d.className = 'dash-bubble';
    d.textContent = m;
    b.appendChild(d);
    b.hidden = false;
  }, `Ho guardato: ${MESSAGGIO}.`);
  await casa.waitForTimeout(1500);
  await casa.locator('#input').click();
  const prompt = await promptDopo(app, casa);
  expect(prompt).toContain('token GitHub in chiaro');
});
