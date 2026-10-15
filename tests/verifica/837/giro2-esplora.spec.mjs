// Giro 2 del #837: il font dei link, la velocità delle animazioni e le ombre, dai passi dell'utente.

import { test, expect } from './../../fixtures/electron.mjs';

const estetica = (shell, token, valore) => shell.evaluate(
  ({ t, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_ESTETICA', token: t, valore: v },
  }),
  { t: token, v: valore },
);

const salvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});

async function scrivi(prefs, token, valore) {
  const input = prefs.locator(`#tok-${token.replace('.', '\\.')}`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(valore);
  await input.blur();
}

const fontDi = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontFamily, sel);

test('font dei link dalle Preferenze: cambia i link e non il resto; senza override segue il font della UI', async ({ app, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#tokenCode .sn-token-row');
  await prefs.evaluate(() => {
    const a = document.createElement('a'); a.href = '#'; a.id = 'provaLink'; a.textContent = 'link';
    const s = document.createElement('span'); s.id = 'provaTesto'; s.textContent = 'testo';
    const p = document.createElement('p'); p.append(a, s); document.querySelector('#sec-tokens').append(p);
  });

  await scrivi(prefs, 'link.font', 'Georgia, serif');
  await expect.poll(() => fontDi(prefs, '#provaLink')).toContain('Georgia');
  expect(await fontDi(prefs, '#provaTesto')).not.toContain('Georgia');
  await expect.poll(async () => (await salvati(app))['link.font']).toBe('Georgia, serif');

  // Un'altra pagina di Filo aperta dopo.
  const hist = await openTab('filo://history/history.html');
  await hist.waitForLoadState('load');
  await hist.evaluate(() => { const a = document.createElement('a'); a.id = 'provaLink'; a.href = '#'; a.textContent = 'x'; document.body.append(a); });
  await expect.poll(() => fontDi(hist, '#provaLink')).toContain('Georgia');

  // ↺ sul font dei link, poi il font della UI: i link lo seguono.
  await prefs.bringToFront();
  await prefs.locator('.sn-token-row[data-token="link.font"] .sn-token-reset').click();
  await scrivi(prefs, 'font', '"Courier New", monospace');
  await expect.poll(() => fontDi(prefs, '#provaLink')).toContain('Courier New');
  expect(await fontDi(prefs, '#provaTesto')).toContain('Courier New');
});

test('velocità e ombre dalle Preferenze: virgola accettata, valori assurdi rifiutati con errore', async ({ app, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#tokenCode .sn-token-row');
  await scrivi(prefs, 'motion', '1,5');
  await scrivi(prefs, 'shadow', '0,1');
  await expect.poll(async () => salvati(app)).toMatchObject({ motion: '1.5', shadow: '0.1' });
  for (const brutto of ['4', '-1', 'abc', '1;}', '😀']) {
    await scrivi(prefs, 'motion', brutto);
    const err = prefs.locator('.sn-token-row[data-token="motion"] .sn-token-error');
    await expect(err, brutto).toBeVisible();
    expect(await err.textContent()).toMatch(/fra 0 e 3/);
  }
  expect((await salvati(app)).motion).toBe('1.5');
});

test('«togli le animazioni» in chat (numero 0): pagine di Filo, schede e menu del tasto destro non si animano; «rimetti» torna', async ({ app, shell, openTab, testServer }) => {
  const r = await estetica(shell, 'motion', 0);
  expect(r && r.executed, JSON.stringify(r)).toBe(true);
  expect((await salvati(app)).motion).toBe('0');

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('.sn-btn');
  const durataBottone = () => prefs.evaluate(() => getComputedStyle(document.querySelector('.sn-btn')).transitionDuration);
  await expect.poll(durataBottone).toMatch(/^0s(, 0s)*$/);

  const durataScheda = () => shell.evaluate(() => getComputedStyle(document.querySelector('.tab')).transitionDuration);
  await expect.poll(durataScheda).toMatch(/^0s(, 0s)*$/);

  const web = await testServer.openReady(openTab, '<html><body><p id="t" style="padding:40px">ciao mondo</p></body></html>');
  await web.locator('#t').click({ button: 'right' });
  const menu = web.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((m) => getComputedStyle(m).animationDuration)).toMatch(/^0s/);
  await web.keyboard.press('Escape');

  const r2 = await estetica(shell, 'motion', 'predefinito');
  expect(r2 && r2.executed, JSON.stringify(r2)).toBe(true);
  await expect.poll(durataScheda).not.toMatch(/^0s(, 0s)*$/);
  await prefs.bringToFront();
  await expect.poll(durataBottone).not.toMatch(/^0s(, 0s)*$/);
});

test('ombre: «ombre più leggere» in chat con un numero alleggerisce davvero l’ombra dei menu', async ({ app, shell, openTab }) => {
  const r = await estetica(shell, 'shadow', 0.05);
  expect(r && r.executed, JSON.stringify(r)).toBe(true);
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#tokenCode .sn-token-row');
  const ombra = await prefs.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-shadow-opacity').trim());
  expect(ombra).toBe('0.05');
});
