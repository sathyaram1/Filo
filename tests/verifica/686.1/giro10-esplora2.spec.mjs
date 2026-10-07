// #686.1 giro 10, esplorazione: costo del puntatore che si muove su una pagina con molti riquadri.

import { test } from '../../fixtures/electron.mjs';

for (const n of [0, 20, 100]) {
  test(`esplora puntatore con ${n} riquadri`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <div id=g style="display:grid;grid-template-columns:repeat(40,30px)">${'<span style="height:30px;border:1px solid #ccc"></span>'.repeat(400)}</div>
      <div id=r></div>
      <script>
        for (let i = 0; i < ${n}; i++) {
          const f = document.createElement('iframe'); f.style.cssText = 'width:20px;height:20px;border:0';
          document.getElementById('r').appendChild(f);
          const d = f.contentDocument; d.open(); d.write('<body>annuncio ' + i + '</body>'); d.close();
        }
        window.ritardi = [];
        window.addEventListener('pointerover', (e) => { window.ritardi.push(performance.now() - e.timeStamp); });
      </script></body></html>`);
    await page.waitForTimeout(800);
    for (let i = 0; i < 120; i++) await page.mouse.move(5 + (i % 40) * 30, 5 + Math.floor(i / 40) * 30);
    const r = await page.evaluate(() => {
      const a = window.ritardi.slice().sort((x, y) => x - y);
      return { n: a.length, med: a[Math.floor(a.length / 2)], max: a[a.length - 1], p95: a[Math.floor(a.length * 0.95)] };
    });
    console.log(n, JSON.stringify(r));
  });
}
