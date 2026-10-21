// #837 — Il font dei link, la durata delle animazioni e l'intensità delle ombre si cambiano dalle Preferenze e
// chiedendolo a Filo. Gli assert guardano quello che arriva all'utente: lo stile calcolato dei link, dei menu,
// delle schede e della pagina, non solo la variabile. Le foto (tests/.shots/) mostrano il riquadro a 0, a 2 e l'ombra.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { menuAperto, barraPage } from './helpers/barra.mjs';
import { home as homeChat, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');

const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);
const azione = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), { type: 'IMPOSTA_ESTETICA', ...a });
const tokensSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});
const stile = (page, sel, prop) => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el)[p] : null;
}, [sel, prop]);
const alfa = (ombra) => Number((/rgba\(0, 0, 0, ([0-9.]+)\)/.exec(String(ombra)) || [])[1]);

const SITO = `<!doctype html><html><body style="padding:40px;font:16px 'Courier New', monospace">
  <p id="frase">Una frase con <a id="link" href="#x">un link del sito</a>.</p>
</body></html>`;

test('font dei link dalle Preferenze: cambiano i link di Filo e non il resto; senza ritocco seguono il font della UI', async ({ shell, openTab, testServer }) => {
  const doc = await openTab('filo://transparency/transparency.html');
  await doc.waitForSelector('a.sn-nav-item');
  const testoPrima = await stile(doc, 'h1, h2, p', 'fontFamily');

  const pref = await openTab('filo://preferences/preferences.html');
  const campo = pref.locator('[id="tok-link.font"]');
  await expect(campo).toHaveValue(/Segoe UI/);
  await campo.fill('Georgia, serif');
  await expect.poll(() => stile(doc, 'a.sn-nav-item', 'fontFamily')).toBe('Georgia, serif');
  expect(await stile(doc, 'h1, h2, p', 'fontFamily'), 'il resto del testo non cambia').toBe(testoPrima);

  // I link dei siti restano del sito.
  const sito = await testServer.openReady(openTab, SITO);
  await expect.poll(() => sito.evaluate(() => !!document.getElementById('sn-theme-tokens'))).toBe(true);
  expect(await stile(sito, '#link', 'fontFamily')).toMatch(/Courier New/);

  // ↺ sulla riga: il link torna a seguire il font dell'interfaccia, anche quando lo si cambia.
  await pref.locator('.sn-token-row[data-token="link.font"] .sn-token-reset').click();
  await expect.poll(() => stile(doc, 'a.sn-nav-item', 'fontFamily')).toBe(testoPrima);
  await setTokens(shell, { font: 'Verdana, sans-serif' });
  await expect.poll(() => stile(doc, 'a.sn-nav-item', 'fontFamily')).toBe('Verdana, sans-serif');
  await expect(pref.locator('[id="tok-link.font"]')).toHaveValue('Verdana, sans-serif');

  // Toccato il suo, il link non segue più quello dell'interfaccia.
  await setTokens(shell, { font: 'Verdana, sans-serif', 'link.font': 'Georgia, serif' });
  await expect.poll(() => stile(doc, 'a.sn-nav-item', 'fontFamily')).toBe('Georgia, serif');
  expect(await stile(doc, 'h1, h2, p', 'fontFamily')).toBe('Verdana, sans-serif');
  await setTokens(shell, {});
});

