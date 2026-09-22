// #505 giro 3 — il rovescio: testo che si legge benissimo e resta in lingua
// originale perché Filo lo crede ripiegato.
//
// Filo decide "l'utente non lo vede" guardando un elemento alla volta: il suo
// stile e le sue marcature. Ma un contenitore invisibile può contenere un
// figlio che si riprende la visibilità, e un'etichetta per i lettori di schermo
// non dice niente su cosa finisce davanti agli occhi.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  <div style="visibility:hidden">
    <p id="figlio" style="visibility:visible">This sentence is painted on the screen even though its container is hidden.</p>
  </div>
  <p id="marcato" aria-hidden="true">This sentence is painted on the screen and is only hidden from screen readers.</p>
</body></html>`;

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
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
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);

async function apriMenu(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn;
}

async function traduciTutto(page) {
  const btn = await apriMenu(page, '#intro');
  await btn.click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
}

// Quanto sta sullo schermo davvero: senza questo controllo la prova direbbe
// solo "manca", non "si vede e manca".
async function dipinto(page, id) {
  return page.evaluate((k) => {
    const el = document.getElementById(k);
    const r = el.getBoundingClientRect();
    return { area: r.width * r.height, vis: getComputedStyle(el).visibility };
  }, id);
}

test('il figlio che si riprende la visibilità si vede, quindi si traduce', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);

  const d = await dipinto(page, 'figlio');
  expect(d.area, 'il paragrafo deve avere un’area sullo schermo').toBeGreaterThan(0);
  expect(d.vis).toBe('visible');
  await page.screenshot({ path: 'tests/.shots/505-giro3-quel-che-si-vede.png' });

  await expect(page.locator('#figlio')).toHaveText(/^IT /);
});

// Il testo marcato come nascosto ai soli lettori di schermo si vede eccome, ma
// dal giro 1 quella marcatura vale come sezione chiusa e la prova di allora lo
// pretende. Le due strade e quanto costano stanno nella segnalazione: finché
// l'owner non sceglie, questa prova è rossa per scelta, non per un difetto.
test.fixme('il testo marcato come nascosto ai lettori di schermo si vede, quindi si traduce', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);

  const d = await dipinto(page, 'marcato');
  expect(d.area).toBeGreaterThan(0);
  expect(d.vis).toBe('visible');
  await expect(page.locator('#marcato')).toHaveText(/^IT /);
});
