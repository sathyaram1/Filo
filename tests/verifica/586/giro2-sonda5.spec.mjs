// Sonda 5 del giro 2 (#586): il giro completo dalle Impostazioni.
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>sito</p>
<button id="share" style="padding:14px">condividi</button>
<script>
  document.getElementById('share').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = (e && e.name) || 'errore'; });
  });
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    () => 'ok', (e) => 'no:' + ((e && e.name) || ''));
  window.__stato = async (n) => { try { return (await navigator.permissions.query({ name: n })).state; } catch (_) { return 'n/d'; } };
</script></body></html>`;

test('sonda5: consenti → Impostazioni → nega → togli', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  let p = page.evaluate(() => window.__cam());
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  // eslint-disable-next-line no-console
  console.log('[586-g5] fotocamera consentita:', await p);

  const sec = await openTab('filo://security');
  await sec.waitForTimeout(1500);
  const righe = await sec.evaluate(() => {
    const ul = document.getElementById('perms-list');
    return ul ? [...ul.children].map((li) => li.textContent) : null;
  });
  // eslint-disable-next-line no-console
  console.log('[586-g5] elenco in Impostazioni:', JSON.stringify(righe));

  // ribalta a "negato"
  await sec.evaluate(() => {
    const li = document.getElementById('perms-list').querySelector('li');
    li.querySelectorAll('button')[0].click();
  });
  await sec.waitForTimeout(1200);
  // eslint-disable-next-line no-console
  console.log('[586-g5] dopo il ribaltamento:', JSON.stringify(await sec.evaluate(() => {
    const ul = document.getElementById('perms-list');
    return [...ul.children].map((li) => li.textContent);
  })));

  // la pagina deve leggersi "negata" SUBITO, senza ricaricare, e non ottenere niente
  await page.waitForTimeout(800);
  // eslint-disable-next-line no-console
  console.log('[586-g5] stato letto dal sito dopo la negazione:', await page.evaluate(() => window.__stato('camera')));
  p = page.evaluate(() => window.__cam());
  await page.waitForTimeout(2000);
  // eslint-disable-next-line no-console
  console.log('[586-g5] richiesta dopo la negazione:', await p, '| pastiglie:', await chip.count());

  // togli la voce: la volta dopo deve richiedere
  await sec.evaluate(() => {
    const li = document.getElementById('perms-list').querySelector('li');
    const b = li.querySelectorAll('button');
    b[b.length - 1].click();
  });
  await sec.waitForTimeout(1200);
  // eslint-disable-next-line no-console
  console.log('[586-g5] stato letto dal sito dopo la rimozione:', await page.evaluate(() => window.__stato('camera')));
  p = page.evaluate(() => window.__cam());
  await page.waitForTimeout(2500);
  // eslint-disable-next-line no-console
  console.log('[586-g5] pastiglie dopo la rimozione:', await chip.count(), JSON.stringify(await chip.allTextContents()));
  if (await chip.count()) await chip.first().locator('.perm-chip-x').click();
  await p;
  expect(true).toBe(true);
});

test('sonda5: fotografia del riquadro «cosa condividi»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');
  await page.click('#share');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  await expect(shell.locator('.perm-source')).toHaveCount(1, { timeout: 15_000 });
  await shell.waitForTimeout(600);
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return (await w.capturePage()).toPNG().toString('base64');
  });
  mkdirSync('tests/.shots', { recursive: true });
  writeFileSync('tests/.shots/586-giro2-scelta-fonte.png', Buffer.from(png, 'base64'));
  // eslint-disable-next-line no-console
  console.log('[586-g5] nomi delle fonti:', JSON.stringify(await shell.locator('.perm-source-item').allTextContents()));
  expect(true).toBe(true);
});
