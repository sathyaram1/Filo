// Sonda 2 verificatore #498 — giro 3: finestra minima, banner, riga di stato,
// e il caso del portatile comune.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

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
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    const b = document.getElementById('mgMergeApprovals');
    return {
      gridH: Math.round(g.height), gridBottom: Math.round(g.bottom),
      bloccoH: Math.round(b.getBoundingClientRect().height),
      viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      fuori: Math.round(g.bottom) - doc.clientHeight,
      scroll: doc.scrollHeight - doc.clientHeight,
    };
  });
}

async function setSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w2, h2]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w2, h2);
  }, [w, h]);
}
async function setZoom(app, l) {
  await app.evaluate(async ({ webContents }, lv) => {
    for (const wc of webContents.getAllWebContents()) {
      try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(lv); } catch (_) {}
    }
  }, l);
}

test('sonda2: minimo finestra, banner, riga di stato, portatile', async ({ app, openTab }) => {
  test.setTimeout(240000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });

  // Quanto piccola può diventare la finestra davvero?
  await setSize(app, 100, 100);
  await page.waitForTimeout(500);
  const min = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log('MINIMO FINESTRA', JSON.stringify(min));

  // Caso 0: senza fusioni, alla finestra minima
  console.log('MIN senza fusioni', JSON.stringify(await misura(page)));

  // Caso banner (non-owner) + riga "sezioni non disegnabili" + ricerca
  await page.evaluate(() => {
    document.getElementById('mgBanner').hidden = false;
    const p = document.getElementById('mgNoSections');
    p.hidden = false;
    p.textContent = 'Le sezioni non si disegnano: su questo computer manca la chiave.';
  });
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(300);
  for (const [w, h] of [[1280, 800], [1366, 728], [1200, 600], [720, 560], [720, 470]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    console.log(`BANNER+STATO+RICERCA ${w}x${h}`, JSON.stringify(await misura(page)));
  }
  await page.evaluate(() => {
    document.getElementById('mgBanner').hidden = true;
    document.getElementById('mgNoSections').hidden = true;
  });
  await page.locator('#mgSearchClose').click();
  await page.waitForTimeout(300);

  // Con le fusioni: portatile comune 1366x728 (barra applicazioni tolta)
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, [0, 1].map((i) => richiestaFinta(i)));
  await page.waitForTimeout(300);

  for (const [w, h] of [[1366, 728], [1280, 800], [720, 470]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    for (const z of [0, 1, 1.5, 2, 2.5, 3, 4, 5]) {
      await setZoom(app, z);
      await page.waitForTimeout(350);
      const m = await misura(page);
      console.log(`FUSIONI ${w}x${h} zoom ${z} (${Math.round(Math.pow(1.2, z) * 100)}%)`, JSON.stringify(m));
    }
    await setZoom(app, 0);
  }

  // E senza fusioni, solo zoom: il caso di chi non ha niente in attesa
  await page.evaluate(() => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: [], failed: [] });
  });
  await page.waitForTimeout(300);
  await setSize(app, 1280, 800);
  for (const z of [3, 4, 5]) {
    await setZoom(app, z);
    await page.waitForTimeout(350);
    console.log(`SENZA FUSIONI 1280x800 zoom ${z}`, JSON.stringify(await misura(page)));
  }
  await setZoom(app, 0);
});
