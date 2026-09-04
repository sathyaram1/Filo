// #527 — su Mac la barra dei menu di sistema si prende le scorciatoie di Filo.
//
// PERCHE' ESISTE QUESTO SPEC
//   Su Windows e Linux la finestra di Filo e' senza cornice: la barra dei menu
//   non viene attaccata a nessuna finestra e i suoi tasti non fanno niente. Su
//   Mac quella barra e' dell'APPLICAZIONE — sta in cima allo schermo, esiste
//   sempre — e i suoi tasti vincono su quelli che Filo ascolta dentro la
//   pagina. Filo non ne dichiara nessuna, quindi ne resta appesa una di serie,
//   in inglese, che si prende Cmd+W (chiudi la FINESTRA, non la scheda),
//   Cmd+R (ricarica la shell, non la pagina), Cmd+ +/-/0 (ingrandisce la fila
//   delle schede, non il sito) e Cmd+Z (annulla, non "pagina precedente") —
//   proprio le scorciatoie che l'elenco delle capacita' promette su Mac.
//
// Lo spec gira su qualunque sistema perche' la barra e' la stessa ovunque: e'
// solo su Mac che diventa visibile e attiva.
import { test, expect } from './fixtures/electron.mjs';

// I ruoli i cui tasti Filo gestisce gia' per conto suo: se restano qui dentro,
// su Mac vincono loro.
const RUOLI_IN_CONFLITTO = ['close', 'reload', 'forcereload', 'zoomin', 'zoomout', 'resetzoom', 'undo', 'redo'];

function appiattisci(items, out = []) {
  for (const it of items) {
    out.push(it);
    if (it.sub) appiattisci(it.sub, out);
  }
  return out;
}

async function menuDellApp(app) {
  return app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return null;
    const dump = (items) => items.map((it) => ({
      label: it.label,
      role: it.role,
      registra: it.registerAccelerator,
      sub: it.submenu ? dump(it.submenu.items) : null,
    }));
    return dump(m.items);
  });
}

test('la barra dei menu non si prende le scorciatoie che Filo gestisce da se', async ({ app, shell }) => {
  const menu = await menuDellApp(app);
  if (menu === null) return; // nessuna barra: niente da rubare.
  const rubati = appiattisci(menu)
    .filter((it) => it.role && RUOLI_IN_CONFLITTO.includes(String(it.role).toLowerCase()))
    .filter((it) => it.registra !== false)
    .map((it) => `${it.label || it.role} (${it.role})`);
  expect(rubati, 'su Mac questi tasti li intercetta la barra dei menu, non Filo').toEqual([]);
});

test('la barra dei menu non parla di un altro prodotto', async ({ app, shell }) => {
  const menu = await menuDellApp(app);
  if (menu === null) return;
  const voci = appiattisci(menu).map((it) => String(it.label || ''));
  const estranee = voci.filter((v) => /electron/i.test(v)
    || ['Learn More', 'Documentation', 'Community Discussions', 'Search Issues'].includes(v));
  expect(estranee, 'la barra in cima allo schermo, su Mac, e\' quella di serie di Electron').toEqual([]);
});
