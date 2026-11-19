import { test } from './fixtures/electron.mjs';

test('esplora', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.locator('#doc').click();
  console.log('NUOVO', await page.evaluate(() => document.getElementById('doc').innerHTML));
  for (const seq of ['# ', '## ', '### ', '> ', '- ', '1. ']) {
    for (const html of ['<p><br></p>', '<p>a</p><p><br></p><p>b</p>', '<div><br></div>']) {
      await page.evaluate((html) => {
        const d = document.getElementById('doc');
        d.innerHTML = html;
        d.focus();
        const p = [...d.children].find((c) => !c.textContent);
        const r = document.createRange();
        r.setStart(p, 0);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }, html);
      await page.keyboard.type(seq);
      const out = await page.evaluate(() => document.getElementById('doc').innerHTML.replace(/<button[^>]*>.*?<\/button>/g, ''));
      console.log(JSON.stringify(seq), html, '=>', out);
    }
  }
  await page.evaluate(() => { const d = document.getElementById('doc'); d.innerHTML = ''; d.focus(); });
  await page.keyboard.type('# ');
  console.log('VUOTO', await page.evaluate(() => document.getElementById('doc').innerHTML.replace(/<button[^>]*>.*?<\/button>/g, '')));
});
