// Verifica #798 giro 5, esplorazione: porte nuove verso le copie native e porte dei giri passati.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const PAGINA = `<!doctype html><meta charset="utf-8"><body><p>ok</p>
<div id="ombra"><template shadowrootmode="open"><iframe></iframe></template></div>
<script>window.__ombra = (function(){ try { return window[window.length-1].HTMLCanvasElement.prototype.toDataURL; } catch (e) { return null; } })();</script>
</body>`;

async function porte({ svgUrl, xmlUrl, stessoUrl }) {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const out = { pagina: fnv(c.toDataURL()) };
  try { out.ombraParser = window.__ombra ? fnv(window.__ombra.call(c)) : 'nessuna'; } catch (e) { out.ombraParser = 'errore ' + e.message; }
  const conFrame = async (nome, prepara) => {
    const f = document.createElement('iframe'); prepara(f); document.body.appendChild(f); await carico(f);
    await new Promise((r) => setTimeout(r, 300));
    out[nome] = leggi(f.contentWindow);
  };
  const blob = (s, t) => URL.createObjectURL(new Blob([s], { type: t }));
  await conFrame('blobSvg', (f) => { f.src = blob('<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>', 'image/svg+xml'); });
  await conFrame('blobXml', (f) => { f.src = blob('<a/>', 'text/xml'); });
  await conFrame('svgStessoSito', (f) => { f.src = svgUrl; });
  await conFrame('xmlStessoSito', (f) => { f.src = xmlUrl; });
  await conFrame('sandboxStessoSito', (f) => { f.setAttribute('sandbox', 'allow-same-origin'); f.src = stessoUrl; });
  await conFrame('sandboxSrcdoc', (f) => { f.setAttribute('sandbox', 'allow-same-origin'); f.srcdoc = '<p>x</p>'; });
  await conFrame('blobHtml', (f) => { f.src = blob('<p>x</p>', 'text/html'); });
  // La pagina principale da sola: proprietà che la pagina può riscrivere.
  {
    const d = document.createElement('canvas'); d.width = 80; d.height = 40;
    const y = d.getContext('2d'); y.fillStyle = '#1e90ff'; y.fillRect(0, 0, 80, 40); y.fillStyle = '#000'; y.font = '16px sans-serif'; y.fillText('filo', 4, 24);
    Object.defineProperty(d, 'width', { value: 0, configurable: true });
    try { out.larghezzaFinta = fnv(d.toDataURL()); } catch (e) { out.larghezzaFinta = 'errore ' + e.message; }
  }
  {
    const P = ImageData.prototype, dd = Object.getOwnPropertyDescriptor(P, 'width');
    Object.defineProperty(P, 'width', { get() { return 0; }, configurable: true });
    const img = x.getImageData(0, 0, 80, 40);
    Object.defineProperty(P, 'width', dd);
    out.getImageDataFinto = fnv(Array.from(img.data).join(','));
    out.getImageDataVero = fnv(Array.from(x.getImageData(0, 0, 80, 40).data).join(','));
  }
  {
    const audio = async (trucco) => {
      const ctx = new OfflineAudioContext(1, 4410, 44100);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1000; o.connect(ctx.destination); o.start(0);
      const P = AudioBuffer.prototype, dd = Object.getOwnPropertyDescriptor(P, 'numberOfChannels');
      if (trucco) Object.defineProperty(P, 'numberOfChannels', { get() { return 0; }, configurable: true });
      const buf = await ctx.startRendering();
      if (trucco) Object.defineProperty(P, 'numberOfChannels', dd);
      const d = buf.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += Math.abs(d[i]) * (i % 7 + 1);
      return s.toPrecision(17);
    };
    out.audioVero = await audio(false);
    out.audioFinto = await audio(true);
  }
  return out;
}

test('esplora porte giro 5', async ({ openTab, testServer }) => {
  test.setTimeout(150_000);
  const svgUrl = testServer.asset('<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>', 'image/svg+xml');
  const xmlUrl = testServer.asset('<a/>', 'text/xml');
  const stessoUrl = testServer.html('<p>stesso</p>');
  const leggi = async () => {
    const page = await openTab(testServer.html(PAGINA));
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    return page.evaluate(porte, { svgUrl, xmlUrl, stessoUrl });
  };
  const on = await leggi();
  await setFpMode(openTab, 'off');
  const off = await leggi();
  console.log('ON', JSON.stringify(on, null, 1));
  console.log('OFF', JSON.stringify(off, null, 1));
});
