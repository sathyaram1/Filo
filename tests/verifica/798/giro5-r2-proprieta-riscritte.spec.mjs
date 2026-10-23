// Verifica #798 giro 5, r2: la guardia legge dimensioni del canvas, dell'immagine e canali dell'audio da proprietà che
// la pagina può riscrivere per un istante: riscritte, le letture escono senza rumore anche dalla pagina principale.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function letture() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const disegna = () => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 40;
    const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
    return [c, x];
  };
  const out = {};
  {
    const [c, x] = disegna();
    out.toDataURL = fnv(c.toDataURL());
    out.getImageData = fnv(Array.from(x.getImageData(0, 0, 80, 40).data).join(','));
  }
  {
    const [c] = disegna();
    Object.defineProperty(c, 'width', { value: 0, configurable: true });
    out.toDataURLLarghezzaFinta = fnv(c.toDataURL());
  }
  {
    const [, x] = disegna();
    const P = ImageData.prototype, d = Object.getOwnPropertyDescriptor(P, 'width');
    Object.defineProperty(P, 'width', { get() { return 0; }, configurable: true });
    const img = x.getImageData(0, 0, 80, 40);
    Object.defineProperty(P, 'width', d);
    out.getImageDataLarghezzaFinta = fnv(Array.from(img.data).join(','));
  }
  const audio = async (trucco) => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1000; o.connect(ctx.destination); o.start(0);
    const P = AudioBuffer.prototype, d = Object.getOwnPropertyDescriptor(P, 'numberOfChannels');
    if (trucco) Object.defineProperty(P, 'numberOfChannels', { get() { return 0; }, configurable: true });
    const buf = await ctx.startRendering();
    if (trucco) Object.defineProperty(P, 'numberOfChannels', d);
    const dd = buf.getChannelData(0); let s = 0; for (let i = 0; i < dd.length; i++) s += Math.abs(dd[i]) * (i % 7 + 1);
    return s.toPrecision(17);
  };
  out.audio = await audio(false);
  out.audioCanaliFinti = await audio(true);
  return out;
}

test('r2 riscrivere per un istante dimensioni o canali non toglie il rumore', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<!doctype html><meta charset="utf-8"><body><p>ok</p></body>');
  let page = await openTab(url);
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const on = await page.evaluate(letture);
  await setFpMode(openTab, 'off');
  page = await openTab(url + '?off');
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const off = await page.evaluate(letture);
  expect(on.toDataURL).not.toBe(off.toDataURL);
  expect(on.audio).not.toBe(off.audio);
  expect.soft(on.toDataURLLarghezzaFinta, 'toDataURL con la larghezza riscritta: col rumore').toBe(on.toDataURL);
  expect.soft(on.getImageDataLarghezzaFinta, 'getImageData con la larghezza dell\'immagine riscritta: col rumore').toBe(on.getImageData);
  expect.soft(on.audioCanaliFinti, 'audio coi canali riscritti: col rumore').toBe(on.audio);
});
