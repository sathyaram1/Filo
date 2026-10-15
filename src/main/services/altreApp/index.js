// «Filo può usare le altre applicazioni» (#779, COMPUTER-USE-SPEC §2.2): segue l'impostazione e tiene il componente.
// Accesa: scarica e installa il driver; spenta: lo ferma e lo toglie, così chi non la usa non ha niente sul disco.
// Da qui esce il ComputerDriver per chi agirà sulle finestre; la pagina Preferenze legge lo stato con `statoPerPagina`.
'use strict';

const path = require('path');
const fs = require('fs');
const Pacchetti = require('./pacchetti');
const { creaInstallatore } = require('./installa');
const { creaMotoreCua } = require('./cua');
const { creaComputerDriver } = require('./computerDriver');
const Permessi = require('./permessi');

const cartellaDati = () => process.env.FILO_USER_DATA || require('electron').app.getPath('userData');
const cartella = () => path.join(cartellaDati(), 'componenti', 'cua-driver');
const nelleProve = () => process.env.NODE_ENV === 'test' || !!process.env.FILO_USER_DATA;
const log = (m) => { try { console.warn(typeof m === 'string' ? m : `[altreApp] ${m && m.message}`); } catch (_) {} };

// Nelle prove l'elenco dei pacchetti può puntare a un server locale con un driver finto; fuori dalle prove mai.
function elencoPacchetti() {
  const f = nelleProve() && process.env.FILO_ALTRE_APP_PACCHETTI;
  if (f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { log(e); } }
  return Pacchetti;
}
const pacchetto = () => Pacchetti.pacchettoPer(process.platform, process.arch, elencoPacchetti());

function scarica(url, opz) {
  let net = null;
  try { net = require('electron').net; } catch (_) {}
  if (net && typeof net.fetch === 'function') return net.fetch(url, { ...opz, cache: 'no-store' });
  return globalThis.fetch(url, opz);
}

const attiva = (s) => !!(s && s.altreApp && s.altreApp.enabled === true);

const motore = creaMotoreCua({
  eseguibile: () => eseguibileInstallato,
  idApp: 'ai.filo.desktop',
  versioneFilo: (() => { try { return require('../../../../package.json').version; } catch (_) { return '0'; } })(),
  log,
});

let eseguibileInstallato = null;
let mancantiLinux = [];
let provato = false;
let voluto = null;
let coda = Promise.resolve();
const ascoltatori = new Set();

async function provaDriver() {
  motore.ferma();
  try {
    const r = await motore.prova();
    if (r.ok) mancantiLinux = r.mancanti || [];
    return r;
  } catch (e) {
    log(`[altreApp] il driver non parte: ${e && e.message}${e && e.dettagli && e.dettagli.stderr ? ` — ${String(e.dettagli.stderr).slice(-500)}` : ''}`);
    return { ok: false, codice: 'non-parte', motivo: e && e.message };
  } finally {
    motore.ferma();
  }
}

const installatore = creaInstallatore({
  cartella,
  pacchetto,
  sistema: () => Pacchetti.nomeSistema(),
  scarica,
  log,
  prova: async (exe) => {
    eseguibileInstallato = exe;
    provato = true;
    return provaDriver();
  },
});

installatore.suCambio((s) => {
  if (s.fase === 'assente') eseguibileInstallato = null;
  annuncia();
});

function annuncia() {
  const s = statoBreve();
  for (const f of ascoltatori) { try { f(s); } catch (_) {} }
}

function statoBreve() {
  const s = installatore.stato();
  const p = pacchetto();
  let permessi = [];
  if (s.fase === 'pronto') { try { permessi = Permessi.mancanti({ daLinux: mancantiLinux }); } catch (_) {} }
  return {
    attiva: voluto === true,
    fase: s.fase,
    ricevuti: s.ricevuti || 0,
    totali: s.totali || 0,
    versione: s.versione || (p && p.versione) || Pacchetti.VERSIONE,
    errore: s.errore || null,
    byte: s.byte || 0,
    permessi,
  };
}

// Le operazioni sul disco una dopo l'altra: accendi-spegni-accendi in fretta non le sovrappone mai.
function inCoda(fn) {
  const giro = coda.then(fn, fn);
  coda = giro.catch(() => {});
  return giro;
}

