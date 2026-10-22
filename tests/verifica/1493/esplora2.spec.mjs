import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const LUNGO = 'Un titolo lunghissimo di una pagina che non finisce mai e continua ancora e ancora con altre parole';
const pagina = (t) => `<!doctype html><html><head><title>${t}</title></head><body>x</body></html>`;
const larghezze = (shell) => shell.evaluate(() => ['W' + window.innerWidth + '/' + Math.round(document.querySelector('.tabs').getBoundingClientRect().width)].concat([...document.querySelectorAll('.tabs .tab')].map((el) => Math.round(el.getBoundingClientRect().width) + (el.classList.contains('active') ? '*' : '')));

test('scuro, finestra stretta con molte schede, poi larga con titoli corti e uno lungo', async ({ app, shell, openTab, testServer }) => {
  mkdirSync(SHOTS, { recursive: true });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(900, 700); });
  for (let i = 0; i < 8; i++) await openTab(testServer.html(pagina(`${i} ${LUNGO}`)));
  await shell.waitForTimeout(800);
  console.log('stretta', JSON.stringify(await larghezze(shell)));
  await shell.screenshot({ path: join(SHOTS, 'v1493-stretta-scuro.png'), clip: { x: 0, y: 0, width: 900, height: 60 } });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1920, 1000); });
  await shell.waitForTimeout(800);
  console.log('larga', JSON.stringify(await larghezze(shell)));
  await shell.screenshot({ path: join(SHOTS, 'v1493-larga-scuro.png'), clip: { x: 0, y: 0, width: 1920, height: 60 } });
  // titoli corti con attiva lunga: l'attiva stacca ma resta sotto il tetto
  for (let i = 0; i < 3; i++) await openTab(testServer.html(pagina(`Breve ${i}`)));
  await shell.waitForTimeout(800);
  console.log('miste', JSON.stringify(await larghezze(shell)));
  // hover sulla scheda lunga: carta di anteprima o suggerimento col titolo intero
  const box = await shell.locator('.tabs .tab').nth(2).boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await shell.waitForTimeout(1500);
  const finestre = app.windows().map((w) => w.url());
  console.log('finestre', JSON.stringify(finestre));
  for (const w of app.windows()) {
    if (/anteprima|tip/.test(w.url())) {
      const t = await w.evaluate(() => document.body.innerText).catch(() => '');
      console.log('testo', w.url(), JSON.stringify(t.slice(0, 300)));
    }
  }
});
