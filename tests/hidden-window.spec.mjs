// La finestra dell'app non deve MAI comparire sullo schermo mentre gira la suite.
//
// PERCHÉ QUESTO SPEC ESISTE
//   Non è un dettaglio estetico: se lanciare i test significa vedersi lampeggiare
//   finestre davanti mentre si lavora, i test non si lanciano — e un test che non
//   si lancia non serve a niente. La prima versione di questa protezione sembrava
//   funzionare e invece cadeva in due casi reali, entrambi coperti qui sotto.
//
// Senza la protezione ognuno di questi assert diventa rosso.
//
// LA TRASPARENZA NON SI PUÒ CHIEDERE DAPPERTUTTO, LA POSIZIONE SÌ
//   L'opacità di una finestra la applica il compositore del sistema. Nei
//   contenitori senza schermo delle routine (Xvfb, nessun compositore) chiederla
//   non fa niente e rileggerla dà sempre 1: questo spec era rosso a ogni giro in
//   cloud, si fermava sulla PRIMA riga, e le due cose che lì si possono ancora
//   verificare — che la finestra stia fuori dallo schermo e non rubi il fuoco —
//   non venivano più guardate da nessuno. È così che è passato inosservato per
//   settimane un difetto vero sul parcheggio della finestra (a schermo scalato la
//   coordinata girava e la finestra ricompariva sul monitor). Adesso la
//   trasparenza si chiede solo dove il sistema sa darla, e il resto si verifica
//   sempre: un controllo che non gira non protegge nessuno.

import { test, expect } from './fixtures/electron.mjs';

// Il sistema sa davvero rendere trasparente una finestra? Si chiede a una
// finestra di prova, non a quella sotto esame: così la risposta non è l'assert
// che vogliamo fare.
async function trasparenzaDisponibile(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const prova = new BrowserWindow({ show: false, width: 120, height: 120 });
    try {
      prova.setOpacity(0.5);
      return prova.getOpacity() < 1;
    } finally { prova.destroy(); }
  });
}

// Stato della finestra letto DAL PROCESSO PRINCIPALE: è la verità del sistema
// operativo, non un'opinione del codice sotto test.
async function windowState(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    const b = win.getBounds();
    // "Sullo schermo" = si sovrappone all'area di lavoro di un monitor vero.
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.bounds;
      return b.x < a.x + a.width && b.x + b.width > a.x
          && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    return { opacity: win.getOpacity(), onScreen, focused: win.isFocused(), fullScreen: win.isFullScreen() };
  });
}

test('durante i test la finestra sta fuori dallo schermo, è trasparente e non ruba il fuoco', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  const s = await windowState(app);
  expect(s.opacity).toBe(0);
  expect(s.onScreen).toBe(false);
  expect(s.focused).toBe(false);
});

// Il caso che aveva fatto bocciare la prima versione: mettere l'app a tutto
// schermo fa agganciare la finestra al monitor dal sistema operativo, e "fuori
// schermo" da solo non regge più. Misurato: copriva davvero lo schermo per
// qualche secondo in 3 lanci su 4 degli spec che usano il tutto schermo.
test('nemmeno a tutto schermo la finestra diventa visibile', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    win.setFullScreen(true);
  });
  await new Promise((r) => setTimeout(r, 600));

  const full = await windowState(app);
  expect(full.fullScreen).toBe(true);
  // A tutto schermo la finestra COPRE il monitor: l'unica cosa che la tiene
  // invisibile è la trasparenza totale.
  expect(full.opacity).toBe(0);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.getParentWindow());
    win.setFullScreen(false);
  });
  await new Promise((r) => setTimeout(r, 600));

  // Uscendo, il sistema rimetterebbe la finestra dov'era: deve tornare via.
  const back = await windowState(app);
  expect(back.opacity).toBe(0);
  expect(back.onScreen).toBe(false);
});

// Il DOM deve restare pilotabile e disegnato: una finestra invisibile che non
// renderizza renderebbe inutile tutta la suite.
test('invisibile ma viva: il contenuto si disegna e gli screenshot vengono', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  const shot = await page.screenshot();
  // Un PNG vero, non un'immagine vuota da pochi byte.
  expect(shot.length).toBeGreaterThan(5000);
});
