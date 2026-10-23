// Verifica #1623, giro 1: le immagini lasciate su un sito che non le vuole devono arrivare all'Aiuto.
// r1 sopra una casella di testo, r2 oltre i 4 MB, r4 un file non immagine lasciato insieme non sparisce in silenzio.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_GRANDE = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024 + 1024)]);

function suDisco(nomi, byte = PNG) {
  const dir = cartellaInCasa('filo-verifica-1623-');
  return nomi.map((n) => { const p = join(dir, n); writeFileSync(p, byte); return p; });
}

async function lascia(page, files, { x = 200, y = 200 } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: (globalThis.__filoSidebarTest?.allegati?.() || []).map((a) => a.nome),
}));

const SITO = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">un sito</body></html>';

test('r1 sito con una casella di ricerca: l’immagine lasciata sopra la casella entra nell’Aiuto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><input id="q" type="search" placeholder="Cerca" style="position:fixed;left:50px;top:50px;width:500px;height:60px"></body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 200, y: 80 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
});

test('r2 sito: un’immagine oltre i 4 MB entra nell’Aiuto, non solo un avviso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [grande] = suDisco(['grande.png'], PNG_GRANDE);
  await lascia(page, [grande]);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8_000 }).toBe(1);
});

test('r4 sito: un pdf lasciato insieme a un’immagine non sparisce senza dirlo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [foto] = suDisco(['foto.png']);
  const [pdf] = suDisco(['contratto.pdf'], Buffer.from('%PDF-1.4'));
  await lascia(page, [foto, pdf]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 5_000 }).toMatch(/\S/);
});
