// #589.11 giro 4: esplorazione (si cancella prima della critica).
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}
async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const coperto = (p) => p.locator('.sn-toast', { hasText: 'Il menu era coperto' });

test('A pagina normale: incolla al primo colpo, tre volte', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:40px">
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  for (let i = 0; i < 3; i++) {
    await page.locator('#campo').fill('');
    await page.locator('#campo').click({ button: 'right' });
    await page.waitForTimeout(250);
    await page.locator('.sn-menu-paste-main').click();
    await expect(page.locator('#campo')).toHaveValue(SEGRETO);
  }
  await expect(coperto(page)).toHaveCount(0);
});

test('B html zoom 2: velo solo sul menu', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html style="zoom:2"><body style="padding:20px;margin:0">
    <input id="campo" style="width:200px;font-size:16px">
    <script>
      new MutationObserver((ms, mo) => {
        const m = document.querySelector('.sn-menu');
        if (!m) return; mo.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const r = m.getBoundingClientRect();
          const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
          const v = document.createElement('div'); v.id = 'velo';
          v.style.cssText = 'position:fixed;background:#fff;pointer-events:none;z-index:2147483647;left:' + (r.left / z) + 'px;top:' + (r.top / z) + 'px;width:' + (r.width / z) + 'px;height:' + (r.height / z) + 'px';
          document.body.appendChild(v);
          window.__r = [r.left, r.top, r.width, r.height, z];
        }));
      }).observe(document.documentElement, { childList: true, subtree: true });
    </script></body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toHaveCount(1);
  await page.waitForTimeout(900);
  console.log('rect', JSON.stringify(await page.evaluate(() => window.__r)));
  await page.screenshot({ path: 'tests/.shots/589-11-g4-zoom.png' });
  const inc = await centro(page.locator('.sn-menu-paste-main'));
  console.log('incolla', JSON.stringify(inc));
  await page.mouse.move(inc.x, inc.y, { steps: 3 });
  await page.mouse.click(inc.x, inc.y);
  await page.waitForTimeout(600);
  console.log('B campo:', await page.locator('#campo').inputValue(), 'avviso:', await coperto(page).count());
});

test('C riquadro manda la richiesta senza menu: la pagina perde opacita e scala', async ({ openTab, testServer }) => {
  const riquadro = testServer.html(`<!doctype html><html><body>annuncio
    <script>setInterval(() => parent.postMessage({ __snVistoSospendi: 1 }, '*'), 500);</script></body></html>`, { pubblico: true });
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:20px">
    <div id="nascosto" style="opacity:0;transform:scale(0.2)"><iframe src="${riquadro}" style="width:300px;height:200px"></iframe></div>
    </body></html>`);
  await page.waitForTimeout(2500);
  console.log('C stile:', await page.locator('#nascosto').evaluate((e) => getComputedStyle(e).opacity + ' ' + getComputedStyle(e).transform));
});

test('D dialog modale: incolla nel campo del dialogo', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:40px">
    <dialog id="d"><input id="campo" style="width:300px;font-size:16px"></dialog>
    <script>document.getElementById('d').showModal();</script></body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toHaveCount(1);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/589-11-g4-dialog.png' });
  const inc = await centro(page.locator('.sn-menu-paste-main'));
  await page.mouse.click(inc.x, inc.y);
  await page.waitForTimeout(600);
  console.log('D campo:', await page.locator('#campo').inputValue(), 'avviso:', await coperto(page).count());
});

test('E riquadro in contenitore scalato: incolla e posizione', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:10px">
    <input id="campo" style="width:240px;font-size:16px"></body></html>`, { pubblico: true });
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:20px">
    <div id="scheda" style="transform:scale(0.75);transform-origin:0 0"><iframe src="${riquadro}" style="width:600px;height:420px;border:0"></iframe></div>
    </body></html>`);
  const delRiquadro = () => page.frames().find((f) => f.url().includes('sito-pubblico.test'));
  await expect.poll(() => !!delRiquadro()).toBe(true);
  const frame = delRiquadro();
  await frame.waitForSelector('#campo');
  const ifr = page.locator('iframe');
  const prima = await ifr.boundingBox();
  await frame.locator('#campo').click({ button: 'right' });
  await expect(frame.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(300);
  const dopo = await ifr.boundingBox();
  console.log('E iframe prima', JSON.stringify(prima), 'dopo', JSON.stringify(dopo));
  await page.screenshot({ path: 'tests/.shots/589-11-g4-scalato.png' });
  await frame.locator('.sn-menu-paste-main').click();
  await page.waitForTimeout(500);
  console.log('E campo:', await frame.locator('#campo').inputValue(), 'avviso:', await frame.locator('.sn-toast', { hasText: 'Il menu era coperto' }).count());
});

test('F schermo intero: incolla nel campo dentro l\'elemento a schermo intero', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:40px">
    <div id="player" style="background:#222;width:400px;height:300px"><button id="fs">fs</button>
    <input id="campo" style="width:300px;font-size:16px"></div>
    <script>document.getElementById('fs').onclick = () => document.getElementById('player').requestFullscreen();</script>
    </body></html>`);
  await page.locator('#fs').click();
  await page.waitForTimeout(1200);
  console.log('F fullscreen:', await page.evaluate(() => !!document.fullscreenElement));
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toHaveCount(1);
  await page.waitForTimeout(400);
  const inc = await centro(page.locator('.sn-menu-paste-main'));
  await page.mouse.click(inc.x, inc.y);
  await page.waitForTimeout(600);
  console.log('F campo:', await page.locator('#campo').inputValue(), 'avviso:', await coperto(page).count());
  await page.screenshot({ path: 'tests/.shots/589-11-g4-fs.png' });
});
