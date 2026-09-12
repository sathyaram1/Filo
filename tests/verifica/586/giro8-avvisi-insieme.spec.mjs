// Verifica #586, giro 8 — quando in cima ci sono DUE cose insieme: il cartello
// «può usare il microfono» che resta acceso mentre il sito ascolta, e la
// domanda di un altro permesso che arriva dopo.
//
// Per chi usa Filo: dai il microfono a un sito e il cartello resta lì. Poi
// premi «trovami» sulla stessa pagina: arriva la domanda della posizione. Le due
// righe nascono nello stesso angolo. Se si coprono, o se una delle due finisce
// sotto l'area della pagina (che il sistema compone SEMPRE sopra la cornice di
// Filo), chi naviga non la vede: la domanda scade da sola dopo due minuti e il
// gesto appena fatto non produce niente. È la stessa causa del giro 1 (la
// pastiglia dietro l'area della pagina) e del giro 3 (la domanda sopra l'avviso
// della finestra bloccata), da una terza porta.
//
// E poi: l'«Interrompi» del cartello. Chiude quello che il sito ha in mano, ma
// il permesso resta consentito. Qui si guarda cosa succede se il sito riapre il
// microfono un attimo dopo: se lo riprende in silenzio, almeno il cartello deve
// tornare, altrimenti sta ascoltando e non lo dice più nessuno.

import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px;background:#fff"><p>pagina</p>
<script>
  window.__tracce = [];
  window.__microfono = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { window.__tracce.push(...s.getTracks()); return s.getTracks().map((t) => t.kind + ':' + t.readyState); },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__stato = () => window.__tracce.map((t) => t.kind + ':' + t.readyState);
  window.__trovami = () => new Promise((res) => {
    navigator.geolocation.getCurrentPosition(
      () => res('ok'), (e) => res('no:' + ((e && e.code) || '?')), { timeout: 60000 });
  });
</script></body></html>`;

async function cimaAreaPagina(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (!t) continue;
      const b = t.view.getBounds();
      return { y: b.y, height: b.height };
    }
    return null;
  });
}

test('il cartello del microfono e la domanda della posizione non si coprono, e restano fuori dall\'area della pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const mic = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await mic, 'chi consente deve ottenere il microfono').toEqual(['audio:live']);
  await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 10_000 });

  // Ora un gesto dell'utente su un'altra cosa: «trovami».
  page.evaluate(() => window.__trovami()).catch(() => {});
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.waitForTimeout(600);

  const cartello = await shell.locator('.perm-live').first().boundingBox();
  const domanda = await shell.locator('.perm-chip').first().boundingBox();
  const area = await cimaAreaPagina(app);
  console.log('[586 g8] cartello:', JSON.stringify(cartello), 'domanda:', JSON.stringify(domanda),
    'area pagina:', JSON.stringify(area));
  console.log('[586 g8] testi:', JSON.stringify(await shell.locator('.perm-live, .perm-chip').allTextContents()));

  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const img = await w.capturePage();
    return img.toPNG().toString('base64');
  });
  mkdirSync('tests/.shots', { recursive: true });
  writeFileSync('tests/.shots/586-giro8-cartello-e-domanda.png', Buffer.from(png, 'base64'));

  expect(cartello, 'il cartello del microfono è sparito quando è arrivata la domanda').toBeTruthy();
  expect(domanda, 'la domanda della posizione non è comparsa').toBeTruthy();

  const sovrapposti = !(domanda.y >= cartello.y + cartello.height - 1
    || cartello.y >= domanda.y + domanda.height - 1);
  expect(
    sovrapposti,
    'il cartello «può usare il microfono» e la domanda della posizione si coprono a vicenda: '
    + 'chi naviga vede una riga sola e l\'altra la perde',
  ).toBe(false);

  const fondo = Math.max(cartello.y + cartello.height, domanda.y + domanda.height);
  expect(
    fondo,
    `con due righe in cima l'insieme arriva a y ${fondo}, dentro l'area della pagina che parte a `
    + `y ${area && area.y}: la view nativa la compone sopra la cornice di Filo e chi naviga non la `
    + 'vede né può premerci sopra',
  ).toBeLessThanOrEqual(area.y);
});

test('dopo l\'«Interrompi» il sito riapre il microfono: se lo riprende, il cartello deve tornare', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const mic = page.evaluate(() => window.__microfono());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  expect(await mic).toEqual(['audio:live']);
  await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 10_000 });

  await shell.locator('.perm-live .perm-chip-btn').filter({ hasText: 'Interrompi' }).first().click();
  await expect(shell.locator('.perm-live')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(800);

  // Il sito riprova subito: il permesso è ancora consentito, quindi nessuna
  // domanda. Quello che conta è che il cartello torni.
  const secondo = await page.evaluate(() => window.__microfono());
  await shell.waitForTimeout(1500);
  const cartelli = await shell.locator('.perm-live').allTextContents();
  const domande = await shell.locator('.perm-chip').count();
  console.log('[586 g8] il sito dopo l\'Interrompi:', JSON.stringify(secondo),
    'cartelli:', JSON.stringify(cartelli), 'domande:', domande);

  if (Array.isArray(secondo) && secondo.includes('audio:live')) {
    expect(
      cartelli.length,
      'premuto «Interrompi», il sito ha riaperto il microfono un attimo dopo senza che comparisse '
      + 'niente, e questa volta nessun cartello lo dice: sta ascoltando e non c\'è più nessun segno '
      + 'né nessun posto da cui fermarlo',
    ).toBeGreaterThan(0);
  }
});
