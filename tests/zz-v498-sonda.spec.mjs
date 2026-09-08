// Sonda di misura (#498, verifica): NON asserisce, stampa le misure dei casi
// che il giro avversariale ha trovato rossi, per capire quale sia la porta.
import { test } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function setSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w, h);
  }, [w, h]);
  await new Promise((r) => setTimeout(r, 400));
}

function richiestaFinta(i) {
  return {
    id: `req-${i}`, branch: `claude/lavoro-numero-${i}`,
    sha: `abcdef012345678901234567890abcdef012345${i}`,
    who: `routine-${i}`, origin: 'routine', feedbackNum: `#${400 + i}`,
    createdAtMs: Date.now() - 3600_000, expiresAtMs: Date.now() + 6 * 86400_000,
    blocks: [
      { kind: 'protected-paths', items: ['src/main/main.js', 'package.json'] },
      { kind: 'workflow', items: ['.github/workflows/release.yml'] },
    ],
  };
}

async function misura(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const grid = document.getElementById('mgReviewGrid');
    const blocco = document.getElementById('mgMergeApprovals');
    const pan = document.getElementById('panel-list');
    const r = grid.getBoundingClientRect();
    const b = blocco.getBoundingClientRect();
    return {
      gridTop: Math.round(r.top), gridH: Math.round(r.height), gridBottom: Math.round(r.bottom),
      bloccoH: Math.round(b.height), bloccoScrollH: blocco.scrollHeight,
      bloccoMax: getComputedStyle(blocco).maxHeight,
      panelH: Math.round(pan.getBoundingClientRect().height),
      viewport: doc.clientHeight, scrollH: doc.scrollHeight,
    };
  });
}

test('sonda: fusioni a varie altezze di finestra', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  for (const [w, h] of [[1280, 900], [1100, 700], [1000, 620]]) {
    await setSize(app, w, h);
    for (const quante of [0, 1, 2, 3, 8, 20]) {
      await page.evaluate((reqs) => {
        window.SN_MERGE_APPROVALS.render(
          document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
      }, Array.from({ length: quante }, (_, i) => richiestaFinta(i)));
      await page.waitForTimeout(250);
      const m = await misura(page);
      console.log(`SONDA ${w}x${h} fusioni=${quante} ${JSON.stringify(m)}`);
    }
  }

  // Caso "tutto acceso"
  await setSize(app, 1200, 800);
  await page.evaluate(() => {
    document.getElementById('mgBanner').hidden = false;
    const p = document.getElementById('mgNoSections');
    p.hidden = false;
    p.textContent = 'Le sezioni non si disegnano: su questo computer manca la chiave.';
  });
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(300);
  for (const quante of [0, 4]) {
    await page.evaluate((reqs) => {
      window.SN_MERGE_APPROVALS.render(
        document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
    }, Array.from({ length: quante }, (_, i) => richiestaFinta(i)));
    await page.waitForTimeout(300);
    const m = await misura(page);
    console.log(`SONDA tuttoacceso fusioni=${quante} ${JSON.stringify(m)}`);
  }
  await page.screenshot({ path: 'tests/.shots/v498-sonda-tutto.png' });

  // Zoom, con 3 fusioni
  await setSize(app, 1280, 900);
  await page.evaluate(() => {
    document.getElementById('mgBanner').hidden = true;
    document.getElementById('mgNoSections').hidden = true;
  });
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, Array.from({ length: 3 }, (_, i) => richiestaFinta(i)));
  for (const lvl of [0, 1, 2, 3]) {
    await app.evaluate(async ({ webContents }, l) => {
      for (const wc of webContents.getAllWebContents()) {
        try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(l); } catch (_) {}
      }
    }, lvl);
    await page.waitForTimeout(450);
    const m = await misura(page);
    console.log(`SONDA zoom=${lvl} ${JSON.stringify(m)}`);
    if (lvl === 2) await page.screenshot({ path: 'tests/.shots/v498-sonda-zoom2.png' });
  }
});
