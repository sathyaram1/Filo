import { test, expect } from './fixtures/electron.mjs';

test('debug spiegazioni feedback', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => window.SN_MARKDOWN && window.SN_SPIEGAZIONI);
  const info = await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'prova';
    d.innerHTML = window.SN_MARKDOWN.render('Risponde subito se la risposta sta nella {{cache|Una copia vicina dei dati.}}.');
    document.body.prepend(d);
    document.body.style.paddingBottom = '4000px';
    const s = getComputedStyle(document.body);
    return `${d.innerHTML.slice(0, 300)} | body oy=${s.overflowY} sh=${document.scrollingElement.scrollHeight} ch=${document.scrollingElement.clientHeight}`;
  });
  console.log(info);
  const parola = page.locator('#prova .filo-spiega');
  await parola.click({ button: 'right' });
  console.log('menu', await page.locator('.filo-spiega-menu').count());
});

test('debug manage', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'A', seq: 10, subSeq: 0, priority: 1, name: 'Uno', clientId: 'owner:me', senderProof: 'admin', createdAt: '2026-06-20T10:00:00Z' }]);
    window.__mgTest.setTab('inbox');
  });
  await expect(page.locator('.mg-item')).toHaveCount(1);
  const info = await page.locator('.mg-item').first().evaluate((el) => {
    const out = [];
    for (let n = el.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      out.push(`${n.tagName}.${n.className}#${n.id} oy=${s.overflowY} sh=${n.scrollHeight} ch=${n.clientHeight} st=${n.scrollTop}`);
    }
    return out.join('\n');
  });
  console.log(info);
});
