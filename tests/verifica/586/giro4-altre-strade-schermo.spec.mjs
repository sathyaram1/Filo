// Esplorazione giro 4 — altre strade per prendersi lo schermo.
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<script>
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label + ':' + JSON.stringify(t.getSettings()));
  window.__prova = (quale) => {
    const gum = (c) => navigator.mediaDevices.getUserMedia(c).then(tracce, (e) => 'no:' + ((e && e.name) || 'errore') + ' ' + (e && e.message || ''));
    if (quale === 'screen-vecchio') return gum({ video: { mandatory: { chromeMediaSource: 'screen' } } });
    if (quale === 'desktop-mandatory') return gum({ video: { mandatory: { chromeMediaSource: 'desktop' } } });
    if (quale === 'desktop-piatto') return gum({ video: { chromeMediaSource: 'desktop' } });
    if (quale === 'desktop-audio-video') return gum({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop' } } });
    if (quale === 'gdm') return navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(tracce, (e) => 'no:' + ((e && e.name) || 'errore'));
    if (quale === 'gdm-currenttab') return navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true })
      .then(tracce, (e) => 'no:' + ((e && e.name) || 'errore'));
    if (quale === 'guardia-tolta') {
      try { delete navigator.mediaDevices.getUserMedia; } catch (_) {}
      return gum({ audio: { mandatory: { chromeMediaSource: 'desktop' } } });
    }
    return Promise.resolve('??');
  };
  // stessa cosa da dentro un riquadro di un altro sito
  window.__iframe = () => new Promise((r) => {
    const f = document.createElement('iframe');
    f.allow = 'display-capture *; camera *; microphone *';
    f.srcdoc = '<script>navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:"desktop"}}})'
      + '.then(s=>parent.postMessage("preso:"+s.getTracks().map(t=>t.label),"*"),'
      + 'e=>parent.postMessage("no:"+e.name,"*"));<\\/script>';
    window.addEventListener('message', (e) => r(String(e.data)), { once: true });
    document.body.appendChild(f);
    setTimeout(() => r('(niente in 8s)'), 8000);
  });
</script></body></html>`;

const CASI = ['screen-vecchio', 'desktop-mandatory', 'desktop-piatto', 'desktop-audio-video',
  'gdm-currenttab', 'guardia-tolta'];

test('altre strade per lo schermo: cosa chiede Filo e cosa consegna', async ({ shell, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, HTML);

  for (const caso of CASI) {
    const p = page.evaluate((q) => window.__prova(q), caso).catch((e) => 'EVAL-FAIL ' + e.message);
    await shell.waitForTimeout(1200);
    const chips = await shell.locator('.perm-chip').allTextContents();
    console.log(`[586 g4] ${caso} → pastiglia: ${JSON.stringify(chips)}`);
    const x = shell.locator('.perm-chip .perm-chip-x');
    if (await x.count()) { await x.first().click(); await shell.waitForTimeout(300); }
    const r = await Promise.race([p, new Promise((r2) => setTimeout(() => r2('(in attesa)'), 4000))]);
    console.log(`[586 g4] ${caso} → esito: ${JSON.stringify(r)}`);
    await shell.waitForTimeout(300);
  }

  const p2 = page.evaluate(() => window.__iframe());
  await shell.waitForTimeout(1500);
  console.log('[586 g4] riquadro → pastiglia:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  const x = shell.locator('.perm-chip .perm-chip-x');
  if (await x.count()) { await x.first().click(); }
  console.log('[586 g4] riquadro → esito:', JSON.stringify(await p2));
});
