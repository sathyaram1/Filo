// Verifica #586, giro 3 — SONDE (non sono guardie): altre porte da cui un sito
// può prendersi qualcosa, e cosa compare a chi naviga.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>prova</p>
<script>
  const descrivi = (s) => s.getTracks().map((t) => ({ kind: t.kind, label: t.label }));
  window.__display = (v) => navigator.mediaDevices.getDisplayMedia(v).then(
    (s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
    (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
  );
  window.__notifiche = () => Notification.requestPermission().then((v) => v, (e) => 'errore:' + e);
  window.__appunti = () => navigator.clipboard.readText().then(
    (t) => 'letto:' + String(t).slice(0, 20), (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__midi = () => navigator.requestMIDIAccess({ sysex: true }).then(
    () => 'concesso', (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
  window.__schermi = () => (window.getScreenDetails ? window.getScreenDetails().then(
    (d) => 'concesso:' + d.screens.length, (e) => 'rifiutato:' + ((e && e.name) || 'errore')) : Promise.resolve('assente'));
  window.__inattivita = () => (window.IdleDetector ? IdleDetector.requestPermission().then(
    (v) => 'stato:' + v, (e) => 'rifiutato:' + ((e && e.name) || 'errore')) : Promise.resolve('assente'));
  window.__cookieAltrove = () => (document.requestStorageAccess ? document.requestStorageAccess().then(
    () => 'concesso', (e) => 'rifiutato:' + ((e && e.name) || 'errore')) : Promise.resolve('assente'));
</script></body></html>`;

async function rispondi(shell, scelta) {
  const chip = shell.locator('.perm-chip');
  await shell.waitForTimeout(2200);
  const n = await chip.count();
  const testo = n ? (await chip.allTextContents())[0] : '(nessuna domanda)';
  if (n) await chip.first().locator(scelta === 'allow' ? '.perm-chip-allow' : '.perm-chip-x').click();
  return testo;
}

test('sonda: condividere UNA FINESTRA consegna anche l\'audio del computer', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const p = page.evaluate(() => window.__display({ video: true, audio: true })).catch((e) => 'esploso:' + e.message);
  const domanda = await rispondi(shell, 'allow');
  const box = shell.locator('.perm-source');
  await shell.waitForTimeout(1500);
  let voci = [];
  if (await box.count()) {
    voci = await box.first().locator('.perm-source-item').allTextContents();
    // Scegliamo l'ULTIMA voce: dove ci sono finestre, è una finestra sola.
    const items = box.first().locator('.perm-source-item');
    await items.nth((await items.count()) - 1).click();
  }
  const esito = await p;
  console.log('[586 g3] finestra+audio → domanda:', JSON.stringify(domanda),
    'voci:', JSON.stringify(voci), 'esito:', JSON.stringify(esito));
  expect(true).toBe(true);
});

test('sonda: notifiche e appunti, dal punto di vista della pagina', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const pn = page.evaluate(() => window.__notifiche()).catch((e) => 'esploso:' + e.message);
  const dn = await rispondi(shell, 'allow');
  const en = await pn;
  console.log('[586 g3] NOTIFICHE → domanda:', JSON.stringify(dn), 'esito:', JSON.stringify(en));
  const letturaDopo = await page.evaluate(() => Notification.permission).catch((e) => 'x:' + e.message);
  console.log('[586 g3] Notification.permission dopo il sì:', JSON.stringify(letturaDopo));

  const pa = page.evaluate(() => window.__appunti()).catch((e) => 'esploso:' + e.message);
  const da = await rispondi(shell, 'allow');
  const ea = await pa;
  console.log('[586 g3] APPUNTI → domanda:', JSON.stringify(da), 'esito:', JSON.stringify(ea));
  expect(true).toBe(true);
});

test('sonda: permessi meno noti (MIDI, schermi, inattività, cookie altrove)', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  for (const [nome, fn] of [
    ['MIDI', () => window.__midi()],
    ['SCHERMI', () => window.__schermi()],
    ['INATTIVITA', () => window.__inattivita()],
    ['COOKIE ALTROVE', () => window.__cookieAltrove()],
  ]) {
    const p = page.evaluate(fn).catch((e) => 'esploso:' + e.message);
    const domanda = await rispondi(shell, 'x');
    const esito = await p.catch((e) => 'esploso:' + e);
    console.log(`[586 g3] ${nome} → domanda:`, JSON.stringify(domanda), 'esito:', JSON.stringify(esito));
  }
  expect(true).toBe(true);
});
