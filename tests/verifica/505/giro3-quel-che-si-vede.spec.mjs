// #505 giro 3 — il rovescio: testo che si legge benissimo e resta in lingua
// originale perché Filo lo crede ripiegato.
//
// Filo decide "l'utente non lo vede" guardando UN elemento alla volta: la sua
// etichetta di accessibilità e il suo stile. Ma un contenitore invisibile può
// contenere un figlio che si vede, e un'etichetta per i lettori di schermo non
// dice niente su cosa finisce sullo schermo. In tutti e due i casi il testo è
// davanti agli occhi, resta in inglese, e dal tasto destro non c'è modo di
// rimediare.

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

test('il testo che si vede si traduce, anche se il contenitore è invisibile o marcato come nascosto', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  const btn = await apriMenu(page, '#intro');
  await btn.click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  // Prima di pretendere la traduzione: quel testo è davvero dipinto sullo
  // schermo? Senza questo controllo la prova direbbe solo "manca", non "si vede
  // e manca".
  const dipinti = await page.evaluate(() => ['figlio', 'marcato'].map((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    return { id, area: r.width * r.height, vis: getComputedStyle(el).visibility };
  }));
  for (const d of dipinti) {
    expect(d.area, `${d.id} deve avere un'area sullo schermo`).toBeGreaterThan(0);
    expect(d.vis, `${d.id} deve essere visibile`).toBe('visible');
  }
  await page.screenshot({ path: 'tests/.shots/505-giro3-quel-che-si-vede.png' });

  await expect(page.locator('#figlio')).toHaveText(/^IT /);
  await expect(page.locator('#marcato')).toHaveText(/^IT /);
});

test('e se resta in inglese, dal tasto destro si deve poter rimediare', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  const btn = await apriMenu(page, '#intro');
  await btn.click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  const restati = await page.evaluate(() => ['figlio', 'marcato']
    .filter((id) => !/^IT /.test(document.getElementById(id).textContent || '')));
  const etichetta = await (await apriMenu(page, '#intro')).getAttribute('aria-label');
  if (restati.length) {
    expect(etichetta, `testo visibile rimasto in inglese (${restati.join(', ')}): il menu offre solo "${etichetta}"`)
      .toBe('Traduci il testo nuovo');
  }
});
