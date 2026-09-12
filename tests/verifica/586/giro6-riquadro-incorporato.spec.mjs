// Verifica #586, giro 6 — cosa legge su di sé un riquadro incorporato.
//
// Il giro 3 aveva chiuso questa porta per la pagina: prima che l'utente abbia
// scelto, al sito deve risultare «da chiedere» e non «negato», perché molti siti
// guardano quello stato prima di chiedere e, se leggono «negato», non chiedono
// mai — il pulsante «attiva le notifiche» non fa niente e chi ci finisce resta
// senza via d'uscita, visto che nelle Impostazioni quel sito non c'è.
//
// Un riquadro incorporato è esattamente il posto dove quel codice vive di
// solito: il widget della videochiamata, il lettore che chiede le notifiche, la
// mappa dentro la pagina di un negozio. Qui si guarda se anche lì la lettura
// dice la verità.

import { test, expect } from '../../fixtures/electron.mjs';

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

test('dentro un riquadro incorporato i permessi mai scelti devono leggersi «da chiedere»', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);

  const dentro = testServer.html(`<!doctype html><html><body><p>widget</p>
<script>
  const nomi = ['camera', 'microphone', 'geolocation', 'notifications'];
  window.addEventListener('message', async (e) => {
    if (e.data !== 'leggi') return;
    const out = {};
    for (const n of nomi) {
      try { out[n] = (await navigator.permissions.query({ name: n })).state; }
      catch (err) { out[n] = 'errore'; }
    }
    out.notificationPermission = Notification.permission;
    parent.postMessage({ stati: out }, '*');
  });
</script></body></html>`);

  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
<iframe id="f" src="${dentro}" style="width:320px;height:140px"></iframe>
<script>
  window.__stati = null;
  window.addEventListener('message', (e) => { if (e.data && e.data.stati) window.__stati = e.data.stati; });
  window.__leggi = () => document.getElementById('f').contentWindow.postMessage('leggi', '*');
  window.__mieiStati = async () => {
    const out = {};
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { out[n] = (await navigator.permissions.query({ name: n })).state; }
      catch (err) { out[n] = 'errore'; }
    }
    out.notificationPermission = Notification.permission;
    return out;
  };
</script></body></html>`);

  const dellaPagina = await page.evaluate(() => window.__mieiStati());
  console.log('[586 g6] quello che legge la PAGINA:', JSON.stringify(dellaPagina));

  await page.evaluate(() => window.__leggi());
  const delRiquadro = await aspetta(async () => page.evaluate(() => window.__stati), 15_000);
  console.log('[586 g6] quello che legge il RIQUADRO incorporato:', JSON.stringify(delRiquadro));

  expect(delRiquadro, 'il riquadro non ha risposto').toBeTruthy();

  const negati = Object.entries(delRiquadro)
    .filter(([, v]) => v === 'denied')
    .map(([k]) => k);

  expect(
    negati,
    'dentro un riquadro incorporato — il posto dove vivono il widget della videochiamata, il '
    + 'lettore che chiede le notifiche, la mappa dentro la pagina di un negozio — i permessi che '
    + 'nessuno ha mai negato si leggono «negato». Un widget che guarda prima di chiedere si ferma '
    + 'lì e mostra «hai bloccato la fotocamera, sbloccala dalle impostazioni del browser», e nelle '
    + 'Impostazioni di Filo quel sito non c\'è. Nella pagina che lo ospita la stessa lettura dice '
    + 'la verità: è la stessa porta del giro 3, rimasta aperta di un riquadro',
  ).toEqual([]);
});
