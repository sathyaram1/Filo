// Verifica #1471, giro 3, rilievo 1: un'immagine che Filo porta comunque in una chat si conta posata, da ogni punto.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const foto = () => { const p = join(cartellaInCasa('filo-verifica-1471-'), 'foto.png'); writeFileSync(p, PNG); return p; };

async function lascia(page, files, { x = 200, y = 200 } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

// Per esito, i trascinamenti di file dal disco di oggi, su ogni destinazione.
const fileDalDisco = (app) => app.evaluate(async () => {
  const C = globalThis.SN_CONTATORI;
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = C.giornoDi(Date.now());
  const tot = { posato: 0, annullato: 0 };
  for (const [k, dati] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    const d = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: k, app: '0.0.0', os: 'linux', dati });
    const v = d.trascinamento && d.trascinamento.file_disco;
    if (!v) continue;
    for (const voce of v.split(';')) { const [, esito, n] = voce.split('|'); tot[esito] = (tot[esito] || 0) + Number(n); }
  }
  return tot;
});

const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che i file non li vuole.</p></body></html>';
const allegati = (app, page) => nelMondoDiFilo(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length);

test('r1 un’immagine lasciata sulla fila delle schede entra nella chat della home e si conta posata', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const casa = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await expect(casa.locator('#input')).toBeVisible({ timeout: 10_000 });
  const box = await shell.locator('.tab').first().boundingBox();
  await lascia(shell, [foto()], { x: box.x + box.width + 120, y: box.y + box.height / 2 });
  await expect(casa.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  await expect.poll(() => fileDalDisco(app), { timeout: 8_000 }).toEqual({ posato: 1, annullato: 0 });
});

test('r1 un’immagine lasciata su un sito entra nell’Aiuto e si conta posata', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, [foto()]);
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => fileDalDisco(app), { timeout: 8_000 }).toEqual({ posato: 1, annullato: 0 });
});

test('r1 un’immagine lasciata sulla casella dell’Aiuto viene allegata e si conta posata, non annullata', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, [foto()]);
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toBe(1);
  const prima = await fileDalDisco(app);
  const r = await nelMondoDiFilo(app, page, () => {
    const b = document.querySelector('.sn-sidebar-input textarea').getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  await lascia(page, [foto()], r);
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toBe(2);
  await expect.poll(() => fileDalDisco(app), { timeout: 8_000 }).toEqual({ posato: prima.posato + 1, annullato: prima.annullato });
});
