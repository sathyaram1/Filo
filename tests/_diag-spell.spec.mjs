import { test, expect } from './fixtures/electron.mjs';

async function probe(app, host) {
  return app.evaluate(({ webContents }, { host }) => {
    const all = webContents.getAllWebContents().map((w) => {
      let u = ''; try { u = w.getURL(); } catch (_) {}
      let h = ''; try { h = new URL(u).host; } catch (_) {}
      return { id: w.id, host: h, url: u.slice(0, 60), type: w.getType?.() };
    });
    const match = all.filter((w) => w.host === host);
    return { all, match };
  }, { host });
}

async function sendNativeAll(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" spellcheck="true"
    style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</textarea>
</body></html>`;

for (let i = 0; i < 8; i++) {
  test(`diag ${i}`, async ({ app, openTab, testServer }) => {
    const url = testServer.html(TA_PAGE);
    const host = new URL(url).host;
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    const before = await probe(app, host);
    const n = await sendNativeAll(app, host, 'ciiao', ['ciao', 'chiao']);
    // poll up to 2s for the marker
    let got = null, ms = 0;
    for (; ms < 2000; ms += 50) {
      got = await page.evaluate(() => document.documentElement.dataset.filoNativeWord || '');
      if (got === 'ciiao') break;
      await page.waitForTimeout(50);
    }
    console.log(`DIAG${i}: targets=${n} got="${got}" after=${ms}ms matchWC=${before.match.length} wcs=${JSON.stringify(before.all)}`);
  });
}
