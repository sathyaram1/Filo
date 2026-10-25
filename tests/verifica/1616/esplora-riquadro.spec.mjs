import { test } from '../../fixtures/electron.mjs';
test('esplora riquadro', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>R</title><p>ok</p><iframe id=s srcdoc="<p>x</p>"></iframe>');
  const r = await page.evaluate(async () => {
    const f = document.createElement('iframe'); document.body.appendChild(f);
    const subito = f.contentWindow.Function.prototype.toString.call(navigator.credentials.get).slice(0, 40);
    await new Promise((r) => setTimeout(r, 500));
    const s = document.getElementById('s').contentWindow;
    return { subito, dopo: f.contentWindow.Function.prototype.toString.call(navigator.credentials.get).slice(0, 40), chromeDopo: !!(f.contentWindow.chrome && f.contentWindow.chrome.runtime),
      srcdoc: s.Function.prototype.toString.call(navigator.credentials.get).slice(0, 40), srcdocChrome: !!(s.chrome && s.chrome.runtime), filoSrc: typeof s.__filoProva };
  });
  console.log('RIQ', JSON.stringify(r));
});
