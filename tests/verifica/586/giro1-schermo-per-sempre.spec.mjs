// Verifica #586, giro 1 — «vedere il tuo schermo» consentito una volta.
//
// Fotocamera e microfono accesi si vedono (la spia, il video che parte); lo
// schermo condiviso no: chi guarda non si accorge di niente. Per questo nessun
// browser ricorda «sempre» per la cattura dello schermo — la richiede ogni
// volta, e mentre dura lo dice. Qui si controlla cosa succede in Filo alla
// SECONDA richiesta dello stesso sito, dopo un «Consenti».

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<button id="b" style="font:16px sans-serif;padding:20px">condividi</button>
<p id="esito">-</p>
<script>
  window.__n = 0;
  document.getElementById('b').addEventListener('click', () => {
    window.__n += 1;
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {}
        window['__r' + window.__n] = 'ok'; },
      (e) => { window['__r' + window.__n] = (e && e.name) ? e.name : 'errore'; },
    );
  });
</script>
</body></html>`;

test('lo schermo consentito una volta viene ripreso senza chiedere e senza dirlo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  // Primo giro: il sito chiede, compare la domanda, si consente.
  await page.click('#b');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await expect(chip).toContainText('schermo');
  await chip.locator('.perm-chip-allow').click();
  await expect(chip).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.__r1 || null), { timeout: 15_000 }).not.toBeNull();
  const primo = await page.evaluate(() => window.__r1);
  // eslint-disable-next-line no-console
  console.log('[586] prima cattura:', primo);

  // Secondo giro, stesso sito: qui un browser richiederebbe. Filo?
  await page.click('#b');
  await page.waitForTimeout(2500);
  const domande = await chip.count();
  const secondo = await page.evaluate(() => window.__r2 || null);
  // eslint-disable-next-line no-console
  console.log('[586] seconda cattura:', secondo, '— domande comparse:', domande);

  expect(
    domande,
    'il sito ha ripreso lo schermo una seconda volta senza che comparisse niente: '
    + 'il «Consenti» della prima volta è stato scritto come «sempre», e una ripresa dello schermo '
    + 'non lascia nessun segno visibile mentre è in corso',
  ).toBe(1);
});
