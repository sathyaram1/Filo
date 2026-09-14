// Verifica #592, giro 12 — la cattura dello schermo chiesta da una pagina
// visitata riguarda la scheda DAVANTI, non quella che l'ha chiesta.
//
// Il messaggio della cattura è fra quelli ammessi alle pagine visitate perché
// il riquadro del feedback si apre da ogni pagina e allega l'immagine di QUELLA
// pagina. L'handler però non guarda chi chiede: prende la scheda ATTIVA della
// finestra. Una pagina che resta viva in una scheda di sfondo (un intervallo, un
// worker) chiede la cattura mentre l'utente sta guardando un'altra scheda, e si
// porta via l'immagine di quella.
//
// La cattura vera non funziona nel contenitore senza schermo (è uno dei rossi
// d'ambiente scritti in tests/rossi-noti.json: l'immagine torna 0×0). Quindi qui
// si sostituisce la sola cattura con un timbro che dice QUALE scheda è stata
// fotografata: quello che si prova è il bersaglio, non l'immagine.

import { test, expect } from '../../fixtures/electron.mjs';

const paginaVuota = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>ciao</body></html>';

test('la cattura chiesta da una scheda di sfondo non deve fotografare la scheda davanti', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, paginaVuota);
  const chiede = await app.evaluate(async (electron) => {
    for (const w of electron.BrowserWindow.getAllWindows()) {
      const t = w._filoTabs?.tabs?.find((tt) => /^http:\/\/127\.0\.0\.1/.test(tt.url || ''));
      if (t) return { id: t.id, url: t.url };
    }
    return null;
  });
  expect(chiede, 'la scheda che chiede non si trova').not.toBeNull();

  // La seconda scheda aperta passa davanti: da qui l'utente guarda lei.
  await testServer.openReady(openTab, paginaVuota);

  // Ogni scheda timbra la propria cattura col proprio id.
  await app.evaluate(async (electron) => {
    for (const w of electron.BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        const timbro = `SCHEDA-${t.id}`;
        t.view.webContents.capturePage = async () => ({ toDataURL: () => `data:text/plain,${timbro}` });
      }
    }
  });

  const r = await app.evaluate(async (_e, s) => globalThis.SN_HANDLE_MESSAGE(
    { type: 'capture_visible_tab' }, s,
  ), { url: chiede.url, tab: { id: chiede.id, url: chiede.url, title: 't' } });

  expect(r && r.ok, 'la cattura non è riuscita: prova inconcludente').toBe(true);
  expect(String(r.dataUrl), "la cattura è della scheda davanti, non di chi l'ha chiesta")
    .toContain(`SCHEDA-${chiede.id}`);
});
