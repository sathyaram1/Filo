// Sonda 3 (#498): catture visive del caso normale (quello del feedback) e del
// caso che si rompe ancora, più uno stress su testi estremi nelle liste.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function setSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w, h);
  }, [w, h]);
  await new Promise((r) => setTimeout(r, 400));
}

function req(i) {
  return {
    id: `req-${i}`, branch: `claude/lavoro-numero-${i}`,
    sha: `abcdef012345678901234567890abcdef012345${i}`,
    who: `routine-${i}`, origin: 'routine', feedbackNum: `#${400 + i}`,
    createdAtMs: Date.now() - 3600_000, expiresAtMs: Date.now() + 6 * 86400_000,
    blocks: [{ kind: 'protected-paths', items: ['src/main/main.js'] }],
  };
}

function fbFinto(i, name, text) {
  return {
    id: `fb-${i}`, seq: 300 + i, subSeq: 0, num: `#${300 + i}`,
    name, text, status: 'new', createdAt: { _seconds: 1787421271 - i * 60 },
    url: 'filo://manage/manage.html', images: [], clientId: `c${i}`,
  };
}

async function prep(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
}

test('capture: il caso del feedback, chiaro e scuro, con dati veri nella lista', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await prep(page);
  await setSize(app, 1280, 840);

  const lunga = 'à'.repeat(10_000);
  const parolona = 'A'.repeat(4000);
  const fbs = [
    fbFinto(0, 'segnalazione normale', 'qui va tutto bene'),
    fbFinto(1, '<script>alert(1)</script>', 'javascript:alert(2) — 🐛🎉 日本語のテキスト'),
    fbFinto(2, parolona, lunga),
    fbFinto(3, '   ', ''),
  ];
  for (let i = 4; i < 40; i++) fbs.push(fbFinto(i, `segnalazione numero ${i}`, `testo ${i}`));
  await page.evaluate((v) => window.__mgTest.setData(v), fbs);
  await page.waitForTimeout(500);

  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return {
      tabsTop: Math.round(document.getElementById('mgTabs').getBoundingClientRect().top),
      gridH: Math.round(g.height), gridBottom: Math.round(g.bottom),
      viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      scrollW: doc.scrollWidth, clientW: doc.clientWidth,
    };
  });
  console.log('CAPTURE base', JSON.stringify(m));
  expect(m.scrollH).toBeLessThanOrEqual(m.viewport + 1);
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1);
  expect(m.tabsTop).toBeLessThanOrEqual(20);
  await page.screenshot({ path: 'tests/.shots/v498-base-chiaro.png' });

  // La lista scorre dentro la sua colonna, non trascina la pagina.
  const listaScorre = await page.evaluate(() => {
    const b = document.getElementById('mgListBody');
    b.scrollTop = b.scrollHeight;
    return { dentro: b.scrollTop > 0, pagina: document.documentElement.scrollTop };
  });
  console.log('CAPTURE lista', JSON.stringify(listaScorre));

  // Niente script eseguiti: il testo resta testo.
  const html = await page.locator('#mgList').innerHTML();
  expect(html).not.toContain('<script>');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v498-base-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });
});

test('capture: zoom alzato con fusioni in attesa', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await prep(page);
  await page.evaluate(() => window.__mgTest.setData([]));
  await setSize(app, 1280, 840);
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, [req(0), req(1)]);
  await page.waitForTimeout(300);

  for (const lvl of [0, 2]) {
    await app.evaluate(async ({ webContents }, l) => {
      for (const wc of webContents.getAllWebContents()) {
        try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(l); } catch (_) {}
      }
    }, lvl);
    await page.waitForTimeout(450);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
      const l = document.getElementById('mgListHeadRow');
      return {
        gridTop: Math.round(g.top), gridBottom: Math.round(g.bottom),
        gridH: Math.round(g.height),
        intestazioneListaVisibile: l ? Math.round(l.getBoundingClientRect().bottom) <= doc.clientHeight : null,
        viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      };
    });
    console.log(`CAPTURE zoom=${lvl}`, JSON.stringify(m));
    await page.screenshot({ path: `tests/.shots/v498-zoom${lvl}-fusioni.png` });
  }
});
