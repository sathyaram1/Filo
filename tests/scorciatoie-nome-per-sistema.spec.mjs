// Su un Mac, Filo scriveva i tasti di Windows in mezza interfaccia.
//
// Le funzioni rispondevano già a Cmd: a mentire erano le SCRITTE. Il menu del
// tasto destro diceva "Ctrl+V" per Incolla e "Alt+H" per Aiuto, i pulsanti
// dell'Editor "Ctrl+B", il suggerimento della barra "Ctrl+T" — tasti che su un
// Mac o non ci sono o fanno altro. Ogni scritta era una stringa a sé, e infatti
// il difetto è rientrato una porta alla volta.
//
// Adesso la porta è una sola: `src/shared/tasti.js` sa come si chiama una
// scorciatoia sul sistema di chi la sta leggendo, e OGNI scritta passa di lì.
//
// Cosa asserisce questo spec, dal punto di vista di chi usa Filo: la scritta
// che l'utente ha davanti agli occhi è quella che la regola dice per il SUO
// sistema — non una stringa fissa che per metà degli utenti è falsa. Il
// controllo è lo stesso su Windows e su Mac; qui gira su Windows/Linux, e
// insieme verifica che la regola, interrogata per un Mac, cambi davvero
// risposta. Con le stringhe scritte a mano di prima è rosso in tre punti: la
// regola non arriva nemmeno alle pagine, quindi `SN_TASTI` non esiste.
//
// Che l'app parta su un Mac vero questo spec non lo prova: quello lo dice solo
// un Mac.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <p id="testo">Tasto destro qui.</p>
  <input id="campo" value="ciao" />
</body></html>`;

test('il menu del tasto destro nomina i tasti di CHI legge', async ({ app, openTab, testServer }) => {
  // Su una pagina web i moduli di Filo girano in un mondo separato da quello
  // della pagina, quindi la risposta della regola la chiediamo al processo
  // principale — stessa regola, stesso sistema.
  const atteso = await app.evaluate(() => ({
    incolla: globalThis.SN_TASTI.etichetta('Ctrl+V'),
    aiuto: globalThis.SN_TASTI.etichetta('Alt+H'),
    incollaSuMac: globalThis.SN_TASTI.etichetta('Ctrl+V', 'darwin'),
    aiutoSuMac: globalThis.SN_TASTI.etichetta('Alt+H', 'darwin'),
  }));
  // La regola sa cambiare risposta: interrogata per un Mac dà i tasti del Mac.
  expect(atteso.incollaSuMac).toBe('Cmd+V');
  expect(atteso.aiutoSuMac).toBe('Ctrl+Alt+H');

  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#campo').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // Le voci del menu chiedono il nome alla regola invece di scriverlo: se la
  // regola non arrivasse fin dentro la pagina, la voce non si costruirebbe
  // affatto e queste due scritte non ci sarebbero.
  const scorciatoie = await menu.locator('.sn-menu-shortcut').allTextContents();
  expect(scorciatoie).toContain(atteso.incolla);
  expect(scorciatoie).toContain(atteso.aiuto);
});

test('il suggerimento della barra nomina i tasti di CHI legge', async ({ shell }) => {
  const regolaCePresente = await shell.evaluate(() => typeof window.SN_TASTI?.etichetta === 'function');
  expect(regolaCePresente).toBe(true);
  expect(await shell.evaluate(() => window.SN_TASTI.etichetta('Ctrl+T', 'darwin'))).toBe('Cmd+T');

  // Il pulsante "+" della barra delle schede: il suggerimento non è più scritto
  // nell'HTML (un file solo per tutti i sistemi), lo compone la regola.
  const tip = await shell.evaluate(() => document.getElementById('tab-new')?.dataset.tip || '');
  const attesa = await shell.evaluate(() => window.SN_TASTI.etichetta('Ctrl+T'));
  expect(tip).toBe(`Nuova scheda (${attesa})`);
});

test('i pulsanti dell\'Editor nominano i tasti di CHI legge', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#sidebarToggle');

  const regolaCePresente = await page.evaluate(() => typeof window.SN_TASTI?.etichetta === 'function');
  expect(regolaCePresente).toBe(true);
  expect(await page.evaluate(() => window.SN_TASTI.etichetta('Ctrl+B', 'darwin'))).toBe('Cmd+B');
  expect(await page.evaluate(() => window.SN_TASTI.etichetta('Ctrl+\\', 'darwin'))).toBe('Cmd+\\');

  // Il suggerimento della sidebar: c'è ancora, e nomina il tasto giusto.
  const attesaBarra = await page.evaluate(() => window.SN_TASTI.etichetta('Ctrl+\\'));
  await expect(page.locator('#sidebarToggle')).toHaveAttribute('title', `Mostra/nascondi sidebar (${attesaBarra})`);
});
