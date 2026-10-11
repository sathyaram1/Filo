// Quando si installa un aggiornamento scaricato: le decisioni, senza Electron, disco né rete.
// Il ricordo su disco, l'installatore e la finestra li tocca src/main/updater.js.
// Regole: tests/unit/aggiornamentoRegole.test.mjs.
'use strict';

const MODI = ['avvio', 'chiusura'];
const MODO_PREDEFINITO = 'avvio';
// Dopo il secondo fallimento Filo non ritenta più da solo: restano l'avviso col link e il pulsante.
const TENTATIVI_DA_SOLI = 2;

function parti(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1, 0 o 1; null se una delle due non è una versione.
function confrontaVersioni(a, b) {
  const pa = parti(a);
  const pb = parti(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function modoScelto(impostazioni) {
  const m = impostazioni && impostazioni.aggiornamenti && impostazioni.aggiornamenti.installa;
  return MODI.includes(m) ? m : MODO_PREDEFINITO;
}

// Il ramo di piattaforma intero: cosa succede alla chiusura, all'avvio e col pulsante.
function piano(piattaforma, modo) {
  if (piattaforma === 'win32') {
    // Alla chiusura l'installatore toglie Filo.exe per una decina di secondi senza che si veda (#1039).
    const chiusura = modo === 'chiusura';
    return { allaChiusura: chiusura, allAvvio: !chiusura, pulsante: 'installatore' };
  }
  // Su Mac installa il meccanismo di sistema, che oggi rifiuta la firma: niente pulsante, resta l'avviso.
  if (piattaforma === 'darwin') return { allaChiusura: true, allAvvio: false, pulsante: null };
  // Su Linux si riscrive l'AppImage in un attimo: il pulsante c'è solo se quel file si può riscrivere.
  if (piattaforma === 'linux') return { allaChiusura: true, allAvvio: false, pulsante: 'appimage' };
  return { allaChiusura: false, allAvvio: false, pulsante: null };
}

const NOMI_SISTEMA = { win32: 'Windows', darwin: 'Mac', linux: 'Linux' };

// La scelta apertura/chiusura vale solo dove i due piani differiscono: altrove chiederla, o leggerla, non dice il vero.
function sceltaNonVale(piattaforma) {
  const a = piano(piattaforma, 'avvio');
  const c = piano(piattaforma, 'chiusura');
  if (a.allAvvio !== c.allAvvio || a.allaChiusura !== c.allaChiusura) return null;
  const dove = NOMI_SISTEMA[piattaforma] ? `su ${NOMI_SISTEMA[piattaforma]}` : 'qui';
  const come = !a.pulsante ? 'una versione nuova di Filo non si installa da sola: si scarica da filo.red'
    : a.allaChiusura ? 'una versione nuova di Filo si installa quando lo chiudi' : 'Filo non si aggiorna da solo';
  return `la scelta di quando installare gli aggiornamenti c'è solo su Windows: ${dove} ${come}`;
}

function haPulsante(piattaforma, { appImageScrivibile = false } = {}) {
  const p = piano(piattaforma, MODO_PREDEFINITO).pulsante;
  return p === 'installatore' || (p === 'appimage' && appImageScrivibile === true);
}

function intero(n) {
  const x = Math.floor(Number(n));
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function normalizza(p) {
  if (!p || typeof p !== 'object' || !parti(p.versione) || !p.file || !p.sha512) return null;
  return {
    versione: String(p.versione),
    file: String(p.file),
    sha512: String(p.sha512),
    amministratore: p.amministratore === true,
    tentativi: intero(p.tentativi),
    falliti: Math.min(intero(p.falliti), intero(p.tentativi)),
  };
}

// La stessa versione con lo stesso file tiene il conto dei tentativi; una versione nuova riparte da zero.
function ricordaScaricato(prec, nuovo) {
  const n = normalizza({ ...(nuovo || {}), tentativi: 0, falliti: 0 });
  const p = normalizza(prec);
  if (!n) return p;
  if (p && p.versione === n.versione && p.sha512 === n.sha512) return { ...p, file: n.file, amministratore: n.amministratore };
  return n;
}

function contaTentativo(pronto) {
  const p = normalizza(pronto);
  return p ? { ...p, tentativi: p.tentativi + 1 } : null;
}

// `pronto: null` vuol dire «togli il ricordo». `avvisa`: è il secondo fallimento, l'utente lo legge fra le notifiche.
// Dopo un fallimento Filo si apre sempre normalmente: due installatori di fila lascerebbero l'utente senza Filo.
// Con «Installa gli aggiornamenti da solo» spento (#786) si installa solo la versione `chiesta` con «Installa».
function decidiAllAvvio({ piattaforma, versioneInUso, modo, pronto, installatoreValido = true, automatici = true, chiesta = null } = {}) {
  const p = normalizza(pronto);
  const apri = (resta, avvisa = false) => ({ azione: 'apri', pronto: resta, avvisa });
  if (!p) return apri(null);
  const cmp = confrontaVersioni(p.versione, versioneInUso);
  if (cmp == null || cmp <= 0) return apri(null);
  if (p.tentativi > p.falliti) {
    const dopo = { ...p, falliti: p.tentativi };
    return apri(dopo, dopo.falliti >= TENTATIVI_DA_SOLI);
  }
  if (!piano(piattaforma, modo).allAvvio || p.tentativi >= TENTATIVI_DA_SOLI) return apri(p);
  if (automatici === false && chiesta !== p.versione) return apri(p);
  if (installatoreValido !== true) return apri(null);
  return { azione: 'installa', pronto: { ...p, tentativi: p.tentativi + 1 }, avvisa: false };
}

// Il testo dell'avviso discreto quando la versione nuova è scaricata; null dove il pulsante non c'è.
// `daSolo: false`: l'installazione automatica è spenta e la versione non è stata chiesta, resta solo il pulsante.
function fraseScaricato({ versione, piattaforma, modo, pronto, appImageScrivibile = false, daSolo = true } = {}) {
  if (!parti(versione) || !haPulsante(piattaforma, { appImageScrivibile })) return null;
  const v = String(versione);
  if (daSolo === false) return `Filo ${v} è pronto da installare.`;
  if (piattaforma === 'win32') {
    if (modo === 'chiusura') return `Filo ${v} è pronto: si installa quando chiudi Filo.`;
    const p = normalizza(pronto);
    const daSolo = !p || p.versione !== v || p.tentativi < TENTATIVI_DA_SOLI;
    return daSolo
      ? `Filo ${v} è pronto: si installa la prossima volta che apri Filo, in una decina di secondi.`
      : `Filo ${v} è pronto da installare.`;
  }
  return `Filo ${v} è pronto: si installa quando chiudi Filo.`;
}

module.exports = {
  MODI, MODO_PREDEFINITO, TENTATIVI_DA_SOLI,
  confrontaVersioni, modoScelto, piano, sceltaNonVale, haPulsante,
  ricordaScaricato, contaTentativo, decidiAllAvvio, fraseScaricato,
};
