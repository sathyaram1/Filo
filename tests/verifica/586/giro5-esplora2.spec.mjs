// Esplorazione giro 5 (2) — NON è una prova che vale.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p id="p">prova</p>
<script>
  const ok = (s) => ({ ok: true, tracce: s.getTracks().map((t) => t.kind + ':' + t.label) });
  const no = (e) => ({ ok: false, errore: (e && e.name) + ' ' + (e && e.message) });
  window.__go = (v) => navigator.mediaDevices.getUserMedia(v).then(ok, no);
</script></body></html>`;

const D = { mandatory: { chromeMediaSource: 'desktop' } };

async function prova(nome, shell, page, vincoli) {
  let esito;
  try {
    const p = page.evaluate((v) => window.__go(v), vincoli);
    await shell.waitForTimeout(2500);
    const chip = await shell.locator('.perm-chip').allTextContents().catch(() => ['?']);
    console.log(`[g5-2 ${nome}] domanda: ${JSON.stringify(chip)}`);
    const c = shell.locator('.perm-chip .perm-chip-allow');
    if (await c.count()) await c.first().click();
    await shell.waitForTimeout(1500);
    const f = shell.locator('.perm-source .perm-source-item');
    const nf = await f.count();
    if (nf) await f.first().click();
    console.log(`[g5-2 ${nome}] fonti offerte: ${nf}`);
    esito = await Promise.race([p, new Promise((r) => setTimeout(() => r('(attesa)'), 12000))]);
  } catch (e) { esito = 'ECCEZIONE ' + e.message.split('\n')[0]; }
  console.log(`[g5-2 ${nome}] esito: ${JSON.stringify(esito)}`);
  let viva = 'morta';
  try { viva = await page.evaluate(() => location.href); } catch (e) { viva = 'morta: ' + e.message.split('\n')[0]; }
  console.log(`[g5-2 ${nome}] scheda: ${viva}`);
  try {
    console.log(`[g5-2 ${nome}] cartelli: ${JSON.stringify(await shell.locator('.perm-live').allTextContents())}`);
  } catch (e) { console.log(`[g5-2 ${nome}] shell morta: ${e.message.split('\n')[0]}`); }
}

test('A1 — video desktop + audio normale', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await prova('A1', shell, page, { video: D, audio: true });
});

test('A2 — video desktop + audio desktop (strada vecchia classica)', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await prova('A2', shell, page, { video: D, audio: D });
});

test('A3 — video normale + audio desktop', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await prova('A3', shell, page, { video: true, audio: D });
});

test('A4 — microfono consentito prima, poi video desktop + audio normale', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await prova('A4-mic', shell, page, { audio: true });
  await prova('A4-vecchia', shell, page, { video: D, audio: true });
});
