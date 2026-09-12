// Verifica #586, giro 6 — quello che il feedback chiede per esteso: dopo il
// «Consenti» il sito deve ricevere il permesso.
//
// Le sei cose elencate nel feedback sono fotocamera, microfono, posizione,
// notifiche, appunti e schermo. Fotocamera, microfono e schermo li hanno
// provati i giri passati, la posizione è finita in un rilievo suo. Qui restano
// le notifiche e gli appunti, presi dal punto di vista di chi naviga: prima del
// sì non arriva niente, dopo il sì arriva.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<script>
  window.__notifiche = () => Notification.requestPermission().then((r) => r, (e) => 'errore');
  window.__stato = () => Notification.permission;
  window.__mandane = () => { try { new Notification('ciao'); return 'inviata'; } catch (e) { return 'no:' + e.name; } };
  window.__appunti = () => navigator.clipboard.readText().then((t) => 'letto:' + t, (e) => 'no:' + ((e && e.name) || '?'));
</script></body></html>`;

test('dopo il «Consenti» le notifiche arrivano davvero', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  expect(await page.evaluate(() => window.__stato()), 'prima di chiedere deve leggersi «default»').toBe('default');

  const esito = page.evaluate(() => window.__notifiche());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  const frase = await shell.locator('.perm-chip').innerText();
  console.log('[586 g6] domanda delle notifiche:', JSON.stringify(frase));
  await shell.locator('.perm-chip .perm-chip-allow').click();

  const risposta = await esito;
  await page.waitForTimeout(600);
  const dopo = await page.evaluate(() => window.__stato());
  const inviata = await page.evaluate(() => window.__mandane());
  console.log('[586 g6] notifiche — risposta:', risposta, 'stato dopo:', dopo, 'invio:', inviata);

  expect(risposta, 'chi consente deve ricevere «granted»').toBe('granted');
  expect(dopo, 'e da lì in poi il sito deve leggersi «granted»').toBe('granted');
  expect(inviata, 'e una notifica deve poter partire').toBe('inviata');
});

test('dopo il «Consenti» il sito legge davvero gli appunti, e prima no', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo-negli-appunti-33'));
  const page = await testServer.openReady(openTab, HTML);

  // Prima: si nega, e il sito non legge niente.
  const primo = page.evaluate(() => window.__appunti());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-btn:not(.perm-chip-allow)').first().click();
  const esitoPrimo = await primo;
  console.log('[586 g6] appunti dopo il Nega:', esitoPrimo);
  expect(String(esitoPrimo), 'dopo un Nega il sito non deve leggere niente').not.toContain('testo-negli-appunti-33');

  // Poi si ribalta la scelta dalle Impostazioni e il sito deve ottenerli.
  const host = new URL(page.url()).host;
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sicurezza = await (async () => {
    const fine = Date.now() + 15_000;
    while (Date.now() < fine) {
      const w = app.windows().find((x) => { try { return x.url().includes('security.html'); } catch (_) { return false; } });
      if (w) return w;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  })();
  expect(sicurezza, 'pagina Sicurezza non trovata').toBeTruthy();
  await sicurezza.waitForLoadState('domcontentloaded').catch(() => {});
  await sicurezza.waitForTimeout(1200);
  const riga = sicurezza.locator('#perms-list li').filter({ hasText: host }).first();
  console.log('[586 g6] riga in Impostazioni:', JSON.stringify(await riga.innerText().catch(() => '')));
  // Il comando che RIBALTA la scelta è quello che dice lo stato; il × la toglie.
  await riga.locator('button').filter({ hasText: /^(Negato|Denied)$/ }).first().click();
  await sicurezza.waitForTimeout(1500);
  console.log('[586 g6] riga dopo il ribaltamento:', JSON.stringify(await riga.innerText().catch(() => '')));

  const secondo = await page.evaluate(() => window.__appunti());
  console.log('[586 g6] appunti dopo il ribaltamento a «consentito»:', secondo);
  expect(
    String(secondo),
    'ribaltata la scelta a «consentito» dalle Impostazioni, il sito deve ottenere gli appunti '
    + 'senza dover richiedere e senza che ricompaia la domanda',
  ).toContain('testo-negli-appunti-33');
});
