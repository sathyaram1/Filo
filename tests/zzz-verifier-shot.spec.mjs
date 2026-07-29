import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('shot: pannello storico con versione manuale', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>Prima stesura breve.</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>C era una volta, in un bosco fitto e silenzioso, una bambina che portava sempre un mantello rosso cucito dalla nonna, e ogni mattina attraversava il sentiero verso il villaggio.</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  // aggiungo anche una versione di Filo per confrontare i badge
  await page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
  await page.click('#docSwitch');
  await page.click('#docHistory');
  await page.waitForSelector('.ed-vh-item');
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/verifier-379-history.png' });
});
