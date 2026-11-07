// Esplorazione: in ogni pagina di Filo, i pezzi col title (o col data-tip, o i tasti di sola icona) mostrano il fumetto?
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(400_000);

const PAGINE = [
  'filo://newtab/', 'filo://preferences/preferences.html', 'filo://decks/decks.html', 'filo://manage/manage.html',
  'filo://editor/editor.html', 'filo://options/options.html', 'filo://options/altro.html', 'filo://security/security.html',
  'filo://credits/credits.html', 'filo://history/history.html', 'filo://feedback/feedback.html',
  'filo://board/board.html', 'filo://downloads/downloads.html', 'filo://quaderno/quaderno.html',
  'filo://spellcheck/spellcheck.html', 'filo://redteam/redteam.html', 'filo://transparency/transparency.html',
  'filo://archive/archive.html', 'filo://novita/novita.html', 'filo://error/', 'filo://home/home.html',
];

test('esplora le pagine', async ({ openTab }) => {
  const righe = [];
  for (const url of PAGINE) {
    let page;
    try { page = await openTab(url); } catch (e) { righe.push(`${url}: non si apre ${e.message.split('\n')[0]}`); continue; }
    await page.waitForTimeout(2500);
    const ha = await page.evaluate(() => !!window.SN_SUGGERIMENTO && typeof window.SN_SUGGERIMENTO.testoPer === 'function').catch(() => false);
    if (!ha) { righe.push(`${url}: SENZA MODULO`); continue; }
    const cand = await page.evaluate(() => {
      const out = [];
      let n = 0;
      const tutti = document.querySelectorAll('[title],[data-tip],button,[role="button"],a[href]');
      for (const el of tutti) {
        if (out.length >= 8) break;
        if (el.tagName === 'IFRAME') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
        const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
        const sopra = document.elementFromPoint(cx, cy);
        if (!sopra || !(sopra === el || el.contains(sopra))) continue;
        const atteso = window.SN_SUGGERIMENTO.testoPer(sopra);
        const tit = el.getAttribute('title');
        const nativoSenza = !atteso && !!(tit && tit.trim());
        if (!atteso && !nativoSenza) continue;
        el.setAttribute('data-esplora', String(n));
        out.push({ i: n++, cx, cy, atteso, tit, tag: el.tagName, cls: String(el.className || '').slice(0, 40) });
      }
      return out;
    });
    let ok = 0;
    for (const c of cand) {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(150);
      await page.mouse.move(c.cx - 2, c.cy);
      await page.mouse.move(c.cx, c.cy);
      await page.waitForTimeout(800);
      const st = await page.evaluate((i) => {
        const el = document.querySelector(`[data-esplora="${i}"]`);
        const t = document.querySelector('[data-sn-fumetto]');
        const tip = t && t.shadowRoot && t.shadowRoot.querySelector('.tip');
        const vis = t && getComputedStyle(t).display !== 'none';
        return { testo: vis && tip ? tip.textContent : null, titoloOra: el ? el.getAttribute('title') : 'sparito' };
      }, c.i).catch((e) => ({ err: e.message }));
      if (st.testo && st.testo === c.atteso && (st.titoloOra === null || st.titoloOra === '')) ok++;
      else righe.push(`${url}: ${c.tag}.${c.cls} atteso=${JSON.stringify(c.atteso)} title=${JSON.stringify(c.tit)} -> ${JSON.stringify(st)}`);
    }
    righe.push(`${url}: ${ok}/${cand.length} ok`);
    await page.close().catch(() => {});
  }
  console.log('\n' + righe.join('\n'));
});
