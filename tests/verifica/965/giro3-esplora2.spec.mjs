// Esplorazione del giro 3 di #965: scaricamenti nati nella pagina e pagine molto grandi.
import { test, expect } from '../../fixtures/electron.mjs';
import { copertura } from '../../helpers/avvisoSito.mjs';

const fuoco = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  win.focus();
  win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.focus();
});

const contaScaricamenti = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__scaricamenti = [];
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const ses = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.session;
  ses.on('will-download', (e, item) => { globalThis.__scaricamenti.push({ nome: item.getFilename(), url: item.getURL().slice(0, 40), fermato: e.defaultPrevented }); });
});
const scaricamenti = (app) => app.evaluate(() => globalThis.__scaricamenti);

async function clic(app, sel) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId).view.webContents;
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s)});
      el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: 'left', clickCount: 1 };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, sel);
}

test('allegato travestito che la pagina costruisce da sé (blob, come le chat e la posta cifrata): avviso prima che scenda', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<title>Chat</title><button id="scarica">fattura.pdf.exe</button><script>'
    + 'document.getElementById("scarica").onclick = function () { var b = new Blob(["MZ00"], { type: "application/octet-stream" });'
    + ' var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "fattura.pdf.exe"; document.body.appendChild(a); a.click(); };'
    + '</script>');
  await fuoco(app);
  await contaScaricamenti(app);
  await clic(app, '#scarica');
  await expect.poll(() => scaricamenti(app), { timeout: 8000 }).not.toEqual([]);
  console.log('SCARICAMENTI', JSON.stringify(await scaricamenti(app)));
  expect((await copertura(app)).coperta).toBe(true);
});

test('pagina con 60.000 link: la pagina resta reattiva mentre scorre', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const N = 60000;
  const righe = [];
  for (let i = 0; i < N; i++) righe.push(`<a href="https://r-${i}.esempio-${i % 997}.com/p/${i}">risultato ${i}</a><br>`);
  const pagina = await testServer.openReady(openTab, '<title>Grande</title>' + righe.join(''), { timeout: 60_000 });
  await fuoco(app);
  const misura = await pagina.evaluate(async () => {
    let max = 0; let prima = performance.now(); let attivo = true;
    const giro = () => { const ora = performance.now(); max = Math.max(max, ora - prima); prima = ora; if (attivo) setTimeout(giro, 1); };
    setTimeout(giro, 1);
    const frame = [];
    let p = performance.now();
    await new Promise((ok) => {
      let n = 0;
      const f = () => { const o = performance.now(); frame.push(o - p); p = o; window.scrollBy(0, 400); if (++n < 300) requestAnimationFrame(f); else ok(); };
      requestAnimationFrame(f);
    });
    attivo = false;
    frame.sort((a, b) => a - b);
    return { buco: max, p95: frame[Math.floor(frame.length * 0.95)], maxFrame: frame[frame.length - 1] };
  });
  const esame = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { inCoda: t._sbLinkInCoda || 0 };
  });
  console.log('MISURA', JSON.stringify(misura), JSON.stringify(esame));
});
