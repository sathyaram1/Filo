// Verifica #576, rilievo 3: spegnere il blocco della pubblicità fa tornare i riquadri nelle pagine già aperte.
import { test, expect } from '../../fixtures/electron.mjs';

test('spento il blocco, la pagina aperta mostra di nuovo i riquadri nascosti', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const A = globalThis.__filoAdblock;
    A.setCosmeticForTest('##.ad-slot');
    A.configureFromSettings({ security: { adblock: { enabled: true } } });
  });
  const page = await testServer.openReady(openTab, '<!doctype html><title>V576_R3</title><div class="ad-slot">riquadro</div>', { pubblico: true });
  const disp = () => page.evaluate(() => getComputedStyle(document.querySelector('.ad-slot')).display);
  await expect.poll(disp, { timeout: 5_000 }).toBe('none');
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-adblock', { timeout: 8_000 });
  await sec.locator('#sec-adblock').uncheck();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  await expect.poll(disp, { timeout: 5_000 }).toBe('block');
});
