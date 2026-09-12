// Esplorazione giro 5 (3) — NON è una prova che vale.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p id="p">prova</p>
<script>
  const ok = (s) => ({ ok: true, tracce: s.getTracks().map((t) => t.kind + ':' + t.label) });
  const no = (e) => ({ ok: false, errore: (e && e.name) + ' ' + (e && e.message) });
  window.__go = (v) => navigator.mediaDevices.getUserMedia(v).then(ok, no);
</script></body></html>`;

const D = { mandatory: { chromeMediaSource: 'desktop' } };

test('A1 solo — video desktop + audio normale: chi muore?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const prima = app.windows().length;
  console.log('[g5-3] finestre prima:', prima);

  page.evaluate((v) => window.__go(v), { video: D, audio: true }).catch((e) => console.log('[g5-3] evaluate ko:', e.message.split('\n')[0]));
  await new Promise((r) => setTimeout(r, 6000));

  let shellViva = 'no';
  try { shellViva = String(await shell.evaluate(() => document.title)); } catch (e) { shellViva = 'MORTA: ' + e.message.split('\n')[0]; }
  console.log('[g5-3] shell:', shellViva);

  let pagViva = 'no';
  try { pagViva = String(await page.evaluate(() => location.href)); } catch (e) { pagViva = 'MORTA: ' + e.message.split('\n')[0]; }
  console.log('[g5-3] pagina:', pagViva);

  try { console.log('[g5-3] finestre dopo:', app.windows().length, app.windows().map((w) => { try { return w.url().slice(0, 60); } catch (_) { return '?'; } })); } catch (e) { console.log('[g5-3] app morta:', e.message.split('\n')[0]); }

  // il processo main è ancora vivo?
  try {
    const v = await app.evaluate(({ app: a }) => a.getVersion());
    console.log('[g5-3] main vivo, versione', v);
  } catch (e) { console.log('[g5-3] MAIN MORTO:', e.message.split('\n')[0]); }
});
