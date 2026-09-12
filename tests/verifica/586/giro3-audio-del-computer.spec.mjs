// Verifica #586, giro 3 — chi consente «vedere il tuo schermo» consegna anche
// TUTTO QUELLO CHE SI SENTE SUL COMPUTER, e non gliel'ha detto nessuno.
//
// Il feedback chiede che ogni richiesta sensibile passi da una scelta
// dell'utente. L'audio del computer non è lo schermo: è la chiamata che sta
// facendo in un'altra finestra, la musica, il video di qualcun altro. Un sito
// che chiede `getDisplayMedia({ video: true, audio: true })` — lo fanno tutte
// le videochiamate — riceve una traccia «System audio» insieme all'immagine,
// mentre la domanda dice solo «vuole vedere il tuo schermo», il riquadro della
// scelta dice solo «vedrà quello che scegli qui» e il segno che resta dopo dice
// «può vedere il tuo schermo». Non c'è nessun punto in cui si possa dare
// l'immagine e non l'audio.
//
// Questa prova è verde in due modi: o l'audio del computer non viene
// consegnato, oppure viene NOMINATO (e allora si può rifiutare).

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>prova</p>
<script>
  const descrivi = (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
  const chiudi = (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} };
  window.__schermoConAudio = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
    (s) => { const d = descrivi(s); chiudi(s); return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__vecchiaConAudio = () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => { const d = descrivi(s); chiudi(s); return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

// Una traccia audio che non è un microfono finto dei test: è il suono del
// computer.
function audioDiSistema(esito) {
  if (!Array.isArray(esito)) return null;
  return esito.find((t) => t.kind === 'audio' && !/fake_device/i.test(String(t.label || ''))) || null;
}

test('consentire lo schermo non deve consegnare di nascosto l\'audio del computer', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const promessa = page.evaluate(() => window.__schermoConAudio());

  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  const domanda = (await chip.allTextContents())[0];
  await chip.locator('.perm-chip-allow').click();

  const box = shell.locator('.perm-source');
  await expect(box).toHaveCount(1, { timeout: 20_000 });
  const riquadro = (await box.textContent()) || '';
  await box.locator('.perm-source-item').first().click();

  const esito = await promessa;
  const live = shell.locator('.perm-live');
  await expect(live).toHaveCount(1, { timeout: 20_000 });
  const segno = (await live.textContent()) || '';

  const traccia = audioDiSistema(esito);
  const nominato = /audio|suono|si sente|ascolt/i.test(`${domanda} ${riquadro} ${segno}`);

  expect(
    !traccia || nominato,
    'il sito ha ricevuto l\'audio del computer '
    + `(${JSON.stringify(traccia)}) senza che niente lo nominasse: la domanda diceva ${JSON.stringify(domanda)}, `
    + `il riquadro della scelta ${JSON.stringify(riquadro)}, il segno che resta ${JSON.stringify(segno)}`,
  ).toBe(true);
});

test('e nemmeno passando dalla strada vecchia dello schermo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const promessa = page.evaluate(() => window.__vecchiaConAudio());
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  const domanda = (await chip.allTextContents())[0];
  await chip.locator('.perm-chip-allow').click();

  const esito = await promessa;
  const live = shell.locator('.perm-live');
  await expect(live).toHaveCount(1, { timeout: 20_000 });
  const segno = (await live.textContent()) || '';

  const traccia = audioDiSistema(esito);
  const nominato = /audio|suono|si sente|ascolt/i.test(`${domanda} ${segno}`);
  expect(
    !traccia || nominato,
    'dalla strada vecchia il sito ha ricevuto l\'audio del computer '
    + `(${JSON.stringify(traccia)}) senza che niente lo nominasse: la domanda diceva ${JSON.stringify(domanda)}, `
    + `il segno che resta ${JSON.stringify(segno)}`,
  ).toBe(true);
});
