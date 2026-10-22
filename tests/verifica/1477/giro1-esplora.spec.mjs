// Esplorazione del verificatore #1477: aspetto del «+N» e casi di stress.
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = 'tests/.shots/';

test('aspetto chiaro e scuro, chiuso e aperto', async ({ app, shell, avvisi, openTab }) => {
  test.setTimeout(90_000);
  await shell.evaluate(() => {
    for (let i = 1; i <= 8; i++) window.filoNotify('Download finito: documento-' + i + '.pdf', { durationSec: 0, actions: i === 8 ? [{ label: 'Apri', onClick: () => {} }] : [] });
  });
  const vista = await avvisi();
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(altre).toHaveText('+3 avvisi');
  await vista.waitForTimeout(600);
  await shell.screenshot({ path: SHOTS + '1477-chiaro-chiuso-shell.png' }).catch(() => {});
  await vista.screenshot({ path: SHOTS + '1477-chiaro-chiuso.png' });
  await altre.click();
  await expect(vista.locator('.shell-notif')).toHaveCount(8);
  await vista.waitForTimeout(600);
  await vista.screenshot({ path: SHOTS + '1477-chiaro-aperto.png' });
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await vista.waitForTimeout(1200);
  await vista.screenshot({ path: SHOTS + '1477-scuro-aperto.png' });
  await vista.locator('.avvisi-testa [data-pila="riduci"]').click();
  await vista.waitForTimeout(600);
  await vista.screenshot({ path: SHOTS + '1477-scuro-chiuso.png' });
  const colori = await vista.evaluate(() => {
    const b = document.querySelector('.avvisi-testa [data-pila="apri"]');
    const s = getComputedStyle(b);
    const c = getComputedStyle(document.querySelector('.shell-notif'));
    return { pill: s.backgroundColor, testo: s.color, carta: c.backgroundColor };
  });
  console.log('colori scuro', JSON.stringify(colori));
});

test('aperto con avvisi a tempo: chi arriva intanto si vede, e finiti tutti non resta niente', async ({ shell, avvisi }) => {
  await shell.evaluate(() => {
    for (let i = 1; i <= 8; i++) window.filoNotify('Avviso ' + i, { durationSec: 2 });
  });
  const vista = await avvisi();
  await vista.locator('.avvisi-testa [data-pila="apri"]').click();
  await expect(vista.locator('.shell-notif')).toHaveCount(8);
  await vista.mouse.move(1, 1);
  await shell.evaluate(() => window.filoNotify('Avviso nuovo', { durationSec: 2 }));
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Avviso nuovo' })).toBeInViewport();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 12_000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(0);
  await expect(vista.locator('.avvisi-testa')).toBeHidden();
});

test('Chiudi tutti mentre continuano ad arrivare avvisi', async ({ shell, avvisi }) => {
  await shell.evaluate(() => {
    for (let i = 1; i <= 7; i++) window.filoNotify('Fermo ' + i, { durationSec: 0 });
  });
  const vista = await avvisi();
  await vista.locator('.avvisi-testa [data-pila="apri"]').click();
  await shell.evaluate(() => {
    let n = 0;
    window.__flusso = setInterval(() => { if (n++ < 12) window.filoNotify('Flusso ' + n, { durationSec: 3 }); }, 700);
  });
  const tutti = vista.locator('.avvisi-testa [data-pila="chiudi-tutti"]');
  await vista.waitForTimeout(2500);
  const disabilitato = await tutti.isDisabled();
  console.log('Chiudi tutti disabilitato durante il flusso:', disabilitato);
  await shell.evaluate(() => clearInterval(window.__flusso));
});

test('il primo e il sesto si ritrovano anche col puntatore sopra la pila', async ({ shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('pronto', { durationSec: 1 }));
  const vista = await avvisi();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await shell.evaluate(() => { for (let i = 1; i <= 6; i++) window.filoNotify('Avviso ' + i, { durationSec: 2 }); });
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(altre).toHaveText('+1 avviso');
  await altre.hover();
  await vista.waitForTimeout(3000);
  await expect(vista.locator('.shell-notif.show')).toHaveCount(5);
  await altre.click();
  await expect(vista.locator('.shell-notif-msg').first()).toHaveText('Avviso 1');
  await expect(vista.locator('.shell-notif-msg').last()).toHaveText('Avviso 6');
});
