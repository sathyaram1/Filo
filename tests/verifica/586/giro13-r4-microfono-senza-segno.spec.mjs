// Verifica #586 giro 13, rilievo 4: la scheda non dice cosa il sito sta usando o si è visto negare, e Sicurezza non dice che resta acceso.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Chiamata</title></head><body>
<script>
  window.mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { window.__s = s; return 'ok'; }, (e) => 'err:' + e.name);
  window.cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'ok'; }, (e) => 'err:' + e.name);
  window.vivo = () => (window.__s ? window.__s.getAudioTracks().map((t) => t.readyState).join(',') : 'nessuna');
</script></body></html>`;

async function micAperto(shell, page) {
  await page.evaluate(() => { window.__e = null; window.mic().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('ok');
  await sleep(500);
}

test('mentre un sito ascolta, la cornice lo dice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await micAperto(shell, page);
  expect(await page.evaluate(() => window.vivo())).toBe('live');
  const segni = await shell.evaluate(() => {
    const testi = [document.body.innerText];
    for (const el of document.querySelectorAll('[data-tip], [title], [aria-label]')) {
      testi.push(el.dataset.tip || '', el.getAttribute('title') || '', el.getAttribute('aria-label') || '');
    }
    return testi.join(' | ');
  });
  expect(segni, 'nessun segno del microfono aperto nella cornice').toMatch(/microfono/i);
});

test('togliere il microfono da Sicurezza lo chiude, o almeno dice che resta acceso', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await micAperto(shell, page);
  const sec = await openTab('filo://security/security.html');
  const rigaMic = sec.locator('.sn-perm-riga[data-tipo="microfono"]');
  await expect(rigaMic).toBeVisible({ timeout: 10_000 });
  await rigaMic.locator('.sn-perm-togli').click();
  await expect(rigaMic).toHaveCount(0, { timeout: 5_000 });
  await sleep(1500);
  const chiuso = (await page.evaluate(() => window.vivo())) !== 'live';
  const detto = /resta acces|finch[eé] non|ricaric/i.test(
    `${await shell.locator('#shell-notifs').innerText().catch(() => '')} ${await sec.locator('#sec-permessi').innerText()}`);
  expect(chiuso || detto, 'la scelta è sparita, il microfono è ancora aperto e nessuno lo dice').toBe(true);
});

test('quando un sito si vede negare la fotocamera, la cornice lo dice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.cam().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.locator('#perm-bar .perm-no').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('err:NotAllowedError');
  await page.evaluate(() => { window.__e = null; window.cam().then((r) => { window.__e = r; }); });
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('err:NotAllowedError');
  await sleep(500);
  const segni = await shell.evaluate(() => {
    const testi = [document.body.innerText];
    for (const el of document.querySelectorAll('[data-tip], [title], [aria-label]')) {
      testi.push(el.dataset.tip || '', el.getAttribute('title') || '', el.getAttribute('aria-label') || '');
    }
    return testi.join(' | ');
  });
  expect(segni, 'il sito dice «fotocamera bloccata» e la cornice non dice niente').toMatch(/fotocamera/i);
});
