// Verifica #586, giro 2 — la strada VECCHIA per prendersi lo schermo.
//
// Chromium ha due modi di consegnare lo schermo a una pagina:
//
//   a) quello moderno, `getDisplayMedia()`, che in Electron passa dal gestore
//      della cattura schermo — lì Filo chiede e fa scegliere la fonte;
//   b) quello vecchio, `getUserMedia()` con `chromeMediaSource: 'desktop'` fra
//      i vincoli, che in Electron NON passa da quel gestore: chiede solo il
//      permesso "media" e poi consegna lo schermo intero (e, chiedendo anche
//      l'audio, il suono del computer).
//
// Le due richieste arrivano al gestore dei permessi IDENTICHE: permesso
// «media» con la lista dei tipi VUOTA. Chi le lascia passare per far arrivare
// la (a) alla sua domanda, apre anche la (b) — che domanda non ne ha nessuna,
// e consegna direttamente.
//
// Per chi usa Filo: una pagina qualunque, senza un clic, si riprende lo schermo
// e ascolta l'audio del computer, e non compare niente. È esattamente ciò che
// #586 doveva chiudere.
//
// Questa prova non guarda il codice: apre una pagina, le fa fare la chiamata e
// guarda cosa le arriva in mano.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>pagina di prova</p>
<script>
  const descrivi = (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
  const chiedi = (v) => navigator.mediaDevices.getUserMedia(v).then(
    (s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
  );
  window.__schermoVecchiaManiera = () => chiedi({
    audio: false, video: { mandatory: { chromeMediaSource: 'desktop' } },
  });
  window.__schermoEAudio = () => chiedi({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  });
</script></body></html>`;

// Una traccia è davvero lo schermo (o l'audio del computer) e non il
// dispositivo finto dei test (`fake_device_0`, la webcam simulata).
function traccia(esito, tipo) {
  if (!Array.isArray(esito)) return null;
  return esito.find((t) => t.kind === tipo && !/fake_device/i.test(String(t.label || ''))) || null;
}

test('nessun sito si prende lo schermo senza che compaia la domanda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;
  const chip = shell.locator('.perm-chip');

  // Nessun clic, nessun gesto: la pagina chiama e basta.
  const promessa = page.evaluate(() => window.__schermoVecchiaManiera());
  // Se Filo chiede, la domanda compare entro pochi secondi: si CHIUDE senza
  // decidere, che è il comportamento di chi non vuole dare niente.
  await page.waitForTimeout(3000);
  const comparsa = await chip.count();
  const testo = comparsa ? (await chip.allTextContents())[0] : '';
  if (comparsa) await chip.first().locator('.perm-chip-x').click();
  const esito = await promessa;

  expect(
    comparsa,
    'la pagina ha chiesto lo schermo alla vecchia maniera e non è comparsa nessuna domanda: '
    + `quello che le è arrivato in mano è ${JSON.stringify(esito)}`,
  ).toBeGreaterThan(0);
  expect(testo, 'la domanda deve parlare dello schermo').toContain('schermo');
  expect(
    traccia(esito, 'video'),
    'chiusa la domanda senza decidere, alla pagina non deve arrivare nessuna immagine dello schermo',
  ).toBeNull();

  // E non deve restare scritto niente: non si è deciso nulla.
  const ricordato = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordato[origine], 'una domanda chiusa senza decidere non lascia scritto niente').toBeUndefined();
});

test('nemmeno l\'audio del computer esce senza che compaia la domanda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  const promessa = page.evaluate(() => window.__schermoEAudio());
  await page.waitForTimeout(3000);
  const comparsa = await chip.count();
  if (comparsa) await chip.first().locator('.perm-chip-x').click();
  const esito = await promessa;

  expect(
    comparsa,
    'la pagina ha chiesto schermo E audio del computer alla vecchia maniera senza che comparisse '
    + `niente: quello che le è arrivato in mano è ${JSON.stringify(esito)}`,
  ).toBeGreaterThan(0);
  expect(traccia(esito, 'video'), 'nessuna immagine dello schermo senza un sì').toBeNull();
  expect(traccia(esito, 'audio'), 'nessun audio del computer senza un sì').toBeNull();
});

test('dopo un sì la strada vecchia consegna, e non lascia scritto niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;
  const chip = shell.locator('.perm-chip');

  const promessa = page.evaluate(() => window.__schermoVecchiaManiera());
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  const esito = await promessa;
  expect(
    traccia(esito, 'video'),
    `chi ha detto sì deve ottenere lo schermo: la pagina ha ricevuto ${JSON.stringify(esito)}`,
  ).not.toBeNull();

  // Lo schermo non si ricorda MAI: la volta dopo si richiede.
  await page.waitForTimeout(1200);
  const ricordato = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  expect(ricordato[origine], 'lo schermo non resta scritto: si richiede ogni volta').toBeUndefined();

  const seconda = page.evaluate(() => window.__schermoVecchiaManiera());
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-x').click();
  expect(traccia(await seconda, 'video'), 'la seconda volta si richiede, e un no vale no').toBeNull();
});
