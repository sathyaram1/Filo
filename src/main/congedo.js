// Avviso a una pagina interna che sta per sparire, e attesa della sua risposta.
// NON serve a chiedere permesso: la chiusura avviene comunque, al più tardi al tetto.
// La regola sta in tests/unit/congedoPagina.test.mjs.

const { ipcMain } = require('electron');

// Una scheda distrutta non riceve `pagehide` (verificato sul campo): chi rimanda
// il salvataggio perdeva l'ultima modifica, e la chat della home non si chiudeva.
const CANALE_AVVISO = 'filo:pagina-sparisce';
const CANALE_RISPOSTA = 'filo:pagina-sparita';

// Tetto largo: si aspetta su una view già tolta dallo schermo, e quello che si
// rischia a non aspettare è il lavoro di chi stava scrivendo.
const TETTO_MS = 800;

// Un ascoltatore solo per tutte le attese: «chiudi tutto» ne aprirebbe una
// ventina, e sopra la decina Node avvisa di una perdita di memoria che non c'è.
const inAttesa = new Map();
let ascoltoAcceso = false;

function accendiAscolto() {
  if (ascoltoAcceso) return;
  ascoltoAcceso = true;
  // Solo la risposta di QUELLA pagina la sblocca: due schede che si chiudono
  // insieme si sbloccherebbero a vicenda senza aver salvato.
  ipcMain.on(CANALE_RISPOSTA, (event) => {
    const fine = event && inAttesa.get(event.sender);
    if (fine) fine();
  });
}

function congedaPagina(webContents, { tetto = TETTO_MS } = {}) {
  return new Promise((risolvi) => {
    let vivo = false;
    try { vivo = !!webContents && !webContents.isDestroyed(); } catch (_) { vivo = false; }
    if (!vivo) { risolvi(); return; }
    accendiAscolto();
    let timer = null;
    const fine = () => {
      if (!inAttesa.has(webContents)) return;
      inAttesa.delete(webContents);
      clearTimeout(timer);
      risolvi();
    };
    inAttesa.set(webContents, fine);
    // Il timer NON si sgancia dal giro degli eventi: è l'unica garanzia che la
    // view venga poi buttata via anche se la pagina non risponde mai.
    timer = setTimeout(fine, tetto);
    try { webContents.send(CANALE_AVVISO); } catch (_) { fine(); }
  });
}

// Le uscite di una pagina interna sono tre (chiusa la scheda, chiusa la
// finestra, spento Filo) e il congedo deve valere per tutte e tre, da qui.
// Torna null quando non c'è niente da aspettare, così chi chiama non rimanda
// una chiusura che può avvenire subito.
function congedaSchedeInterne(tabs) {
  let interne = [];
  try { interne = (tabs?.tabs || []).filter((t) => t && t.isInternal && t.view); } catch (_) { return null; }
  if (!interne.length) return null;
  return Promise.all(interne.map((t) => congedaPagina(t.view.webContents).catch(() => {})));
}

module.exports = {
  congedaPagina, congedaSchedeInterne, CANALE_AVVISO, CANALE_RISPOSTA, TETTO_MS,
};
