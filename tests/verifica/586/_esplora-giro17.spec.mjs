// Esplorazione del giro 17 (si cancella): posizione, appunti, richieste insieme, scheda in secondo piano, aspetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const riga = (shell) => shell.locator('#perm-bar .perm-row');

const PAGINA = `<!doctype html><html><head><title>Esplora</title></head><body><h1>Esplora</h1><input id="c">
<script>
  window.pos = () => new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('ok'), (e) => r('err:' + e.code), { timeout: 8000 }));
  window.leggi = () => navigator.clipboard.readText().then((t) => 'ok:' + t, (e) => 'err:' + e.name);
  window.notif = () => Notification.requestPermission();
  window.cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'ok'; }, (e) => 'err:' + e.name);
  window.stato = (n) => navigator.permissions.query({ name: n }).then((s) => s.state, (e) => 'err:' + e.name);
</script></body></html>`;

async function avvia(page, fn, k = '__e') {
  await page.evaluate(({ f, k }) => { window[k] = null; window[f]().then((r) => { window[k] = r; }); }, { f: fn, k });
}
const esito = (page, k = '__e') => page.evaluate((k) => window[k], k);
async function consenti(shell) {
  await expect(shell.locator('#perm-bar .perm-si').first()).toBeEnabled({ timeout: 5000 });
  await shell.locator('#perm-bar .perm-si').first().click();
}

test('posizione: chiede, nega, poi consentita dal menu non torna PERMISSION_DENIED', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  console.log('stato geo prima', await page.evaluate(() => window.stato('geolocation')));
  await avvia(page, 'pos');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  console.log('striscia geo', await riga(shell).innerText());
  await consenti(shell);
  await expect.poll(() => esito(page), { timeout: 15_000 }).not.toBeNull();
  console.log('esito geo dopo consenti', await esito(page));
  console.log('stato geo dopo', await page.evaluate(() => window.stato('geolocation')));
});

test('appunti: la pagina chiede di leggerli, dopo il sì li legge', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo-copiato-17'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click();
  await avvia(page, 'leggi');
  await sleep(1500);
  console.log('righe appunti', await riga(shell).count(), await esito(page));
  if (await riga(shell).count()) {
    console.log('striscia appunti', await riga(shell).innerText());
    await consenti(shell);
  }
  await expect.poll(() => esito(page), { timeout: 10_000 }).not.toBeNull();
  console.log('esito appunti', await esito(page));
  await page.locator('#c').click();
  await avvia(page, 'leggi');
  await expect.poll(() => esito(page), { timeout: 10_000 }).not.toBeNull();
  console.log('esito appunti 2', await esito(page));
});

test('due richieste insieme dalla stessa pagina', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await avvia(page, 'notif', '__a');
  await avvia(page, 'cam', '__b');
  await sleep(1500);
  console.log('righe insieme', await riga(shell).count(), await shell.locator('#perm-bar').innerText());
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await shell.emulateMedia({ colorScheme: tema });
    await sleep(400);
    await shell.screenshot({ path: join(SHOTS, `586-giro17-insieme-${tema}.png`), clip: { x: 0, y: 0, width: 1000, height: 160 } });
  }
  await consenti(shell);
  await sleep(1300);
  console.log('dopo primo sì', await riga(shell).count(), await esito(page, '__a'), await esito(page, '__b'));
  if (await riga(shell).count()) await consenti(shell);
  await expect.poll(async () => [await esito(page, '__a'), await esito(page, '__b')], { timeout: 10_000 }).not.toContain(null);
  console.log('esiti insieme', await esito(page, '__a'), await esito(page, '__b'));
});

test('scheda in secondo piano chiede: tornandoci la domanda c’è ed è sua', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const a = await testServer.openReady(openTab, PAGINA);
  const b = await openTab('filo://security/security.html');
  await sleep(800);
  await avvia(a, 'cam');
  await sleep(1200);
  console.log('righe con B davanti', await riga(shell).count(), await shell.locator('#perm-bar').isVisible().catch(() => 'x'));
  await shell.locator('.tab').first().click();
  await sleep(300);
  const tabs = await shell.locator('.tab').count();
  for (let i = 0; i < tabs; i++) {
    const t = shell.locator('.tab').nth(i);
    if ((await t.innerText()).includes('Esplora')) { await t.click(); break; }
  }
  await sleep(1200);
  console.log('righe con A davanti', await riga(shell).count());
  if (await riga(shell).count()) await consenti(shell);
  await expect.poll(() => esito(a), { timeout: 10_000 }).not.toBeNull();
  console.log('esito scheda dietro', await esito(a));
  void b;
});
