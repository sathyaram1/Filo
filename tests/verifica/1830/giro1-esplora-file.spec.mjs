// Verifica #1830 giro 1, esplorazione: un file della conversazione (riga «File:») parte col feedback dalla chat.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, scrollConfirmToEnd, aspettaConfermaPronta } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const feedback = (args) => ({ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Zoom rotto', testo: 'Lo zoom non va.', ...args }) });

test('file della chat e schermata assente', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('v1830-');
  const f = join(dir, 'log zoom.txt');
  writeFileSync(f, 'riga di log\n');
  const page = await home(app);
  await app.evaluate(() => {
    globalThis.__dep = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__dep.push(JSON.parse(JSON.stringify(p))); return { id: 'x' }; };
  });
  await modelloFinto(app, [{ text: '', toolCalls: [feedback({ allegati: [f, 'schermata'] })] }, { text: 'Inviata.' }]);
  await chiedi(page, `manda questo log come feedback\nFile: ${f}`);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await confirmState(page))?.allegati?.length).toBe(1);
  const s = await confirmState(page);
  console.log(JSON.stringify(s.allegati), s.notaAllegati);
  await page.screenshot({ path: 'tests/.shots/v1830-file.png' });
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__dep)).length, { timeout: 10_000 }).toBe(1);
  const [p] = await app.evaluate(() => globalThis.__dep);
  console.log(JSON.stringify({ files: (p.files || []).map((x) => ({ name: x.name, type: x.type, len: x.dataUrl.length })), images: (p.images || []).length }));
  expect(p.files).toHaveLength(1);
  await ripristina(app);
});