test('un valore non valido è rifiutato con un errore puntuale, dalle Preferenze e dalla chat', async ({ app, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  const riga = pref.locator('.sn-token-row[data-token="motion"]');
  await riga.locator('input').fill('5');
  await riga.locator('input').blur();
  await expect(riga.locator('.sn-token-error')).toBeVisible();
  await expect(riga.locator('.sn-token-error')).toContainText('fra 0 e 3');
  mkdirSync(SHOTS, { recursive: true });
  await pref.locator('.sn-token-row[data-token="radius"]').scrollIntoViewIfNeeded();
  await pref.locator('#tokenCode').screenshot({ path: join(SHOTS, 'preferenze-token.png') });
  expect((await tokensSalvati(app)).motion).toBeUndefined();

  const r = await azione(app, { token: 'motion', valore: '2x' });
  expect(r.executed).toBe(false);
  expect(r.output.error).toContain('fra 0 e 3');
  const o = await azione(app, { token: 'shadow', valore: '0 4px 16px black' });
  expect(o.output.error).toContain('fra 0 e 1');
  expect(await tokensSalvati(app)).toEqual({});
});

test('«togli le animazioni»: menu del tasto destro, schede e pagine di Filo non si animano più; «rimettile» torna com\'era', async ({ app, shell, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, SITO);
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('.dash-carta');

  const r = await azione(app, { token: 'motion', valore: '0' });
  expect(r.executed).toBe(true);

  // Il passaggio sulle schede.
  await expect.poll(() => stile(shell, '.tab', 'transitionDuration')).toBe('0s');
  // Le pagine di Filo.
  await expect.poll(() => stile(home, '.dash-carta', 'transitionDuration')).toMatch(/^0s(, 0s)*$/);
  // Il menu del tasto destro sulla pagina...
  await sito.locator('#frase').click({ button: 'right' });
  await expect(menuDi(sito).locator('.sn-menu').first()).toBeVisible();
  expect(await menuDi(sito).locator('.sn-menu').first().evaluate((m) => getComputedStyle(m).animationDuration)).toBe('0s');
  await sito.keyboard.press('Escape');
  // ...e quello della scheda, che vive in una finestra sua.
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10 }));
  });
  const menu = await menuAperto(app);
  expect(menu, 'il menu della scheda non è comparso').toBeTruthy();
  expect(await menu.evaluate(() => getComputedStyle(document.querySelector('.menu')).animationDuration)).toBe('0s');
  await menu.keyboard.press('Escape').catch(() => {});

  // La barra laterale vive in una vista sua: la durata le arriva dalla shell.
  const barra = await barraPage(app);
  await expect.poll(() => stile(barra, '.pannello', 'transitionDuration')).toBe('0s, 0s');

  // Due volte più lente.
  await azione(app, { token: 'motion', valore: '2' });
  await expect.poll(() => stile(shell, '.tab', 'transitionDuration')).toBe('0.2s');
  await expect.poll(() => stile(barra, '.pannello', 'transitionDuration')).toBe('0.4s, 0s');
  expect(await stile(barra, '.pannello', 'transitionDelay'), 'la visibilità aspetta la fine della corsa').toBe('0s, 0.4s');
  await expect.poll(() => stile(home, '.dash-carta', 'transitionDuration')).toMatch(/^0\.36s/);

  // «Rimetti le animazioni»: il token torna al predefinito e le durate a quelle di sempre.
  const via = await azione(app, { token: 'motion', valore: 'predefinito' });
  expect(via.executed).toBe(true);
  expect((await tokensSalvati(app)).motion).toBeUndefined();
  await expect.poll(() => stile(shell, '.tab', 'transitionDuration')).toBe('0.1s');
  await expect.poll(() => stile(home, '.dash-carta', 'transitionDuration')).toMatch(/^0\.18s/);
  await sito.locator('#frase').click({ button: 'right' });
  await expect(menuDi(sito).locator('.sn-menu').first()).toBeVisible();
  expect(await menuDi(sito).locator('.sn-menu').first().evaluate((m) => getComputedStyle(m).animationDuration)).toBe('0.1s');
});

test('«ombre più leggere»: menu, schede e pagine schiariscono l\'ombra in proporzione', async ({ app, shell, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, SITO);
  await sito.locator('#frase').click({ button: 'right' });
  const menuSito = menuDi(sito).locator('.sn-menu').first();
  await expect(menuSito).toBeVisible();
  const prima = alfa(await menuSito.evaluate((m) => getComputedStyle(m).boxShadow));
  expect(prima).toBeCloseTo(0.18, 2);
  const tabPrima = alfa(await stile(shell, '.tab.active', 'boxShadow'));

  await azione(app, { token: 'shadow', valore: '0.09' });
  await expect.poll(async () => alfa(await menuSito.evaluate((m) => getComputedStyle(m).boxShadow))).toBeCloseTo(0.09, 2);
  // Un'ombra scritta a mano nella shell scende della stessa proporzione.
  await expect.poll(async () => alfa(await stile(shell, '.tab.active', 'boxShadow'))).toBeCloseTo(tabPrima / 2, 2);
  const barra = await barraPage(app);
  await expect.poll(async () => alfa(await stile(barra, '.pannello', 'boxShadow'))).toBeCloseTo(0.08, 2);

  await azione(app, { token: 'shadow', valore: '0' });
  await expect.poll(async () => alfa(await menuSito.evaluate((m) => getComputedStyle(m).boxShadow))).toBe(0);
  await azione(app, { token: 'shadow', valore: 'predefinito' });
  await expect.poll(async () => alfa(await menuSito.evaluate((m) => getComputedStyle(m).boxShadow))).toBeCloseTo(0.18, 2);
});

