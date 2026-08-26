// VERIFICA #444 round 3 — costo di apertura del menu. Da cancellare.
import { test, expect } from './fixtures/electron.mjs';

async function timeMenu(page, x, y, giri = 6) {
  const ms = [];
  for (let i = 0; i < giri; i++) {
    await page.evaluate(() => { window.__t0 = 0; });
    const t0 = Date.now();
    await page.mouse.move(x, y);
    await page.mouse.click(x, y, { button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    ms.push(Date.now() - t0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.floor(ms.length / 2)];
}

// Pagina semplice: un paragrafo.
const semplice = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <p id="p" style="width:600px">Un paragrafo qualunque su cui aprire il menu.</p>
</body></html>`;

// Pagina pesante ma REALISTICA: un feed con 200 schede a strati (link sotto,
// copertina, anteprima, velo), e il punto cliccato è dentro una pila profonda.
const feed = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div id="app"></div>
  <script>
    const app = document.getElementById('app');
    let html = '';
    for (let i = 0; i < 200; i++) {
      html += '<div class="w1"><div class="w2"><div class="w3"><div class="w4"><div class="w5">'
        + '<div class="card" style="position:relative;width:320px;height:220px;margin:6px">'
        + '<a href="https://example.com/s' + i + '" style="position:absolute;inset:0;z-index:1;text-decoration:none;color:#000"><span style="position:absolute;bottom:2px;left:2px">Scheda ' + i + '</span></a>'
        + '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:2;background:#456">'
        + '<video src="/c.mp4" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:3;background:#333"></video>'
        + '<span style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:4;background:rgba(0,0,0,.02)"></span>'
        + '</div></div></div></div></div></div>';
    }
    app.innerHTML = html;
  </script>
</body></html>`;

// Pila patologica: 120 veli trasparenti a tutta pagina uno sopra l'altro, come
// certi siti che impilano wrapper, overlay di consenso e portali.
const pila = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div style="position:relative;width:320px;height:200px;margin:40px">
    <a href="https://example.com/x" style="position:absolute;inset:0;z-index:1">t</a>
    <video src="/c.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
  </div>
  <script>
    for (let i = 0; i < 120; i++) {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:' + (10 + i);
      d.textContent = '';
      document.body.appendChild(d);
    }
  </script>
</body></html>`;

test('E1 — costo apertura: pagina semplice', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, semplice);
  const t = await timeMenu(page, 200, 50);
  console.log('E1 mediana semplice (ms):', t);
});

test('E2 — costo apertura: feed di 200 schede a strati', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, feed);
  await page.waitForTimeout(500);
  const t = await timeMenu(page, 160, 90);
  console.log('E2 mediana feed 200 schede (ms):', t);
});

test('E3 — costo apertura: 120 veli a tutta pagina impilati', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pila);
  await page.waitForTimeout(300);
  const t = await timeMenu(page, 200, 140);
  console.log('E3 mediana 120 veli (ms):', t);
  const labels = await page.locator('.sn-menu button').allInnerTexts().catch(() => []);
  console.log('E3 labels:', JSON.stringify(labels));
});

test('E4 — misura diretta di detectContext dentro la pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, feed);
  await page.waitForTimeout(500);
  const res = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 160, clientY: 90 });
      document.elementFromPoint(160, 90).dispatchEvent(ev);
      out.push(performance.now() - t0);
      document.querySelector('.sn-menu')?.remove();
      await new Promise((r) => setTimeout(r, 30));
    }
    return out;
  });
  console.log('E4 dispatch sincrono (ms):', JSON.stringify(res.map((n) => Math.round(n))));
});
