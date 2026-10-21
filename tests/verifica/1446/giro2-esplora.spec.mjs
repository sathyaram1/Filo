// Verifica #1446 giro 2: prove sul correttore a due segni con un modello finto.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const pagina = (sopra = '<p>Anna: ciao! ci vediamo martedì?</p>', scuro = false) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif;${scuro ? 'background:#1f1b18;color:#ece4da;color-scheme:dark' : ''}">
<main>
  ${sopra}
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
</main>
</body>`;

async function apri(app, openTab, testServer, opz = {}) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: opz.suggerimenti !== undefined },
      correttore: { modelloErrori: true, ripetizioni: true },
    });
    Object.assign(globalThis, { __rapide: [], __partiti: [], __errori: opz.errori || {}, __suggerimenti: opz.suggerimenti || {} });
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      globalThis.__partiti.push(t);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      const righe = (nuovo, voci, tipo) => Object.entries(voci).filter(([p]) => nuovo.includes(p)).map(([p, [c, m]]) => `[${p}][${c}][${m}][${tipo}]`);
      if (t.includes('Sei il controllo rapido di un correttore')) {
        const nuovo = busta(t, 'TESTO NUOVO:\n');
        globalThis.__rapide.push({ nuovo });
        return fine(righe(nuovo, globalThis.__errori, 'errore').join('\n') || '[][][][nessuno]');
      }
      if (t.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO NUOVO:\n');
        return fine(righe(nuovo, globalThis.__suggerimenti, 'suggerimento').join('\n') || '[][][][nessuno]');
      }
      return fine('');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, opz);
  const page = await testServer.openReady(openTab, pagina(opz.sopra, opz.scuro), { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

const errore = (page, testo) => page.locator('.sn-spell-overlay .sn-errore', { hasText: testo });
const suggerimento = (page, testo) => page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: testo });

async function tastoDestroSu(page, loc) {
  const b = await riquadroDelSegno(loc);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).pannelli.first()).toBeVisible({ timeout: 5000 });
  return menuDi(page);
}

test('esplora: password scritta in chat come risposta a chi la chiede', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { sopra: '<p>Marco: mi mandi la password del wifi?</p>' });
  await page.locator('#ta').click();
  await page.keyboard.type('certo, Gatto2024 ');
  await expect.poll(() => app.evaluate(() => globalThis.__rapide.length), { timeout: 5000 }).toBeGreaterThan(0);
  const partiti = await app.evaluate(() => globalThis.__partiti);
  console.log('PARTITI', JSON.stringify(partiti.map((t) => t.slice(-400))));
  for (const t of partiti) expect(t).not.toContain('Gatto2024');
});

test('esplora: annulla dopo una correzione dal tasto destro', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quseta: ['questa', 'Refuso.'] } });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao quseta ');
  const segno = errore(page, 'quseta');
  await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
  const menu = await tastoDestroSu(page, segno);
  await menu.principale.locator(':scope > *').first().locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('ciao questa ');
  await page.locator('#ta').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ta')).toHaveValue('ciao quseta ');
});

test('esplora: Ignora su un errore e su un suggerimento, poi riscritti', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    errori: { quseta: ['questa', 'Refuso.'] }, suggerimenti: { 'alle 18': ['', 'Alle 18 di quale giorno?'] },
  });
  await page.locator('#ta').click();
  await page.keyboard.type('vedo quseta casa alle 18. ');
  await expect(errore(page, 'quseta')).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
  await expect(suggerimento(page, 'alle 18')).toHaveCount(1, { timeout: 8000 });
  let menu = await tastoDestroSu(page, suggerimento(page, 'alle 18'));
  await expect(menu.voce('Valuta')).toBeVisible();
  await menu.voce('Ignora').click();
  await expect(suggerimento(page, 'alle 18')).toHaveCount(0);
  menu = await tastoDestroSu(page, errore(page, 'quseta'));
  await menu.voce('Ignora').click();
  await expect(errore(page, 'quseta')).toHaveCount(0);
  await page.locator('#ta').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Poi ');
  await page.waitForTimeout(5000);
  await expect(errore(page, 'quseta')).toHaveCount(0);
  await expect(suggerimento(page, 'alle 18')).toHaveCount(0);
});

test('esplora: emoji prima dell\'errore nel campo modificabile, e testo lungo incollato', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quseta: ['questa', 'Refuso.'] } });
  await page.locator('#ce').click();
  await page.keyboard.type('😀😀👍🏽 ciao quseta casa ');
  const segno = errore(page, 'quseta');
  await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
  const r = await page.evaluate(() => {
    const ce = document.getElementById('ce');
    const n = ce.firstChild;
    const range = document.createRange();
    const i = n.nodeValue.indexOf('quseta');
    range.setStart(n, i); range.setEnd(n, i + 6);
    const p = range.getBoundingClientRect();
    const s = document.querySelector('.sn-spell-overlay .sn-errore').getBoundingClientRect();
    return { p: p.left, s: s.left, pw: p.width, sw: s.width };
  });
  expect(Math.abs(r.p - r.s)).toBeLessThan(3);
  const menu = await tastoDestroSu(page, segno);
  await menu.principale.locator(':scope > *').first().locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ce')).toHaveText('😀😀👍🏽 ciao questa casa ');

  await app.evaluate(() => { globalThis.__rapide = []; });
  const lungo = 'Questa è una frase normale con quseta dentro. '.repeat(250);
  await page.locator('#ta').click();
  await page.evaluate((t) => { const ta = document.getElementById('ta'); ta.focus(); }, lungo);
  await page.keyboard.insertText(lungo);
  await page.waitForTimeout(4000);
  const quante = await app.evaluate(() => globalThis.__rapide.length);
  console.log('RAPIDE DOPO INCOLLA', quante);
  expect(quante).toBeLessThan(6);
  await expect(page.locator('.sn-spell-overlay .sn-errore').first()).toBeVisible({ timeout: 6000 });
});

for (const scuro of [false, true]) {
  test(`esplora: tre segni e menu del suggerimento ${scuro ? 'scuro' : 'chiaro'}`, async ({ app, openTab, testServer }) => {
    if (scuro) await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
    const page = await apri(app, openTab, testServer, {
      scuro, errori: { quseta: ['questa', 'Refuso: si scrive «questa».'] }, suggerimenti: { 'alle 18': ['', 'Alle 18 di quale giorno? Nella chat si parla di martedì.'] },
    });
    await page.locator('#ta').click();
    await page.keyboard.type('vediamo quseta casa alle 18. ');
    await expect(errore(page, 'quseta')).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
    await expect(suggerimento(page, 'alle 18')).toHaveCount(1, { timeout: 8000 });
    await page.keyboard.type('Poi Zanzottera ');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/v1446-segni-${scuro ? 'scuro' : 'chiaro'}.png`, clip: { x: 0, y: 0, width: 820, height: 220 } });
    const menu = await tastoDestroSu(page, suggerimento(page, 'alle 18'));
    await page.waitForTimeout(400);
    await menu.superficie.screenshot({ path: `tests/.shots/v1446-menu-sugg-${scuro ? 'scuro' : 'chiaro'}.png` });
    await page.keyboard.press('Escape');
    const menu2 = await tastoDestroSu(page, errore(page, 'quseta'));
    await page.waitForTimeout(400);
    await menu2.superficie.screenshot({ path: `tests/.shots/v1446-menu-err-${scuro ? 'scuro' : 'chiaro'}.png` });
  });
}
