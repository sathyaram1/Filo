// Esplorazione #798 giro 3: un riquadro vuoto che la pagina poi porta su un indirizzo della stessa origine ha ancora Filo?
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const INNER = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, lungo abbastanza da poterlo selezionare.</p></body></html>`;

function esterno(modo, src) {
  const s = JSON.stringify(src);
  const corpi = {
    appendPoiSrc: `<script>const f=document.createElement('iframe');f.id='embed';f.width=600;f.height=300;document.body.appendChild(f);setTimeout(()=>{f.src=${s};},50);</script>`,
    htmlPoiSrc: `<iframe id="embed" width="600" height="300"></iframe><script>setTimeout(()=>{document.getElementById('embed').src=${s};},50);</script>`,
    srcPrima: `<script>const f=document.createElement('iframe');f.id='embed';f.width=600;f.height=300;f.src=${s};document.body.appendChild(f);</script>`,
  };
  return `<!doctype html><html><body style="margin:0;padding:12px;font:16px sans-serif"><p>fuori</p>${corpi[modo]}</body></html>`;
}

async function menuNelRiquadro(openTab, testServer, modo) {
  const inner = testServer.html(INNER);
  const page = await testServer.openReady(openTab, esterno(modo, inner));
  const fl = page.frameLocator('#embed');
  await expect(fl.locator('#inner-text')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(500);
  await fl.locator('#inner-text').click({ button: 'right' });
  try { await expect(fl.locator('.sn-menu')).toBeVisible({ timeout: 4_000 }); return true; } catch (_) { return false; }
}

for (const modo of ['srcPrima', 'appendPoiSrc', 'htmlPoiSrc']) {
  test(`esplora menu ${modo}`, async ({ openTab, testServer }) => {
    test.setTimeout(90_000);
    const on = await menuNelRiquadro(openTab, testServer, modo);
    await setFpMode(openTab, 'off');
    const off = await menuNelRiquadro(openTab, testServer, modo);
    console.log(`ESITO ${modo}: automatico=${on} off=${off}`);
  });
}
