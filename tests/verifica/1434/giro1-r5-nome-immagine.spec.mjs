// Verifica #1434 giro 1, rilievo 5: «Chiedi a Filo» su un'immagine scritta dentro la pagina (indirizzo data:) la
// allega con un nome da immagine, non con un pezzo dei suoi byte.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { neiRiquadri } from '../../helpers/riquadri.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px"><img id="foto" width="160" height="120" alt="foto"></body></html>`;

test('r5 l\'immagine data: allegata dalla fila ha un nome leggibile', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const src = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 160, 120);
    g.fillStyle = '#33c'; g.fillRect(40, 30, 60, 50);
    const u = c.toDataURL('image/png');
    document.getElementById('foto').src = u;
    return u;
  });
  await page.locator('#foto').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu-row [data-sn-icon-id="immagine:ask"]').click();
  let allegati = [];
  await expect.poll(async () => {
    allegati = await neiRiquadri(app, page, () => globalThis.__filoSidebarTest?.allegati?.() || []);
    return allegati.length;
  }, { timeout: 8000 }).toBe(1);
  const nome = allegati[0].nome;
  expect(nome.length, `nome: ${nome.slice(0, 80)}`).toBeLessThan(40);
  expect(nome && src.includes(nome), `nome preso dai byte: ${nome.slice(0, 80)}`).toBe(false);
});
