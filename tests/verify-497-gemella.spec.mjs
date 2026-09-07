// #497 — la gemella: la pagina Feedback mostra la stessa frase e gli stessi tasti?
import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}

test('gemella — dove sta la frase per chi ha segnalato e come sono disposti i tasti', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForFunction(() => window.__fbTest);
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.com' }));
  await page.evaluate((l) => window.__fbTest.setData(l), [
    fb({ _id: 'g1', status: 'todo', userNote: '' }),
    fb({ _id: 'g2', status: 'todo', seq: 701, name: 'Secondo', userNote: 'già scritta' }),
  ]);
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const c = document.querySelectorAll('.fb-usernote');
    const vis = [...c].filter((e) => e.offsetParent !== null).length;
    const az = document.querySelector('.fb-actions');
    const bs = az ? [...az.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim().slice(0, 14), y: Math.round(b.getBoundingClientRect().top) })) : [];
    return { caselleFrase: c.length, visibili: vis, azioni: bs, righeAzioni: new Set(bs.map((b) => b.y)).size };
  });
  console.log('GEMELLA', JSON.stringify(info));
  await page.screenshot({ path: 'tests/.shots/497-gemella-piena.png', fullPage: true });
});
