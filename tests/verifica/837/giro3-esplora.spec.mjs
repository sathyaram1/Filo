// Esplorazione del riallineamento #837: il pulsante dei rimedi dell'avviso crediti nella home e lo
// scorrimento della pagina Crediti seguono la velocità delle animazioni.
import { test, expect } from '../../fixtures/electron.mjs';

const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);

const durata = (page) => page.evaluate(() => {
  let box = document.getElementById('esplora-avviso');
  if (!box) {
    box = document.createElement('div');
    box.id = 'esplora-avviso';
    box.className = 'dash-crediti-avviso';
    box.innerHTML = '<button class="sn-crediti-rimedio-btn">x</button>';
    document.body.appendChild(box);
  }
  return getComputedStyle(box.firstChild).transitionDuration;
});

test('home e Crediti seguono la velocità delle animazioni', async ({ shell, openTab }) => {
  const home = await openTab('filo://dashboard/dashboard.html');
  await home.waitForLoadState('domcontentloaded');
  const crediti = await openTab('filo://credits/credits.html');
  await crediti.waitForLoadState('domcontentloaded');

  expect(await durata(home)).toBe('0.15s, 0.15s');
  expect(await crediti.evaluate(() => window.SN_THEME_TOKENS.scrollBehavior(document))).toBe('smooth');

  await setTokens(shell, { motion: '0' });
  await expect.poll(() => durata(home)).toBe('0s, 0s');
  await expect.poll(() => crediti.evaluate(() => window.SN_THEME_TOKENS.scrollBehavior(document))).toBe('auto');

  await setTokens(shell, { motion: '2' });
  await expect.poll(() => durata(home)).toBe('0.3s, 0.3s');

  await setTokens(shell, {});
  await expect.poll(() => durata(home)).toBe('0.15s, 0.15s');
});
