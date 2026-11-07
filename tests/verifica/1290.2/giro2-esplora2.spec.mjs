// Verifica #1290.2 giro 2: componente chiuso con testo dentro sezioni chiuse nei modi comuni.
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';

async function stub(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = async (page) => (await page.evaluate(() => window.__toasts || [])).join(' | ');

const SIGILLATO = (prima, dopo) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <p id="p1">First paragraph of the article, long enough to be picked up by the translation.</p>
  ${prima}<closed-card></closed-card>${dopo}
  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'closed' }).innerHTML = '<h2>Headline locked inside a closed component</h2><p>Body text nobody outside can read.</p>';
      }
    });
  </script>
</body></html>`;

for (const [nome, prima, dopo] of [
  ['schiacciata a zero', '<button>Show more</button><div style="max-height:0;overflow:hidden"><p id="psez">A paragraph inside the folded section, long enough to be translated.</p>', '</div>'],
  ['resa invisibile', '<button>Show more</button><div style="visibility:hidden;height:0"><p id="psez">A paragraph inside the folded section, long enough to be translated.</p>', '</div>'],
  ['in un cassetto fuori schermo', '<nav style="position:fixed;left:0;top:0;width:300px;transform:translateX(-110%)"><p id="psez">A paragraph inside the side drawer, long enough to be translated.</p>', '</nav>'],
]) {
  test(`H componente chiuso con testo in una sezione ${nome}: «solo in parte»`, async ({ app, openTab, testServer }) => {
    await stub(app);
    const page = await testServer.openReady(openTab, SIGILLATO(prima, dopo));
    await watchToasts(page);
    await premiNellaBarra(app, 'translate');
    await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
    await expect.poll(() => toasts(page), { timeout: 30000 }).toMatch(/tradotta/);
    await expect(page.locator('#psez')).toHaveText(/^IT /);
    expect(await toasts(page)).toContain('solo in parte');
  });
}
