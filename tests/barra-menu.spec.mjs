// La barra dei menu dell'applicazione (#527).
//
// PERCHÉ ESISTE
//   Su Mac la barra dei menu è dell'APPLICAZIONE: sta in cima allo schermo,
//   c'è sempre — anche con la finestra senza cornice — ed è la prima a vedere i
//   tasti, prima di qualunque cosa la pagina ascolti. Filo non ne dichiarava
//   nessuna e restava appesa quella di serie di Electron, che alle sue voci
//   agganciava Cmd+W, Cmd+R, Cmd+Z e Cmd +/-/0: chi chiudeva una scheda si
//   ritrovava chiusa la finestra con dentro tutte le altre.
//
//   Qui si prova la cosa dal punto di vista di chi usa Filo: si aziona la VOCE
//   DELLA BARRA — che è quello che su Mac fa il tasto — e si guarda che succeda
//   quello che Filo promette. La barra è la stessa su tutti i sistemi, quindi
//   lo spec vale anche dove non si vede.
import { test, expect } from './fixtures/electron.mjs';

// Aziona una voce della barra per etichetta, come farebbe il tasto su Mac.
async function voceDellaBarra(app, etichetta) {
  const trovata = await app.evaluate(({ Menu }, label) => {
    const barra = Menu.getApplicationMenu();
    if (!barra) return false;
    const cerca = (voci) => {
      for (const v of voci) {
        if (v.label === label && typeof v.click === 'function') return v;
        if (v.submenu) { const dentro = cerca(v.submenu.items); if (dentro) return dentro; }
      }
      return null;
    };
    const voce = cerca(barra.items);
    if (!voce) return false;
    voce.click();
    return true;
  }, etichetta);
  expect(trovata, `la barra dei menu non ha una voce "${etichetta}"`).toBe(true);
}

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w.isDestroyed());
  const tabs = win && win._filoTabs;
  return {
    finestra: win ? win.id : null,
    schede: tabs ? tabs.tabs.length : 0,
    urlAttiva: tabs ? (tabs.tabs.find((t) => t.id === tabs.activeId) || {}).url || '' : '',
  };
});

test('la barra dei menu è quella di Filo, e parla italiano', async ({ app, shell }) => {
  const barra = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return null;
    const dump = (voci) => voci.map((v) => ({ label: v.label, role: v.role, sub: v.submenu ? dump(v.submenu.items) : null }));
    return dump(m.items);
  });
  expect(barra, 'nessuna barra dei menu: su Mac copia e incolla smetterebbero di funzionare nei campi di testo').not.toBeNull();

  const cime = barra.map((v) => v.label);
  expect(cime).toContain('Filo');
  expect(cime).toContain('Modifica');

  const tutte = [];
  const scendi = (voci) => voci.forEach((v) => { tutte.push(v); if (v.sub) scendi(v.sub); });
  scendi(barra);

  // Niente voci di un altro prodotto.
  expect(tutte.map((v) => String(v.label || '')).filter((l) => /electron/i.test(l))).toEqual([]);

  // Copia/incolla su Mac dipendono da questa barra: se spariscono, smettono di
  // funzionare in ogni campo di testo dell'app.
  const ruoli = new Set(tutte.map((v) => String(v.role || '').toLowerCase()).filter(Boolean));
  for (const ruolo of ['cut', 'copy', 'paste', 'selectall']) expect(ruoli).toContain(ruolo);
});

test('«Chiudi scheda» chiude la scheda, non la finestra con dentro tutte le altre', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<html><body><h1>una pagina</h1></body></html>');
  const prima = await stato(app);
  expect(prima.schede).toBeGreaterThan(1);

  await voceDellaBarra(app, 'Chiudi scheda');

  await expect.poll(async () => (await stato(app)).schede).toBe(prima.schede - 1);
  const dopo = await stato(app);
  expect(dopo.finestra, 'la finestra con dentro le altre schede si è chiusa: era il difetto').toBe(prima.finestra);
});

test('«Annulla» torna alla pagina precedente quando non si sta scrivendo', async ({ app, shell, openTab, testServer }) => {
  const partenza = testServer.html('<html><body><h1>partenza</h1></body></html>');
  const arrivo = testServer.html('<html><body><h1>arrivo</h1></body></html>');

  const page = await openTab(partenza);
  await page.goto(arrivo);
  await expect.poll(async () => (await stato(app)).urlAttiva).toBe(arrivo);

  await voceDellaBarra(app, 'Annulla');

  await expect.poll(async () => (await stato(app)).urlAttiva, {
    message: 'Ctrl/Cmd+Z fuori da un campo di testo deve riportare alla pagina precedente',
  }).toBe(partenza);
});

test('«Annulla» mentre si scrive annulla il testo e NON porta via la pagina', async ({ app, shell, openTab, testServer }) => {
  const partenza = testServer.html('<html><body><h1>partenza</h1></body></html>');
  const conCampo = testServer.html('<html><body><textarea id="c"></textarea></body></html>');

  const page = await openTab(partenza);
  await page.goto(conCampo);
  await expect.poll(async () => (await stato(app)).urlAttiva).toBe(conCampo);

  await page.click('#c');
  await page.keyboard.type('una riga appena scritta');
  expect(await page.inputValue('#c')).toBe('una riga appena scritta');

  await voceDellaBarra(app, 'Annulla');

  // Quello che non deve MAI succedere: perdere la pagina (e con lei il testo)
  // mentre si sta scrivendo.
  await expect.poll(async () => (await stato(app)).urlAttiva).toBe(conCampo);
  await expect.poll(async () => page.inputValue('#c'), {
    message: 'dentro un campo di testo Ctrl/Cmd+Z deve annullare quello che si sta scrivendo',
  }).not.toBe('una riga appena scritta');
});
