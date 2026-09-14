// Verifica #592, giro 12 — la cattura dello schermo chiesta da una pagina
// visitata riguarda la scheda DAVANTI, non quella che l'ha chiesta.
//
// Il messaggio della cattura è fra quelli ammessi alle pagine visitate perché
// il riquadro del feedback si apre da ogni pagina e allega lo screenshot di
// quella pagina. L'handler però non guarda chi chiede: prende la scheda ATTIVA
// della finestra. Una pagina che resta viva in una scheda di sfondo (un
// intervallo, un worker) chiede la cattura mentre l'utente sta guardando
// un'altra scheda, e si porta via l'immagine di quella.
//
// Qui la scheda che chiede è rossa, quella davanti è blu: se torna indietro
// blu, l'immagine è di una scheda che a chi ha chiesto non appartiene.

import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (colore) => `<!doctype html><html><head><meta charset="utf-8"><title>${colore}</title></head>`
  + `<body style="margin:0;background:${colore};width:100vw;height:100vh"></body></html>`;

// Colore del pixel centrale dell'immagine tornata, letto nel main.
const coloreAlCentro = (app, dataUrl) => app.evaluate(async (electron, url) => {
  const img = electron.nativeImage.createFromDataURL(url);
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const b = img.toBitmap(); // BGRA
  const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
  return { r: b[i + 2], g: b[i + 1], b: b[i], width, height };
}, dataUrl);

test('la cattura chiesta da una scheda di sfondo non deve essere della scheda davanti', async ({ app, openTab, testServer }) => {
  const rossa = await testServer.openReady(openTab, pagina('rgb(255,0,0)'));
  const idRossa = await app.evaluate(async (electron) => {
    for (const w of electron.BrowserWindow.getAllWindows()) {
      const t = w._filoTabs?.tabs?.find((tt) => /^http:\/\/127\.0\.0\.1/.test(tt.url || ''));
      if (t) return { id: t.id, url: t.url };
    }
    return null;
  });
  expect(idRossa, 'la scheda che chiede non si trova').not.toBeNull();

  // La seconda scheda aperta passa davanti: da qui in poi l'utente guarda lei.
  await testServer.openReady(openTab, pagina('rgb(0,0,255)'));

  const r = await app.evaluate(async (_e, s) => globalThis.SN_HANDLE_MESSAGE(
    { type: 'capture_visible_tab' }, s,
  ), { url: idRossa.url, tab: { id: idRossa.id, url: idRossa.url, title: 'rossa' } });

  expect(r && r.ok, 'la cattura non è riuscita: prova inconcludente').toBe(true);
  const c = await coloreAlCentro(app, r.dataUrl);
  expect(c, 'immagine vuota: prova inconcludente in questo ambiente').not.toBeNull();
  // Rosso = la scheda che ha chiesto. Blu = la scheda che l'utente sta guardando.
  expect(c.b < 100, `la cattura è della scheda davanti, non di chi l'ha chiesta (pixel ${JSON.stringify(c)})`).toBe(true);

  await rossa.close().catch(() => {});
});
