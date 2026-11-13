// Esplorazione: i casi dell'anno di spellcheck-ocra con la battitura di main (batti) invece di keyboard.type.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno, segniDi } from '../../helpers/segniDelCorrettore.mjs';
import { batti } from '../../helpers/tastiera.mjs';

async function apri(app, openTab, testServer, risposta, html) {
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    globalThis.__ocraRisposta = risposta;
    const righe = (json) => {
      let issues = [];
      try { issues = JSON.parse(json).issues || []; } catch (_) {}
      return issues.map((i) => `[${i.testo}][${i.correzione || ''}][${i.spiegazione || ''}][suggerimento]`).join('\n') || '[][][][nessuno]';
    };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('proponi SUGGERIMENTI')) {
        globalThis.__ocra.push(messages[messages.length - 1].content);
        return fine(righe(globalThis.__ocraRisposta));
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, risposta);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const ocra = (page) => segniDi(page, '.sn-spell-overlay .sn-suggerimento');
const chiamate = (app) => app.evaluate(() => globalThis.__ocra.length);
const NOMI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
function noveOttobreVicino() {
  const oggi = new Date();
  const y = oggi.getFullYear();
  const d = [y - 1, y, y + 1].map((a) => new Date(a, 9, 9)).sort((p, q) => Math.abs(p - oggi) - Math.abs(q - oggi))[0];
  return { anno: d.getFullYear(), giorno: NOMI[d.getDay()] };
}
const giudicato = (testo, correzione, spiegazione) => JSON.stringify({ issues: [{ tipo: 'suggerimento', testo, correzione, spiegazione }] });
const PAGINA_ANNO = ({ fuori = '', dentro = '', titolo = 'Chat' }) => `<!doctype html><meta charset="utf-8"><title>${titolo}</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
${fuori}
<main>
  ${dentro}
  <textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>
</main>
</body>`;

test('la conversazione dice l\'anno, battuto come l\'utente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, '{"issues":[]}',
    PAGINA_ANNO({ dentro: '<div class="chat"><p>Luca: ti ricordi il matrimonio di Marta, nel 2024?</p></div>' }));
  await page.locator('#ta').click();
  await batti(page, 'certo, mercoledì 9 ottobre, pioveva ed era autunno.');
  await expect.poll(() => chiamate(app), { timeout: 12_000 }).toBeGreaterThan(0);
  const [prompt] = await app.evaluate(() => globalThis.__ocra);
  const v = noveOttobreVicino();
  expect(prompt).toContain(`«mercoledì 9 ottobre»: il 9 ottobre ${v.anno} è ${v.giorno} (vicino a oggi); il 9 ottobre 2024 è mercoledì (anno scritto`);
  await expect(ocra(page)).toHaveCount(0);
  await app.evaluate((_e, r) => { globalThis.__ocraRisposta = r; },
    giudicato('martedì 9 ottobre', 'mercoledì 9 ottobre', 'Il 9 ottobre 2024 è mercoledì.'));
  await page.keyboard.press('Enter');
  await batti(page, 'e martedì 9 ottobre?');
  await expect(ocra(page)).toHaveText(['martedì'], { timeout: 12_000 });
  const b = await riquadroDelSegno(ocra(page).first());
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page).pannelli;
  await expect(menu.locator('.sn-menu-segno')).toContainText('Il 9 ottobre 2024 è mercoledì');
  await menu.locator('.sn-menu-correction-main', { hasText: 'mercoledì' }).first().click();
  await expect(page.locator('#ta')).toHaveValue('certo, mercoledì 9 ottobre, pioveva ed era autunno.\ne mercoledì 9 ottobre?');
});

test('fondata nel 1999, battuto come l\'utente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const v = noveOttobreVicino();
  const sbagliato = NOMI[[1, 2, 3, 4, 5, 6, 0].find((g) => NOMI[g] !== v.giorno && g !== new Date(1999, 9, 9).getDay())];
  const page = await apri(app, openTab, testServer, giudicato(`${sbagliato} 9 ottobre`, `${v.giorno} 9 ottobre`, `Il 9 ottobre ${v.anno} è ${v.giorno}.`),
    PAGINA_ANNO({ dentro: '<p>Trattoria da Mario, fondata nel 1999</p><h2>Prenota un tavolo</h2>' }));
  await page.locator('#ta').click();
  await batti(page, `vorrei un tavolo per ${sbagliato} 9 ottobre, siamo in 4.`);
  await expect(ocra(page)).toHaveText([sbagliato], { timeout: 12_000 });
  const [prompt] = await app.evaluate(() => globalThis.__ocra);
  expect(prompt).toContain('(anno scritto nella pagina prima del campo: «Trattoria da Mario, fondata nel 1999»)');
});