async function allinea({ avvio }) {
  const d = await installatore.sulDisco();
  if (!voluto) {
    if (d.esiste) { motore.ferma(); await installatore.disinstalla(); }
    else installatore.imposta({ fase: 'assente' });
    return;
  }
  if (d.aggiornato) {
    eseguibileInstallato = d.installato.percorso;
    installatore.imposta({ fase: 'pronto', versione: d.installato.versione, byte: d.byte });
    return;
  }
  // All'avvio un'impronta già rifiutata non si riscarica da sola: la riprova la chiede l'utente.
  const p = pacchetto();
  if (avvio && d.errore && d.errore.codice === 'impronta' && p && d.errore.sha256 === p.sha256) {
    installatore.imposta({ fase: 'errore', errore: { codice: 'impronta', frase: require('./installa').frase('impronta') } });
    return;
  }
  motore.ferma();
  await installatore.installa();
  const fine = await installatore.sulDisco();
  if (fine.installato && installatore.stato().fase === 'pronto') {
    eseguibileInstallato = fine.installato.percorso;
    installatore.imposta({ ...installatore.stato(), byte: fine.byte });
  }
}

/** Da applySettingsUpdate e dall'avvio: agisce solo quando il valore cambia (e al primo giro). */
function seguiImpostazioni(settings) {
  const vuole = attiva(settings);
  if (vuole === voluto) return coda;
  const avvio = voluto === null;
  voluto = vuole;
  // Spegnere ferma subito lo scaricamento in corso: la coda poi toglie i file.
  if (!vuole) { motore.ferma(); installatore.ferma(); }
  return inCoda(() => allinea({ avvio }));
}

async function reinstalla() {
  if (!voluto) return { ok: false, motivo: 'l\'impostazione è spenta' };
  motore.ferma();
  provato = false;
  await inCoda(async () => { await installatore.installa(); await allineaByte(); });
  return { ok: true, stato: statoBreve() };
}

async function allineaByte() {
  const d = await installatore.sulDisco();
  if (d.installato && installatore.stato().fase === 'pronto') {
    eseguibileInstallato = d.installato.percorso;
    installatore.imposta({ ...installatore.stato(), byte: d.byte });
  }
}

/** Per la pagina: lo stato, e la prima volta in una sessione prova anche che il driver parta davvero. */
async function statoPerPagina({ verifica = false } = {}) {
  if (verifica && voluto && installatore.stato().fase === 'pronto' && !provato && !installatore.inCorso()) {
    provato = true;
    const r = await provaDriver();
    if (!r.ok) installatore.imposta({ fase: 'errore', errore: { codice: 'non-parte', frase: require('./installa').frase('non-parte') } });
    else installatore.imposta({ ...installatore.stato() });
  }
  return statoBreve();
}

async function chiediPermesso(id) {
  const r = await Permessi.chiedi(id);
  // macOS ricorda la risposta per processo: il driver riparte alla prossima richiesta e la rilegge.
  motore.ferma();
  return r;
}

async function disponibile() {
  if (!voluto) return { ok: false, codice: 'spento', motivo: 'l\'impostazione «Filo può usare le altre applicazioni» è spenta' };
  const s = installatore.stato();
  if (installatore.inCorso()) return { ok: false, codice: 'in-installazione', motivo: 'il componente si sta ancora installando' };
  if (s.fase === 'errore') return { ok: false, codice: (s.errore && s.errore.codice) || 'guasto', motivo: (s.errore && s.errore.frase) || 'il componente non funziona' };
  if (s.fase !== 'pronto' || !eseguibileInstallato) return { ok: false, codice: 'assente', motivo: 'il componente non è installato' };
  const mancano = Permessi.mancanti({ daLinux: mancantiLinux });
  if (mancano.length) return { ok: false, codice: 'permessi', motivo: `manca ${mancano.map((m) => `«${m.nome}»`).join(' e ')}` };
  return { ok: true, motore };
}

const computerDriver = creaComputerDriver({ disponibile, log });

module.exports = {
  computerDriver,
  seguiImpostazioni,
  reinstalla,
  statoPerPagina,
  chiediPermesso,
  suCambio: (f) => { ascoltatori.add(f); return () => ascoltatori.delete(f); },
  allUscita: () => { motore.ferma(); installatore.ferma(); },
  _cartella: cartella,
};
