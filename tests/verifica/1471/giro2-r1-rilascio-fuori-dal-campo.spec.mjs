// Verifica #1471 dopo il riallineamento: un file lasciato nella home fuori dal campo entra nella chat (#1623), e il
// trascinamento va contato come posato nella chat della home, come quello lasciato sul campo.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const conto = (app) => app.evaluate(async () => {
  const C = globalThis.SN_CONTATORI;
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = C.giornoDi(Date.now());
  let n = 0;
  for (const [k, dati] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    const d = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: k, app: '0.0.0', os: 'linux', dati });
    for (const voce of String(d.trascinamento?.file_disco || '').split(';')) {
      const p = voce.split('|');
      if (p.slice(0, -1).join('|') === 'chat_home|posato') n += Number(p[p.length - 1]);
    }
  }
  return n;
});

test('r1 un file dal disco lasciato nella home fuori dal campo entra in chat e si conta come posato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  const foto = join(cartellaInCasa('filo-verifica-1471-'), 'foto.png');
  writeFileSync(foto, PNG);
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files: [foto], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 120, y: 120, data });
  await s.detach().catch(() => {});
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  await expect.poll(() => conto(app), { timeout: 8_000 }).toBe(1);
});
