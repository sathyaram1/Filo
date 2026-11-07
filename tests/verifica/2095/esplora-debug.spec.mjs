import { test } from '../../fixtures/electron.mjs';

test('debug', async ({ openTab }) => {
  for (const url of ['filo://preferences/preferences.html', 'filo://decks/decks.html', 'filo://history/history.html']) {
    const page = await openTab(url);
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const rs = { tot: 0, piccoli: 0, fuori: 0, coperti: 0, vuoti: 0, esempi: [] };
      for (const el of document.querySelectorAll('[title],[data-tip],button,[role="button"],a[href]')) {
        rs.tot++;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) { rs.piccoli++; continue; }
        if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) { rs.fuori++; continue; }
        const sopra = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!sopra || !(sopra === el || el.contains(sopra))) { rs.coperti++; if (rs.esempi.length < 3) rs.esempi.push(sopra && (sopra.tagName + '.' + sopra.className)); continue; }
        if (!window.SN_SUGGERIMENTO.testoPer(sopra)) { rs.vuoti++; continue; }
      }
      rs.vw = innerWidth; rs.vh = innerHeight;
      return rs;
    });
    console.log(url, JSON.stringify(info));
  }
});
