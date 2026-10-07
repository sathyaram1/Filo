// Verifica #592.6 — giro 5 (riallineamento), rilievo 1: con una conferma aperta sopra la scheda, la striscia
// della barra laterale arrivata da main resta la vista che riceve il puntatore sul bordo sinistro.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';
import { barraPage, statoBarra } from '../../helpers/barra.mjs';

// Quale vista riceve il puntatore in un punto della finestra: la più in alto che lo contiene ed è visibile.
const chiPrende = (app, x, y) => app.evaluate(({ BrowserWindow }, { x, y }) => {
  const w = BrowserWindow.getAllWindows().find((v) => v._filoTabs && !v._filoIncognito);
  const tm = w._filoTabs;
  const f = w.contentView.children;
  for (let i = f.length - 1; i >= 0; i--) {
    const v = f[i];
    if (v.getVisible && !v.getVisible()) continue;
    const b = v.getBounds();
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      if (v === tm.barra.vista) return 'barra';
      if (v === tm.conferme.vista) return 'conferma';
      return 'altro';
    }
  }
  return 'nessuna';
}, { x, y });

test('r1 a conferma aperta, il bordo sinistro resta della barra laterale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<h1>pagina</h1>');
  const host = new URL(page.url()).hostname;
  await barraPage(app);
  const s = await statoBarra(app);
  const y = s.alto + 200;
  expect(await chiPrende(app, 1, y)).toBe('barra');
  await nelMondoDiFilo(app, host, `(() => { globalThis.__e = 'attesa'; SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Prova' }).then((ok) => { globalThis.__e = ok; }); return 1; })()`);
  await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 800));
  expect(await chiPrende(app, 1, y)).toBe('barra');
  expect(await nelMondoDiFilo(app, host, 'globalThis.__e')).toBe('attesa');
});
