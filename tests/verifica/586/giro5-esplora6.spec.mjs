// Esplorazione giro 5 (6) — NON è una prova che vale.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<div contenteditable id="ce" style="border:1px solid #999;min-height:40px;width:340px"></div>
<script>
  window.__dispositivi = () => navigator.mediaDevices.enumerateDevices()
    .then((l) => l.map((d) => d.kind + '|' + (d.label || '(senza nome)') + '|' + (d.deviceId ? 'id' : '-')));
  window.__execPaste = () => {
    const ce = document.getElementById('ce');
    ce.focus();
    let r = 'no';
    try { r = 'execCommand=' + document.execCommand('paste'); } catch (e) { r = 'throw ' + e.name; }
    return r + ' testo=' + JSON.stringify(ce.textContent);
  };
  window.__voce = () => new Promise((r) => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) { r('non esiste'); return; }
    try {
      const s = new R();
      s.onerror = (e) => r('errore ' + e.error);
      s.onstart = () => r('PARTITA');
      s.onaudiostart = () => r('AUDIO');
      s.start();
      setTimeout(() => r('niente'), 6000);
    } catch (e) { r('throw ' + e.name); }
  });
</script></body></html>`;

test('J — cosa vede un sito senza aver chiesto niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  // mettiamo qualcosa negli appunti, come farebbe chi copia una password
  await app.evaluate(({ clipboard }) => clipboard.writeText('PAROLA-SEGRETA-42'));
  console.log('[g5-6 J] dispositivi:', JSON.stringify(await page.evaluate(() => window.__dispositivi())));
  console.log('[g5-6 J] execCommand paste:', await page.evaluate(() => window.__execPaste()));
  await shell.waitForTimeout(1500);
  console.log('[g5-6 J] domande:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  console.log('[g5-6 J] riconoscimento vocale:', await page.evaluate(() => window.__voce()));
  await shell.waitForTimeout(1500);
  console.log('[g5-6 J] domande dopo la voce:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  console.log('[g5-6 J] cartelli:', JSON.stringify(await shell.locator('.perm-live').allTextContents()));
});
