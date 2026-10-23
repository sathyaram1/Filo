// Gli elementi dei pannelli di destra delle app di Filo, letti e scritti da UN posto: la pagina manda la mossa, il main
// la mette in fila dietro la precedente e annuncia il risultato a tutte le pagine di Filo aperte.
// Regole: patterns/a-sinistra-filo-a-destra-l-app.md

const { BrowserWindow } = require('electron');
const storage = require('../shim/storage');
const { spingiAllaScheda } = require('./impostazioniPerOrigine');
const { vistePerAnnunci } = require('../tabs/riservaNuovaScheda');

const CHIAVE = 'sn_pannelli_app';
// La collezione dell'Editor rispecchiata dalla pagina: da lì arrivano le configurazioni dei vecchi moduli (#1433).
const COLLEZIONE_EDITOR = 'filo.editor.collection';

const P = () => globalThis.SN_PANNELLI_APP;
let coda = Promise.resolve();

function inFila(lavoro) {
  const giro = coda.then(lavoro);
  coda = giro.catch(() => {});
  return giro;
}

async function tutti() {
  const out = await storage.get([CHIAVE]);
  const v = out && out[CHIAVE];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// La prima lettura di un'app porta dentro quello che i suoi vecchi moduli sapevano, una volta sola, dalla copia della
// collezione che la pagina rispecchia. Senza copia aspetta la pagina, che manda la sua (op 'migra').
async function leggiEMigra(app) {
  const salvati = await tutti();
  const stato = P().normalizza(app, salvati[app]);
  if (!stato || stato.migrato) return stato;
  let collezione = null;
  if (app === 'editor') {
    try { collezione = (await storage.get([COLLEZIONE_EDITOR]))[COLLEZIONE_EDITOR] || null; } catch (_) { collezione = null; }
  }
  if (!collezione) return stato;
  const migrato = P().migra(app, stato, collezione) || stato;
  await storage.set({ [CHIAVE]: { ...salvati, [app]: migrato } });
  return migrato;
}

function leggi(app) {
  if (!P() || !P().catalogo(app)) return Promise.resolve(null);
  return inFila(() => leggiEMigra(app));
}

// op: { op: 'posa'|'togli'|'configura'|'migra', id, primaDi?, config? }. null se la mossa non vale (elemento ignoto, già fuori).
async function modifica(app, op) {
  if (!P() || !P().catalogo(app) || !op || typeof op !== 'object') return null;
  const esito = await inFila(async () => {
    const prima = await leggiEMigra(app);
    const id = String(op.id || '');
    let dopo = null;
    if (op.op === 'posa') dopo = P().posa(app, prima, id, op.primaDi ? String(op.primaDi) : null);
    else if (op.op === 'togli') dopo = P().togli(app, prima, id);
    else if (op.op === 'configura') dopo = P().configura(app, prima, id, op.config);
    else if (op.op === 'migra') dopo = P().migraConfig(app, prima, op.config);
    if (!dopo) return { stato: prima, cambiato: false };
    if (JSON.stringify(dopo) === JSON.stringify(prima)) return { stato: prima, cambiato: false };
    const salvati = await tutti();
    await storage.set({ [CHIAVE]: { ...salvati, [app]: dopo } });
    return { stato: dopo, cambiato: true };
  });
  if (esito.cambiato) annuncia(app, esito.stato);
  return esito;
}

// A ogni pagina di Filo aperta, in ogni finestra: un pannello con la copia vecchia, alla prima mossa, la riscriverebbe.
function annuncia(app, stato) {
  const tipo = globalThis.SN_MSG?.MSG?.PANNELLO_APP_CAMBIATO || 'pannello_app_cambiato';
  const soloFilo = (url) => String(url || '').startsWith('filo://');
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = win && !win.isDestroyed() && win._filoTabs;
    if (!tabs) continue;
    for (const { wc, inVista } of vistePerAnnunci(tabs)) {
      try { spingiAllaScheda(wc, { type: tipo, app, stato }, { inVista, soloFrame: soloFilo }); } catch (_) {}
    }
  }
  try { require('../shortcuts').seguiPannelli(); } catch (_) {}
}

module.exports = { leggi, modifica, annuncia, CHIAVE, COLLEZIONE_EDITOR };
