// Verifica #1704 giro 1: i due fumetti sulla home, provati da chi usa la home (campo della chat, tema scuro, testo con markup).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { riquadroDelSegno, segniDi } from '../../helpers/segniDelCorrettore.mjs';

async function correttoreFinto(app, opz) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    Object.assign(globalThis, { __ragionato: opz.ragionato, __estrai: opz.estrai, __fontiWeb: opz.fontiWeb, __trattieniWeb: false, __inAttesaWeb: [] });
    globalThis.__rilasciaWeb = () => { globalThis.__trattieniWeb = false; for (const r of globalThis.__inAttesaWeb.splice(0)) r(); };
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) return fine(globalThis.__estrai);
      if (sistema.includes('Sei il controllo rapido')) return fine('NIENTE');
      if (sistema.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO DA RILEGGERE:\n');
        const out = Object.entries(globalThis.__ragionato).filter(([p]) => nuovo.includes(p)).flatMap(([, r]) => r);
        return fine(out.join('\n') || '[][][][nessuno]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async () => {
      if (globalThis.__trattieniWeb) await new Promise((r) => globalThis.__inAttesaWeb.push(r));
      return globalThis.__fontiWeb;
    };
  }, opz);
}

test('#1642 nel campo della chat della home il valore trovato mostra il fumetto di Filo con la spiegazione', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await correttoreFinto(app, {
    ragionato: { 'p/e di soli xx': ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] },
    fontiWeb: [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet (GOOG) P/E ratio: 27.1 as of October 20, 2026' }],
    estrai: '[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]',
  });
  await page.locator('#input').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  const v = segniDi(page, '.sn-spell-valori .sn-spell-valore', { hasText: '27' });
  await expect(v).toBeVisible({ timeout: 10_000 });
  expect(await v.evaluate((el) => el.hasAttribute('title'))).toBe(false);
  const b = await riquadroDelSegno(v);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  const tip = page.locator('[data-sn-fumetto] .tip');
  await page.waitForTimeout(1500);
  console.log('DEBUG', JSON.stringify(await page.evaluate(({ x, y }) => {
    const giu = document.elementFromPoint(x, y);
    const v = document.querySelector('.sn-spell-valori .sn-spell-valore') || null;
    const tutti = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.tagName + '.' + e.className);
    return {
      giu: giu && (giu.tagName + '.' + giu.className + ' tip=' + (giu.dataset && giu.dataset.tip)),
      v: v && v.dataset.tip, sugg: !!window.SN_SUGGERIMENTO, aperto: window.SN_SUGGERIMENTO && window.SN_SUGGERIMENTO.aperto(),
      fumetti: document.querySelectorAll('[data-sn-fumetto]').length, ombre: tutti.slice(0, 10),
    };
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 })));
  console.log('DEBUG2', JSON.stringify(await page.evaluate(() => {
    const v = document.querySelector('.sn-spell-valori .sn-spell-valore');
    const ta = document.querySelector('#input');
    const catena = [];
    for (let e = v; e; e = e.parentElement) { const cs = getComputedStyle(e); catena.push(`${e.tagName}.${e.className} z=${cs.zIndex} pos=${cs.position} pe=${cs.pointerEvents}`); }
    const catTa = [];
    for (let e = ta; e; e = e.parentElement) { const cs = getComputedStyle(e); catTa.push(`${e.tagName}.${e.className} z=${cs.zIndex} pos=${cs.position}`); }
    return { catena, catTa, rv: v.getBoundingClientRect().toJSON(), rta: ta.getBoundingClientRect().toJSON() };
  })));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(800);
  console.log('DEBUG3', await page.locator('#input').inputValue());
  await expect(tip).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText('Rapporto prezzo/utili di Alphabet');
  await expect(tip).toContainText('Fonte: borsa.example');
  await page.screenshot({ path: 'tests/.shots/1704-home-valore-chiaro.png' });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 10_000 });
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden({ timeout: 3000 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  await expect(tip).toBeVisible({ timeout: 3000 });
  await page.screenshot({ path: 'tests/.shots/1704-home-valore-scuro.png' });
});

test('#1635 una segnalazione con markup nel titolo e nel testo si legge come testo nel fumetto, anche in tema scuro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const TITOLO = '<b>Grassetto</b> <img src=x onerror="window.__bucato=1">';
  const TESTO = 'Riga uno 🎉\n<script>window.__bucato=2</script>\n   \nRiga dopo spazi';
  try {
    await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo: TESTO, titolo: TITOLO }) }] }, { text: 'Fatto.' }]);
    await chiedi(page, 'segnala questo');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    await clickConfirm(page, 'cancel');
    const tasto = page.locator('.dash-bubble-filo .dash-action-btn', { hasNotText: '✓' }).first();
    await expect(tasto).toBeVisible({ timeout: 5000 });
    const b = await tasto.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    // Subito dopo l'ingresso non c'è ancora: il breve ritardo della spec.
    const tip = page.locator('[data-sn-fumetto] .tip');
    await expect(tip).toBeVisible({ timeout: 3000 });
    await expect(tip).toContainText('<b>Grassetto</b>');
    await expect(tip).toContainText('<script>');
    expect(await page.evaluate(() => window.__bucato || 0)).toBe(0);
    expect(await tip.locator('b, img, script').count()).toBe(0);
    await page.screenshot({ path: 'tests/.shots/1704-home-segnalazione-scuro.png' });
    // Uscita veloce e rientro veloce: un fumetto solo, poi nessuno.
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(b.x + b.width / 2, b.y - 150);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    }
    await page.mouse.move(b.x + b.width / 2, b.y - 150);
    await expect(page.locator('[data-sn-fumetto] .tip:visible')).toHaveCount(0, { timeout: 3000 });
  } finally {
    await ripristina(app);
  }
});
