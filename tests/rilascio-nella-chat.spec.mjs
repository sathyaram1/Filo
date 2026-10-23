// #1623 — Un'immagine lasciata in un punto di Filo che non la vuole entra nella chat come allegato, uguale all'incolla:
// nella home la chat della home, su un sito l'Aiuto della pagina. Dove la pagina accoglie il rilascio vince lei.
// Il rilascio sui siti è quello vero del sistema, via DevTools: la pagina non lo fabbrica. Regole nel pattern.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from './helpers/percorsi.mjs';
import { nelMondoDiFilo } from './helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function immaginiSulDisco(n = 1, nome = (i) => `foto ${i + 1}.png`) {
  const dir = cartellaInCasa('filo-test-rilascio-');
  return Array.from({ length: n }, (_, i) => {
    const p = join(dir, nome(i));
    writeFileSync(p, PNG);
    return p;
  });
}

// Trascinamento e rilascio veri, dal sistema, sul punto (x, y) della pagina.
async function lascia(page, files, { x = 200, y = 200 } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: globalThis.__filoSidebarTest?.allegati?.() || [],
  fuoco: document.activeElement === document.querySelector('.sn-sidebar-input textarea'),
}));

const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che i file non li vuole.</p></body></html>';

test('su un sito che il rilascio non lo gestisce, l’immagine entra nell’Aiuto già allegata e col fuoco nella casella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 })
    .toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }], fuoco: true });
});

test('su un sito che il rilascio lo gestisce (preventDefault), il file va alla pagina e l’Aiuto non si apre', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div id="zona" style="position:fixed;inset:0">Carica qui</div>
    <script>
      window.ricevuti = [];
      zona.addEventListener('dragover', (e) => e.preventDefault());
      zona.addEventListener('drop', (e) => { e.preventDefault(); window.ricevuti.push(...[...e.dataTransfer.files].map((f) => f.name)); });
    </script></body></html>`);
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto]);
  await expect.poll(() => page.evaluate(() => window.ricevuti), { timeout: 8_000 }).toEqual(['foto 1.png']);
  await page.waitForTimeout(400);
  expect(await statoAiuto(app, page)).toMatchObject({ aperto: false, allegati: [] });
});
