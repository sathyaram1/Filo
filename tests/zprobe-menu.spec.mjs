// TEMPORANEO — audit prober: dump del menu tasto destro nei vari contesti.
import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:20px">
<h1 id="h">Titolo di prova</h1>
<p id="p">Un paragrafo con del testo selezionabile per la prova del menu contestuale.</p>
<a id="a" href="https://example.com/pagina">un link</a>
<img id="img" width="80" height="60" alt="img" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjYzQ1YTNiIi8+PC9zdmc+">
<input id="in" style="width:300px" value="testo dentro una casella">
<textarea id="ta" rows="3" cols="40">testo dentro una textarea</textarea>
</body>`;

async function dumpMenu(page, label) {
  const data = await page.evaluate(() => {
    const root = document.querySelector('.sn-menu') || document.querySelector('[class*="sn-menu"]');
    if (!root) return null;
    const rows = [...root.querySelectorAll('*')]
      .filter((e) => e.className && /item|row|entry|icon/i.test(String(e.className)))
      .map((e) => ({ cls: String(e.className), txt: (e.textContent || '').trim().slice(0, 60) }));
    return { html: root.outerHTML.length, rows };
  });
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(data, null, 1).slice(0, 4000));
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelectorAll('.sn-menu').forEach((e) => e.remove()));
}

test('dump menu contestuale', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGE);

  await page.click('#p', { button: 'right' });
  await page.waitForTimeout(600);
  await dumpMenu(page, 'pagina vuota (nessuna selezione)');
  await page.screenshot({ path: 'tests/.shots/zprobe-menu-page.png' });
  await closeMenu(page);

  await page.evaluate(() => {
    const p = document.getElementById('p');
    const r = document.createRange(); r.selectNodeContents(p);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.click('#p', { button: 'right' });
  await page.waitForTimeout(600);
  await dumpMenu(page, 'selezione di testo (non editabile)');
  await page.screenshot({ path: 'tests/.shots/zprobe-menu-sel.png' });
  await closeMenu(page);

  await page.click('#a', { button: 'right' });
  await page.waitForTimeout(600);
  await dumpMenu(page, 'link');
  await closeMenu(page);

  await page.click('#img', { button: 'right' });
  await page.waitForTimeout(600);
  await dumpMenu(page, 'immagine');
  await closeMenu(page);

  await page.click('#in');
  await page.click('#in', { button: 'right' });
  await page.waitForTimeout(600);
  await dumpMenu(page, 'casella input senza selezione');
  await closeMenu(page);

  await page.evaluate(() => { const i = document.getElementById('in'); i.focus(); i.setSelectionRange(0, 5); });
  await page.click('#in', { button: 'right' });
  await page.waitForTimeout(600);
  await dumpMenu(page, 'casella input con selezione');
  await closeMenu(page);
});
