// Esplorazione giro 4 — cosa chiede Filo per le API meno note ma comuni.
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<div id="out"></div>
<script>
window.__prova = async (quale) => {
  const esito = (s) => s;
  try {
    if (quale === 'wakelock') { const w = await navigator.wakeLock.request('screen'); return 'OK wakelock ' + !!w; }
    if (quale === 'sensore') {
      return await new Promise((r) => {
        try {
          const a = new Accelerometer({ frequency: 10 });
          a.addEventListener('error', (e) => r('ERR ' + (e.error && e.error.name)));
          a.addEventListener('reading', () => r('OK sensore'));
          a.start();
          setTimeout(() => r('niente in 4s'), 4000);
        } catch (e) { r('THROW ' + e.name + ' ' + e.message); }
      });
    }
    if (quale === 'persist') { const ok = await navigator.storage.persist(); return 'persist=' + ok; }
    if (quale === 'midi') { await navigator.requestMIDIAccess(); return 'OK midi'; }
    if (quale === 'midisysex') { await navigator.requestMIDIAccess({ sysex: true }); return 'OK midi sysex'; }
    if (quale === 'idle') { const s = await IdleDetector.requestPermission(); return 'idle=' + s; }
    if (quale === 'fonts') { const f = await window.queryLocalFonts(); return 'fonts=' + f.length; }
    if (quale === 'windowmgmt') { const s = await window.getScreenDetails(); return 'schermi=' + s.screens.length; }
    if (quale === 'bgsync') {
      const reg = await navigator.serviceWorker.register('data:text/javascript,');
      await reg.sync.register('x'); return 'OK bgsync';
    }
    if (quale === 'clipwrite') { await navigator.clipboard.writeText('ciao'); return 'OK scrittura appunti'; }
    if (quale === 'clipread') { const t = await navigator.clipboard.readText(); return 'letto: ' + t; }
    if (quale === 'speaker') { const d = await navigator.mediaDevices.selectAudioOutput(); return 'OK speaker ' + d.label; }
    if (quale === 'storageaccess') { await document.requestStorageAccess(); return 'OK storage-access'; }
  } catch (e) { return 'ERRORE ' + (e && e.name) + ': ' + (e && e.message); }
  return '??';
};
</script></body></html>`;

const CASI = ['wakelock', 'sensore', 'persist', 'midi', 'midisysex', 'idle', 'fonts',
  'windowmgmt', 'bgsync', 'clipwrite', 'speaker', 'storageaccess'];

test('battuta di permessi meno noti: cosa compare e cosa dice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, HTML);

  for (const caso of CASI) {
    const p = page.evaluate((q) => window.__prova(q), caso).catch((e) => 'EVAL-FAIL ' + e.message);
    await shell.waitForTimeout(1500);
    const chips = await shell.locator('.perm-chip').allTextContents();
    console.log(`[586 g4] ${caso} → pastiglia: ${JSON.stringify(chips)}`);
    // rispondiamo negando (×) per sbloccare la fila
    const x = shell.locator('.perm-chip .perm-chip-x');
    if (await x.count()) { await x.first().click(); await shell.waitForTimeout(300); }
    const r = await Promise.race([p, new Promise((r2) => setTimeout(() => r2('(ancora in attesa)'), 3000))]);
    console.log(`[586 g4] ${caso} → esito pagina: ${r}`);
  }
});