test('il riquadro di ritocco della durata usa il cursore e mostra il pallino a 0 e a 2', async ({ openTab }) => {
  const home = await openTab('filo://newtab/');
  await home.waitForFunction(() => !!window.SN_AESTHETIC_REFINER && !!window.SN_THEME_TOKENS);
  mkdirSync(SHOTS, { recursive: true });
  await home.evaluate(() => {
    const salvati = [];
    window.__salvati = salvati;
    window.SN_AESTHETIC_REFINER.openOverlay({ token: 'motion', valore: '0' }, {
      Tokens: window.SN_THEME_TOKENS, theme: document.documentElement.dataset.snTheme, overrides: { motion: '0' },
      applyLive: (o) => window.SN_PAGE_BOOTSTRAP.applyThemeTokens(o),
      persist: (o, t) => salvati.push(o[t]),
    });
    window.SN_PAGE_BOOTSTRAP.applyThemeTokens({ motion: '0' });
  });
  const cursore = home.locator('.sn-refine-overlay input[type="range"]');
  await expect(cursore).toHaveAttribute('max', '3');
  await expect(cursore).toHaveValue('0');
  await expect(home.locator('.sn-refine-sample')).toContainText('Nessuna animazione');
  expect(await stile(home, '.sn-refine-sample-dot', 'animationDuration')).toBe('0s');
  await home.locator('.sn-refine-panel').screenshot({ path: join(SHOTS, 'motion-0.png') });

  await cursore.fill('2');
  await expect(home.locator('.sn-refine-sample')).toContainText('Più lente (×2)');
  await expect.poll(() => home.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-motion').trim())).toBe('2');
  expect(await stile(home, '.sn-refine-sample-dot', 'animationDuration')).toBe('2.4s');
  expect(await home.evaluate(() => window.__salvati.at(-1))).toBe('2');
  await home.locator('.sn-refine-panel').screenshot({ path: join(SHOTS, 'motion-2.png') });
  await home.locator('.sn-refine-cancel').click();

  // L'intensità delle ombre: il campione è un riquadro con l'ombra scelta, non il testo selezionato.
  await home.evaluate(() => window.SN_AESTHETIC_REFINER.openOverlay({ token: 'shadow', valore: '0.5' }, {
    Tokens: window.SN_THEME_TOKENS, theme: 'light', overrides: { shadow: '0.5' }, applyLive: () => {}, persist: () => {},
  }));
  await expect(home.locator('.sn-refine-sample')).toContainText('50%');
  expect(await stile(home, '.sn-refine-sample-ombra', 'boxShadow')).toContain('rgba(0, 0, 0, 0.5)');
  await home.locator('.sn-refine-panel').screenshot({ path: join(SHOTS, 'ombra-05.png') });
  await home.locator('.sn-refine-done').click();
});

// #837 r1 — i numeri si scrivono come li scrive un italiano, e la chat può passarli come numero.
const fattore = (page) => page.evaluate(() => window.SN_THEME_TOKENS.motionFactor(document));

test('Preferenze: «1,5» nella velocità delle animazioni e «0,1» nelle ombre si applicano e si salvano col punto', async ({ app, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  const riga = (n) => page.locator(`.sn-token-row[data-token="${n}"]`);
  const motion = riga('motion').locator('input').first();
  await motion.fill('1,5');
  await motion.blur();
  await expect(riga('motion').locator('.sn-token-error')).toBeHidden();
  await expect.poll(() => fattore(page)).toBe(1.5);
  const ombra = riga('shadow').locator('input').first();
  await ombra.fill('0,1');
  await ombra.blur();
  await expect(riga('shadow').locator('.sn-token-error')).toBeHidden();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-shadow-opacity').trim())).toBe('0.1');
  await expect.poll(() => tokensSalvati(app)).toMatchObject({ motion: '1.5', shadow: '0.1' });
});

test('chat: «togli le animazioni» col valore passato come numero dal modello le toglie', async ({ app }) => {
  const page = await homeChat(app);
  // Un cambio estetico riuscito chiude il turno (#1130): la frase va scritta insieme.
  await modelloFinto(app, [
    { text: 'Fatto, animazioni tolte.', toolCalls: [{ id: 't1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"motion","valore":0}' }] },
  ]);
  await chiedi(page, 'togli le animazioni');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'animazioni tolte' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => fattore(page)).toBe(0);
  expect((await tokensSalvati(app)).motion).toBe('0');
  await ripristina(app);
});
