import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

async function finestraCon(app, prefisso) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith(prefisso); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${prefisso} non trovata`);
}

test('esplora', async ({ app }) => {
  mkdirSync(SHOTS, { recursive: true });
  const home = await finestraCon(app, 'filo://newtab');
  await expect(home.locator('#tieni .dash-carta[data-tipo="editor"]')).toBeVisible({ timeout: 15_000 });
  await home.fill('#input', 'Caro condominio,');
  await home.screenshot({ path: `${SHOTS}/esplora-home.png` });
  const h = await home.evaluate(() => {
    const f = document.getElementById('inputForm').getBoundingClientRect();
    const i = document.getElementById('input');
    const cs = getComputedStyle(i);
    const fs = getComputedStyle(document.getElementById('inputForm'));
    return { form: f.toJSON(), input: i.getBoundingClientRect().toJSON(), font: cs.font, pad: cs.padding, color: cs.color,
      bg: fs.backgroundColor, border: fs.border, radius: fs.borderRadius, snbg: getComputedStyle(document.documentElement).getPropertyValue('--sn-bg'),
      vw: innerWidth, vh: innerHeight };
  });
  console.log('HOME', JSON.stringify(h));
  await home.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await ed.waitForSelector('#doc');
  await ed.waitForTimeout(1500);
  await ed.evaluate(() => { document.getElementById('doc').innerHTML = '<p>Caro condominio,</p>'; });
  const e = await ed.evaluate(() => {
    const p = document.querySelector('#doc p');
    const r = document.createRange(); r.selectNodeContents(p);
    const cs = getComputedStyle(p);
    return { p: p.getBoundingClientRect().toJSON(), testo: r.getBoundingClientRect().toJSON(), font: cs.font, color: cs.color, lh: cs.lineHeight,
      bg: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.querySelector('.ed-root')).backgroundColor, vw: innerWidth, vh: innerHeight };
  });
  console.log('EDITOR', JSON.stringify(e));
  await ed.screenshot({ path: `${SHOTS}/esplora-editor.png` });
  await ed.evaluate(() => window.SN_SIDEBAR && window.SN_SIDEBAR.open());
  await ed.waitForTimeout(800);
  await ed.screenshot({ path: `${SHOTS}/esplora-editor-aiuto.png` });
});
