import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/429';
mkdirSync(SHOTS, { recursive: true });

async function stato(shell) {
  return shell.evaluate(() => {
    const tabs = [...document.querySelectorAll('#tabs .tab')].map((t) => {
      const r = t.getBoundingClientRect();
      const ti = t.querySelector('.title');
      return { a: t.classList.contains('active') ? 1 : 0, x: Math.round(r.x), w: Math.round(r.width), bg: getComputedStyle(t).backgroundColor, col: getComputedStyle(ti).color, t: (ti?.textContent || '').slice(0, 20), tw: ti?.clientWidth, tsw: ti?.scrollWidth, tip: t.dataset.tip || t.title || '' };
    });
    const nw = document.getElementById('tab-new').getBoundingClientRect();
    const wc = document.querySelector('.window-controls').getBoundingClientRect();
    return { tabs, newRight: Math.round(nw.right), wcLeft: Math.round(wc.left), deep: getComputedStyle(document.body).backgroundColor };
  });
}

test('titoli lunghi e molte schede', async ({ shell, openTab, testServer }) => {
  const lungo = 'Previsioni meteo per Milano e tutta la Lombardia aggiornate';
  await testServer.openReady(openTab, `<!doctype html><title>${lungo}</title><body style="margin:0;background:#fff">x</body>`);
  await shell.waitForTimeout(1000);
  console.log('2tab', JSON.stringify(await stato(shell)));
  await shell.screenshot({ path: `${SHOTS}/lungo-2.png` });
  const p = await openTab('filo://manage/manage.html');
  await shell.waitForTimeout(1000);
  console.log('3tab', JSON.stringify(await stato(shell)));
  await shell.screenshot({ path: `${SHOTS}/lungo-3.png` });
  for (const u of ['filo://options/options.html', 'filo://history/history.html', 'filo://feedback/feedback.html', 'filo://board/board.html', 'filo://dashboard/dashboard.html']) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  }
  await shell.waitForTimeout(2000);
  console.log('8tab', JSON.stringify(await stato(shell)));
  await shell.screenshot({ path: `${SHOTS}/molte.png` });
  await shell.hover('#tabs .tab:nth-child(1)');
  await shell.waitForTimeout(900);
  await shell.screenshot({ path: `${SHOTS}/molte-hover.png` });
  console.log('hover', JSON.stringify(await stato(shell)));
});

test('scuro emulato su gestione', async ({ shell, openTab }) => {
  const p = await openTab('filo://manage/manage.html');
  await p.waitForLoadState('load');
  await shell.emulateMedia({ colorScheme: 'dark' });
  await p.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(2000);
  const pg = await p.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor, (() => { const e = document.elementFromPoint(300, 2); let n = e; while (n && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)') n = n.parentElement; return n ? getComputedStyle(n).backgroundColor : 'none'; })()]);
  console.log('scuro', JSON.stringify(await stato(shell)), JSON.stringify(pg));
  await shell.screenshot({ path: `${SHOTS}/scuro-shell.png` });
  await p.screenshot({ path: `${SHOTS}/scuro-page.png` });
});
