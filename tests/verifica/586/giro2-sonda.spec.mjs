// Sonda esplorativa del giro 2 (#586). Non asserisce: stampa.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<button id="legacy">schermo alla vecchia maniera</button>
<script>
  window.__legacy = () => navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(
    (s) => { const n = s.getTracks().length; try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'STREAM:' + n; },
    (e) => 'no:' + ((e && e.name) || 'errore'),
  );
  window.__legacyAudio = () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(
    (s) => 'STREAM:' + s.getTracks().length,
    (e) => 'no:' + ((e && e.name) || 'errore'),
  );
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => { const n = s.getVideoTracks().length; try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'STREAM:' + n; },
    (e) => 'no:' + ((e && e.name) || 'errore'),
  );
  window.__notif = () => Notification.requestPermission().then((r) => 'notif:' + r, (e) => 'notif-err');
  window.__clip = () => navigator.clipboard.readText().then((t) => 'clip:ok', (e) => 'clip:no:' + ((e && e.name) || ''));
  window.__geo = () => new Promise((res) => {
    navigator.geolocation.getCurrentPosition(() => res('geo:ok'), (e) => res('geo:no:' + e.code));
  });
  window.__stato = async (n) => { try { return (await navigator.permissions.query({ name: n })).state; } catch (_) { return 'n/d'; } };
</script>
</body></html>`;

test('sonda: la strada vecchia della cattura schermo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const origine = new URL(page.url()).origin;
  const chip = shell.locator('.perm-chip');

  const p = page.evaluate(() => window.__legacy());
  // aspetta un attimo per vedere se compare una pastiglia
  await page.waitForTimeout(2500);
  const quante = await chip.count();
  const testi = await chip.allTextContents();
  // eslint-disable-next-line no-console
  console.log('[586-g2] legacy desktop — pastiglie:', quante, JSON.stringify(testi));
  if (quante) {
    // se chiede, consentiamo per vedere cosa succede dopo
    // eslint-disable-next-line no-console
    console.log('[586-g2] chiede, non consento: chiudo con la ×');
    await chip.first().locator('.perm-chip-x').click().catch(() => {});
  }
  const esito = await p;
  // eslint-disable-next-line no-console
  console.log('[586-g2] legacy desktop — esito per la pagina:', esito);

  const ricordato = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  // eslint-disable-next-line no-console
  console.log('[586-g2] memoria dopo legacy:', JSON.stringify(ricordato[origine] || null));
  expect(true).toBe(true);
});

test('sonda: dopo il consenso il permesso arriva davvero', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  // fotocamera
  let p = page.evaluate(() => window.__cam());
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  // eslint-disable-next-line no-console
  console.log('[586-g2] fotocamera dopo Consenti:', await p);
  // eslint-disable-next-line no-console
  console.log('[586-g2] stato camera:', await page.evaluate(() => window.__stato('camera')));

  // seconda volta: niente domanda
  p = page.evaluate(() => window.__cam());
  await page.waitForTimeout(1500);
  // eslint-disable-next-line no-console
  console.log('[586-g2] seconda fotocamera:', await p, 'pastiglie:', await chip.count());

  // notifiche
  p = page.evaluate(() => window.__notif());
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  // eslint-disable-next-line no-console
  console.log('[586-g2] pastiglia notifiche:', JSON.stringify(await chip.allTextContents()));
  await chip.locator('.perm-chip-allow').click();
  // eslint-disable-next-line no-console
  console.log('[586-g2] notifiche dopo Consenti:', await p);

  // appunti
  p = page.evaluate(() => window.__clip());
  await page.waitForTimeout(2000);
  // eslint-disable-next-line no-console
  console.log('[586-g2] appunti — pastiglie:', await chip.count(), JSON.stringify(await chip.allTextContents()));
  if (await chip.count()) await chip.first().locator('.perm-chip-allow').click();
  // eslint-disable-next-line no-console
  console.log('[586-g2] appunti esito:', await p);

  // posizione
  p = page.evaluate(() => window.__geo());
  await page.waitForTimeout(2000);
  // eslint-disable-next-line no-console
  console.log('[586-g2] posizione — pastiglie:', await chip.count(), JSON.stringify(await chip.allTextContents()));
  if (await chip.count()) await chip.first().locator('.perm-chip-allow').click();
  // eslint-disable-next-line no-console
  console.log('[586-g2] posizione esito:', await p);
  expect(true).toBe(true);
});
