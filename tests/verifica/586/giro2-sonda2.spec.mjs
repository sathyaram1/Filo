// Sonda 2 del giro 2 (#586): che cos'è davvero lo stream della strada vecchia.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<script>
  const descrivi = (s) => s.getTracks().map((t) => {
    let st = {};
    try { st = t.getSettings(); } catch (_) {}
    return { kind: t.kind, label: t.label, w: st.width, h: st.height, surface: st.displaySurface };
  });
  window.__legacy = () => navigator.mediaDevices.getUserMedia({
    audio: false, video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
          (e) => 'no:' + ((e && e.name) || 'errore'));
  window.__legacyAudio = () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
          (e) => 'no:' + ((e && e.name) || 'errore'));
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true })
    .then((s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
          (e) => 'no:' + ((e && e.name) || 'errore'));
  window.__tab = () => navigator.mediaDevices.getUserMedia({
    audio: false, video: { mandatory: { chromeMediaSource: 'tab' } },
  }).then((s) => { const d = descrivi(s); try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return d; },
          (e) => 'no:' + ((e && e.name) || 'errore'));
</script>
</body></html>`;

test('sonda2: che cosa consegna la strada vecchia', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const chip = shell.locator('.perm-chip');

  for (const [nome, fn] of [['camera vera', '__cam'], ['legacy video', '__legacy'], ['legacy audio+video', '__legacyAudio'], ['legacy tab', '__tab']]) {
    const p = page.evaluate((f) => window[f](), fn);
    await page.waitForTimeout(2500);
    const n = await chip.count();
    if (n) {
      // eslint-disable-next-line no-console
      console.log('[586-g2b]', nome, '→ pastiglia:', JSON.stringify(await chip.allTextContents()));
      await chip.first().locator('.perm-chip-allow').click();
    }
    // eslint-disable-next-line no-console
    console.log('[586-g2b]', nome, '| pastiglie:', n, '| tracce:', JSON.stringify(await p));
  }
  expect(true).toBe(true);
});
