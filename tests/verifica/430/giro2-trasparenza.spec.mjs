// Verifica #430 giro 2 — esplorazione a finestra vera (FILO_TEST_VISIBLE=1): mentre si fotografa una scheda di
// dietro, sotto quella davanti, lo schermo non deve mostrarla. Si guarda lo schermo con scrot.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pagina, schede, idDi } from './giro2-carta.mjs';

function schermo(file) {
  execFileSync('scrot', ['-o', file]);
  return PNG.sync.read(readFileSync(file));
}

test('davanti una pagina senza sfondo: la scheda aperta dietro non si vede mentre la si fotografa', async ({ app, shell, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'solo a finestra vera');
  mkdirSync('tests/.shots', { recursive: true });
  const dietro = testServer.html(pagina('#d01010', 'Rossa'));
  const uA = testServer.html(`<!doctype html><title>Trasparente</title><style>html,body{background:transparent;margin:0;height:100%}</style>
<a id="vai" href="${dietro}" style="font:30px sans-serif;display:block;padding:20px">vai</a>`);
  const pA = await openTab(uA);
  await idDi(app, (t) => t.url === uA);
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  console.log('FINESTRA', JSON.stringify(b));
  await pA.click('#vai', { modifiers: ['Control'] });
  let visti = 0;
  let giri = 0;
  const fine = Date.now() + 5000;
  while (Date.now() < fine) {
    const img = schermo('tests/.shots/430-g2-schermo.png');
    const x = Math.min(img.width - 1, b.x + Math.round(b.width / 2));
    const y = Math.min(img.height - 1, b.y + Math.round(b.height * 0.7));
    const i = (y * img.width + x) * 4;
    const [r, g, bl] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    giri++;
    if (r > 180 && g < 90 && bl < 90) { visti++; execFileSync('cp', ['tests/.shots/430-g2-schermo.png', 'tests/.shots/430-g2-schermo-rosso.png']); }
  }
  const s = await schede(app);
  console.log('SCATTI', giri, 'ROSSI', visti, JSON.stringify(s.tutte.map((t) => [t.title, t.foto])));
  expect(visti).toBe(0);
});
