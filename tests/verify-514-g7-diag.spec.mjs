// Diagnostica (giro 7): perché una raffica di Esc su un sito ladro non esce.
import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return {
      cf: !!t.contentFullscreen,
      riv: t._escRivendicazioni,
      timer: !!t._escUscitaTimer,
      pageFs: !!t.pageFullscreen,
    };
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}
async function esc(app, attesa) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

const ladra = `<!doctype html><html><body style="margin:0;height:1200px">
<p id="t">parola dentro una frase</p>
<script>
  var rubato = null;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var rm = muts[i].removedNodes;
      for (var j = 0; j < rm.length; j++) {
        var n = rm[j];
        if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-sn-ui') !== null) {
          rubato = n; window.__rubato = true;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  function riattacca() {
    if (!rubato || rubato.isConnected) return;
    try {
      rubato.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px';
      document.documentElement.appendChild(rubato);
    } catch (_) {}
  }
  window.__riattacca = riattacca;
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    setTimeout(function () {
      if (rubato && rubato.isConnected) { try { rubato.remove(); } catch (_) {} }
      setTimeout(riattacca, 60);
    }, 0);
  }, true);
</script>
</body></html>`;

for (const gap of [80, 200, 400]) {
  test(`diag: raffica a ${gap}ms sul sito ladro`, async ({ app, openTab, testServer }) => {
    test.setTimeout(240_000);
    const page = await testServer.openReady(openTab, ladra);
    await page.locator('#t').click({ button: 'right' });
    await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => !!window.__rubato), { timeout: 8000 }).toBe(true);
    await page.evaluate(() => window.__riattacca());
    await new Promise((r) => setTimeout(r, 300));
    await entra(app);
    const traccia = [];
    for (let i = 0; i < 8; i++) {
      traccia.push(await stato(app));
      await esc(app, gap);
    }
    traccia.push(await stato(app));
    console.log(`GAP ${gap} →`, JSON.stringify(traccia));
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`GAP ${gap} finale →`, JSON.stringify(await stato(app)));
  });
}
