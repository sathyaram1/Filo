// Diagnostica del giro 4 (non è una guardia: serve a guardare il DOM).
import { test } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const RIQUADRO = 'filo://feedback/feedback.html';
const ESTRANEO = 'sito-di-un-estraneo.invalid';

test('diag: che cos’è il testo colorato nella bolla', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate((estraneo) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'diag-582',
      status: 'open',
      name: 'diag',
      text: `La pagina non si apre. Vedi https://filo.app.${estraneo}/accedi`,
      url: `https://${estraneo}/x`,
      images: [],
      files: [],
      createdAt: '2026-09-11T10:00:00Z',
    }];
  }, ESTRANEO);
  await page.locator('#refresh').click();
  await page.locator('.fb-card').first().waitFor();
  const info = await page.evaluate(() => {
    const b = document.querySelector('.fb-bubble-body');
    const out = { html: b ? b.innerHTML : null, figli: [] };
    if (b) {
      for (const n of b.childNodes) {
        out.figli.push({
          tipo: n.nodeType,
          nome: n.nodeName,
          testo: (n.textContent || '').slice(0, 60),
          colore: n.nodeType === 1 ? getComputedStyle(n).color : null,
        });
      }
      out.coloreBolla = getComputedStyle(b).color;
    }
    return out;
  });
  console.log('DIAG', JSON.stringify(info, null, 2));
  mkdirSync('tests/.shots', { recursive: true });
  await page.locator('.fb-card').first().screenshot({ path: 'tests/.shots/582-giro4-diag-bolla.png' });
});
