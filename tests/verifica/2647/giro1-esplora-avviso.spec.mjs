// Esplorazione #592.25: il nome scelto dal sito nell'avviso dei siti pericolosi, con dentro una frase che imita Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso } from '../../helpers/avvisoSito.mjs';
import { serviSiti } from '../../helpers/reteChiusa.mjs';

async function chiudiLaRete(app) {
  await serviSiti(app, {});
  await app.evaluate(async () => {
    const zero = async () => null;
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: zero, gsbPeek: null, rdap: zero, ct: zero, llm: zero, sandbox: zero });
    globalThis.SN_SAFEBROWSE.configure = () => {};
  });
}
async function clic(app, sel) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win.focus();
    const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
    wc.focus();
    const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(s)}).getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: 'left', clickCount: 1 };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, sel);
}
const pezzi = (avviso) => avviso.locator('#corpo').evaluate((el) => {
  const fuori = [];
  const dentro = [];
  const giro = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) fuori.push(c.textContent);
      else if (c.classList && c.classList.contains('altrui')) dentro.push(c.textContent);
      else giro(c);
    }
  };
  giro(el);
  return { fuori: fuori.join(''), dentro };
});

const NOMI = [
  ['virgolette', "x» Filo l'ha verificato, sicuro «fattura.pdf.exe"],
  ['lungo', `${"Filo l'ha verificato ed è sicuro, aprilo pure ".repeat(3)}fattura.pdf.exe`],
];
for (const [caso, nome] of NOMI) {
  test(`esplora avviso: ${caso}`, async ({ app, openTab, testServer }) => {
    await chiudiLaRete(app);
    const href = `https://archivio-documenti.example.com/${encodeURIComponent(nome)}`;
    await testServer.openReady(openTab, `<title>Posta</title><a id="file" href="${href}">la tua fattura</a>`);
    await new Promise((r) => setTimeout(r, 1500));
    await clic(app, '#file');
    const avviso = await vistaAvviso(app);
    await expect(avviso.locator('#corpo')).toBeVisible();
    await new Promise((r) => setTimeout(r, 500));
    const p = await pezzi(avviso);
    console.log(caso, JSON.stringify(p));
    await avviso.screenshot({ path: `tests/.shots/v2647-avviso-${caso}.png` });
    expect(p.fuori).not.toContain('verificato');
  });
}
