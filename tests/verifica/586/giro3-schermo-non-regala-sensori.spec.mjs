// Verifica #586, giro 3 — dopo un sì alla condivisione dello schermo, la
// fotocamera e il microfono devono restare chiusi.
//
// Il giro 1 aveva trovato la stessa cosa da un'altra porta (la domanda dello
// schermo si presentava come «fotocamera e microfono» e veniva RICORDATA così).
// Quella porta è chiusa. Qui si controlla l'altra metà: che il sì allo schermo
// non lasci comunque aperto il permesso «media» per quella pagina, cosa che
// regalerebbe webcam e microfono senza che compaia più niente — e vale per
// tutte e due le strade dello schermo, la moderna e la vecchia.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>prova</p>
<script>
  const descrivi = (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
  const chiudi = (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} };
  window.__schermoModerno = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    (s) => { const d = descrivi(s); chiudi(s); return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__schermoVecchio = () => navigator.mediaDevices.getUserMedia({
    audio: false, video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => { const d = descrivi(s); chiudi(s); return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__webcamEMicrofono = () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(
    (s) => { const d = descrivi(s); chiudi(s); return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

async function consentiSchermo(shell, quale) {
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 20_000 });
  expect(
    (await chip.allTextContents())[0],
    'la domanda della condivisione dello schermo deve parlare dello schermo',
  ).toContain('schermo');
  await chip.locator('.perm-chip-allow').click();
  if (quale === 'moderno') {
    const box = shell.locator('.perm-source');
    await expect(box).toHaveCount(1, { timeout: 20_000 });
    await box.locator('.perm-source-item').first().click();
  }
  await expect(chip).toHaveCount(0, { timeout: 20_000 });
}

for (const quale of ['moderno', 'vecchio']) {
  test(`il sì allo schermo (${quale}) non apre fotocamera e microfono`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(180_000);
    const page = await testServer.openReady(openTab, HTML);
    const origine = new URL(page.url()).origin;

    const schermo = page.evaluate(
      (q) => (q === 'moderno' ? window.__schermoModerno() : window.__schermoVecchio()), quale,
    );
    await consentiSchermo(shell, quale);
    expect(await schermo, 'chi ha detto sì allo schermo lo deve ottenere').not.toBe('rifiutato:NotAllowedError');

    // Ora la stessa pagina chiede i sensori veri. Deve ricomparire una domanda.
    const sensori = page.evaluate(() => window.__webcamEMicrofono());
    const chip = shell.locator('.perm-chip');
    await expect(
      chip,
      'dopo un sì allo schermo, la fotocamera e il microfono devono tornare a chiedere',
    ).toHaveCount(1, { timeout: 20_000 });
    const testo = (await chip.allTextContents())[0];
    expect(testo, 'e la domanda deve nominare fotocamera e microfono').toMatch(/fotocamera/i);
    await chip.locator('.perm-chip-x').click();
    const esito = await sensori;
    expect(
      esito,
      `chiusa la domanda, i sensori non devono arrivare: la pagina ha ricevuto ${JSON.stringify(esito)}`,
    ).toContain('rifiutato');

    // E il sì allo schermo non deve aver lasciato scritto niente.
    const ricordato = await app.evaluate(async () => {
      const s = await globalThis.SN_STORAGE.getSettings();
      return (s.security && s.security.sitePermissions) || {};
    });
    expect(ricordato[origine], 'lo schermo non si ricorda, e non ricorda nemmeno i sensori').toBeUndefined();
  });
}
