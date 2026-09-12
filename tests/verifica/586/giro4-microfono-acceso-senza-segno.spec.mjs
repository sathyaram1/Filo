// Verifica #586, giro 4 — il microfono aperto: nessun segno, e la revoca non
// lo richiude.
//
// Per lo SCHERMO questo lavoro ha fatto le cose giuste: mentre un sito riprende
// compare un segno che lo dice, con un «Interrompi» che chiude la ripresa. La
// ragione scritta accanto è che «una webcam accesa si vede, un microfono aperto
// prima o poi si sente». Il microfono però non ha nessuna spia: su un fisso, e
// su quasi tutti i portatili, non si accende niente e non si sente niente.
//
// Per chi usa Filo: consenti il microfono a un sito. Da quel momento il sito
// ascolta finché la pagina è aperta. Nella cornice non compare niente, e se vai
// in Impostazioni e togli la scelta — la strada che il feedback chiede — il
// microfono resta aperto lo stesso: la revoca vale solo per la volta dopo.
// L'unico modo di chiuderlo è chiudere la scheda, e bisogna sapere quale.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px"><p>pagina</p>
<script>
  window.__tracce = null;
  window.__microfono = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__tracce = s.getTracks(); return s.getTracks().map((t) => t.kind + ':' + t.readyState); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__stato = () => (window.__tracce || []).map((t) => t.kind + ':' + t.readyState);
</script></body></html>`;

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

test('mentre un sito ascolta, qualcosa deve dirlo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const esito = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito, 'chi consente deve ottenere il microfono').toEqual(['audio:live']);
  await shell.waitForTimeout(1200);

  const segni = await shell.evaluate(() => ({
    live: document.querySelectorAll('.perm-live').length,
    chip: document.querySelectorAll('.perm-chip').length,
  }));
  console.log('[586 g4] segni mentre il microfono è aperto:', JSON.stringify(segni));
  await shell.screenshot({ path: 'tests/.shots/586-giro4-microfono-aperto.png' });

  expect(
    segni.live,
    'il microfono è aperto e nella cornice non c\'è niente che lo dica: su un fisso e su '
    + 'quasi tutti i portatili non si accende nessuna spia, e il sito ascolta finché la '
    + 'pagina resta aperta. Per lo schermo, nello stesso lavoro, il segno c\'è',
  ).toBeGreaterThan(0);
});

test('togliere la scelta in Impostazioni deve togliere anche il microfono che è già aperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const host = new URL(page.url()).host;

  const esito = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await esito).toEqual(['audio:live']);

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await aspetta(async () => app.windows().find((w) => {
    try { return w.url().includes('security.html'); } catch (_) { return false; }
  }) || null);
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);

  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  await riga.locator('button[aria-label]').first().click();
  await sicurezza.waitForTimeout(1500);
  console.log('[586 g4] elenco dopo la revoca:',
    JSON.stringify(await sicurezza.locator('#perms-list li').allTextContents()));

  await page.waitForTimeout(2500);
  // Chiudere davvero una traccia già consegnata vuol dire ricaricare la scheda:
  // è l'unica strada, ed è la stessa dell'«Interrompi» sul cartello. Dopo la
  // ricarica del microfono del sito non resta niente.
  const stato = await page.evaluate(() => window.__stato());
  const vive = stato.filter((s) => s.endsWith(':live'));
  console.log('[586 g4] il microfono dopo la revoca:', JSON.stringify(stato));
  console.log('[586 g4] cartelli dopo la revoca:',
    JSON.stringify(await shell.locator('.perm-live').allTextContents()));

  expect(
    vive,
    'tolta la scelta dalle Impostazioni, il sito continua ad ascoltare: la revoca varrebbe solo '
    + 'per la volta dopo. Se si può dare si deve poter togliere, e togliere deve togliere anche '
    + 'quello che il sito ha già in mano',
  ).toEqual([]);
  await expect(shell.locator('.perm-live')).toHaveCount(0, { timeout: 10_000 });
});
