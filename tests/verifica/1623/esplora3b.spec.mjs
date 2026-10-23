// Esplorazione del giro 3 di #1623: si cancella prima della consegna.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function foto() { const dir = cartellaInCasa('filo-test-esplora-'); const p = join(dir, 'f.png'); writeFileSync(p, PNG); return [p]; }
async function lascia(page, files, { x = 200, y = 200, fasi }) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
test('C2 home: eventi a dragCancel, e uscita verso la fila delle schede', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('#input')).toBeVisible();
  await page.evaluate(() => { window.__ev = []; for (const t of ['dragenter', 'dragleave', 'dragend', 'drop']) document.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.relatedTarget ? e.relatedTarget.nodeName : 'null') + ':' + (e.target.id || e.target.nodeName)), true); });
  const f = foto();
  await lascia(page, f, { x: 120, y: 120, fasi: ['dragEnter', 'dragOver'] });
  await lascia(page, f, { x: 600, y: 400, fasi: ['dragOver'] });
  await lascia(page, f, { x: 600, y: 400, fasi: ['dragCancel'] });
  await page.waitForTimeout(500);
  console.log('C2', await page.locator('#inputForm').getAttribute('class'), JSON.stringify(await page.evaluate(() => window.__ev)));
  await page.screenshot({ path: 'tests/.shots/esplora-1623-campo-acceso-dopo-annulla.png' });
});
