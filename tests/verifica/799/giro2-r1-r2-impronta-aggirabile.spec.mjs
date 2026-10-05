// Verifica #799 giro 2: stessa pagina con la protezione (Automatico) e senza (Off).
// r1: uno script scritto apposta legge l'immagine vera; r2: la guardia si vede nelle tracce d'errore.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function onOff(openTab, testServer, probe, arg) {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const on = await page.evaluate(probe, arg);
  await setFpMode(openTab, 'off');
  await page.goto(testServer.html('<title>FP_OFF</title><p>ok</p>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  expect(await page.evaluate(() => !!window.__filoFpGuard)).toBe(false);
  const off = await page.evaluate(probe, arg);
  return { page, on, off };
}

// Decodifica nella pagina Off; `lato` ritaglia l'angolo in alto a sinistra (un canvas enorme non si trasporta intero).
async function decodifica(page, urls, lato) {
  return page.evaluate(async ([list, lato]) => {
    const out = [];
    for (const u of list) {
      const img = new Image(); img.src = u; await img.decode();
      const c = document.createElement('canvas');
      c.width = lato || img.naturalWidth; c.height = lato || img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      out.push(Array.from(x.getImageData(0, 0, c.width, c.height).data));
    }
    return out;
  }, [urls, lato]);
}

function diversi(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  return n;
}

function strisce(x, W, H) {
  for (let i = 0; i < 6; i++) {
    x.fillStyle = `rgb(${40 * i},${200 - 30 * i},${90 + 20 * i})`;
    x.fillRect(Math.floor(i * W / 6), 0, Math.ceil(W / 6), H);
  }
}

test('r1 pixel riletti e riscritti sul canvas: la lettura successiva e l\'immagine esportata hanno ancora il rumore', async ({ openTab, testServer }) => {
  const W = 64, H = 32;
  const probe = new Function('arg', `const { W, H } = arg; const strisce = ${strisce.toString()};
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    strisce(x, W, H);
    x.putImageData(x.getImageData(0, 0, W, H), 0, 0);
    return { url: c.toDataURL(), px: Array.from(x.getImageData(0, 0, W, H).data) };`);
  const { page, on, off } = await onOff(openTab, testServer, probe, { W, H });
  expect(diversi(on.px, off.px)).toBeGreaterThan(0);
  const [imgOn, imgOff] = await decodifica(page, [on.url, off.url]);
  expect(diversi(imgOn, imgOff)).toBeGreaterThan(0);
});

test('r1 canvas grande (3000x2700) esportato: esce col rumore come uno piccolo', async ({ openTab, testServer }) => {
  const probe = new Function(`const c = document.createElement('canvas'); c.width = 3000; c.height = 2700;
    const x = c.getContext('2d'); x.fillStyle = 'rgb(120,60,200)'; x.fillRect(0, 0, 40, 40);
    return c.toDataURL();`);
  const { page, on, off } = await onOff(openTab, testServer, probe);
  const [imgOn, imgOff] = await decodifica(page, [on, off], 40);
  expect(diversi(imgOn, imgOff)).toBeGreaterThan(0);
});

test('r2 un errore lanciato da una funzione sostituita ha la stessa traccia che senza protezione', async ({ openTab, testServer }) => {
  const probe = new Function(`const out = {};
    const prova = (k, f) => { try { f(); out[k] = 'nessun errore'; } catch (e) {
      out[k] = String(e.stack).split('\\n').map((r) => r.replace(/\\(.*\\)$/, '').trim()); } };
    prova('toDataURL', () => HTMLCanvasElement.prototype.toDataURL.call({}));
    prova('getImageData', () => document.createElement('canvas').getContext('2d').getImageData(0, 0, 0, 0));
    prova('getContext', () => HTMLCanvasElement.prototype.getContext.call({}, '2d'));
    return out;`);
  const { on, off } = await onOff(openTab, testServer, probe);
  expect(on).toEqual(off);
});
