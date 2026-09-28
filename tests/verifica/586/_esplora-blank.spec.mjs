// Esplorazione (si cancella): il preload gira nei riquadri vuoti creati dalla pagina? quando?
import { test } from '../../fixtures/electron.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('riquadro vuoto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>B</title><script>
    window.subito = () => { const f = document.createElement('iframe'); document.body.appendChild(f); const w = window[window.length - 1]; return { sync: !!w.__filoPermessiPagina, url: w.location.href }; };
    window.dopo = () => new Promise((r) => { const f = document.createElement('iframe'); document.body.appendChild(f); setTimeout(() => { const w = window[window.length - 1]; r({ later: !!w.__filoPermessiPagina, sameGum: w.MediaDevices.prototype.getUserMedia === MediaDevices.prototype.getUserMedia, name: w.MediaDevices.prototype.getUserMedia.toString().slice(0, 60) }); }, 500); });
  </script>`);
  console.log('SUBITO', JSON.stringify(await page.evaluate(() => window.subito())));
  console.log('DOPO', JSON.stringify(await page.evaluate(() => window.dopo())));
  await sleep(200);
});
