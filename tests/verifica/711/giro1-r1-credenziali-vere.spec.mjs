// Verifica #711, giro 1, rilievo 1: credenziali firmate con gli strumenti ufficiali del C2PA.
// Le immagini accanto le ha firmate l'SDK di riferimento (c2pa-rs 0.91, certificato di prova),
// che le dichiara valide: sono il formato che scrivono i generatori veri.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const QUI = join(process.cwd(), 'tests', 'verifica', '711');
const file = (nome) => readFileSync(join(QUI, nome));

function pagina(src) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Pagina di prova</h1>
    <img id="foto" src="${src}" width="160" height="160">
  </body></html>`;
}

async function rigaDelMenu(testServer, openTab, byte, tipo) {
  const src = testServer.asset(byte, tipo);
  const page = await testServer.openReady(openTab, pagina(src));
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu.locator('.sn-menu-origine');
}

test('un JPEG generato con l’AI e firmato dagli strumenti ufficiali fa comparire la riga', async ({ openTab, testServer }) => {
  const riga = await rigaDelMenu(testServer, openTab, file('credenziali-vere-ai.jpg'), 'image/jpeg');
  await expect(riga).toBeVisible({ timeout: 10000 });
  await expect(riga).toContainText('Generata con l’AI');
});

test('un PNG generato con l’AI e firmato dagli strumenti ufficiali fa comparire la riga', async ({ openTab, testServer }) => {
  const riga = await rigaDelMenu(testServer, openTab, file('credenziali-vere-ai.png'), 'image/png');
  await expect(riga).toBeVisible({ timeout: 10000 });
  await expect(riga).toContainText('Generata con l’AI');
});

test('lo stesso JPEG cambiato dopo la firma lo dice', async ({ openTab, testServer }) => {
  const b = Buffer.from(file('credenziali-vere-ai.jpg'));
  b[b.length - 30] ^= 0x5a;
  const riga = await rigaDelMenu(testServer, openTab, b, 'image/jpeg');
  await expect(riga).toBeVisible({ timeout: 10000 });
  await expect(riga).toContainText('cambiato dopo la firma');
});
