// #505 giro 3 — le ripiegature scritte con le proprietà nuove, e quelle che
// Filo non ha in elenco.
//
// Stessa domanda dei giri 1 e 2: il sito sceglie COME ripiega una sezione, e da
// quella scelta non possono dipendere né cosa vede l'utente né quanto paga.
// Qui il pannello è chiuso con `scale` (la proprietà, non `transform`), con un
// filtro, o marcato come non espanso: tre modi che lasciano lo schermo identico
// a quelli già coperti.

import { test, expect } from '../../fixtures/electron.mjs';

const parola = (k) => `ZQ${k}TOKEN`;
const frase = (k, d) => `Section ${parola(k)} hidden text about ${d} which nobody has opened yet.`;

const FORME = [
  ['A', 'pannello chiuso con la proprietà scale: 0'],
  ['B', 'pannello schiacciato in verticale con la proprietà scale: 1 0'],
  ['C', 'pannello reso invisibile da un filtro (filter: opacity(0))'],
  ['D', 'pannello marcato come non espanso (aria-expanded="false")'],
];

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>

  <div id="pA" style="scale:0">${frase('A', FORME[0][1])}</div>
  <div id="pB" style="scale:1 0">${frase('B', FORME[1][1])}</div>
  <div id="pC" style="filter:opacity(0)">${frase('C', FORME[2][1])}</div>
  <div id="pD" aria-expanded="false">${frase('D', FORME[3][1])}</div>
  <div id="pRif" style="transform:scale(1,0)">Reference panel folded the old way, already deferred.</div>
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
    globalThis.__filoTranslatePrompts = [];
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
      globalThis.__filoTranslatePrompts.push(chunk);
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
const spedito = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));

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

test('nessuna di queste sezioni chiuse si paga prima che l’utente la apra', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);

  // Il pannello chiuso alla vecchia maniera resta il termine di paragone: se
  // anche quello fosse partito, la prova direbbe altro.
  await expect(page.locator('#pRif')).not.toHaveText(/^IT /);

  const inviato = await spedito(app);
  const pagate = FORME.filter(([k]) => inviato.includes(parola(k))).map(([k, d]) => `${k} (${d})`);
  expect(pagate, `sezioni chiuse spedite al modello e quindi pagate: ${pagate.join(', ')}`).toEqual([]);
});

test('aperte, quelle sezioni fanno offrire la traduzione del testo nuovo', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);

  await expect(await apriMenu(page, '#intro')).toHaveAttribute('aria-label', 'Mostra originale');
  await page.keyboard.press('Escape');

  const mancate = [];
  for (const [k, descr] of FORME) {
    await page.evaluate((key) => {
      const el = document.getElementById('p' + key);
      if (!el) return;
      el.setAttribute('style', '');
      el.removeAttribute('aria-expanded');
    }, k);
    await page.waitForTimeout(150);
    const btn = await apriMenu(page, '#intro');
    const label = await btn.getAttribute('aria-label');
    if (label !== 'Traduci il testo nuovo') mancate.push(`${k} (${descr}) → "${label}"`);
    await page.keyboard.press('Escape');
    await page.evaluate((key) => {
      const el = document.getElementById('p' + key);
      if (el) el.style.display = 'none';
    }, k);
    await page.waitForTimeout(150);
  }
  expect(mancate, `sezioni che, una volta aperte, non fanno offrire la traduzione: ${mancate.join(' | ')}`).toEqual([]);
});
