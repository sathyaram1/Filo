// Quando si installa un aggiornamento scaricato: le decisioni, senza Electron, disco né rete.
// Il ricordo su disco, l'installatore e la finestra li tocca src/main/updater.js.
// Regole: tests/unit/aggiornamentoRegole.test.mjs.
'use strict';

const MODI = ['avvio', 'chiusura'];
const MODO_PREDEFINITO = 'avvio';
// Veloce: ogni versione, una ogni sei ore. Stabile: solo la minor del lunedì, X.Y.0 (SPEC-DOMANDE.md §4.2).
const CANALI = ['veloce', 'stabile'];
const CANALE_PREDEFINITO = 'veloce';
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

// Il numero che electron-updater confronta viene da latest.yml, l'etichetta dalla release segnata «latest»: diversi,
// la release è stata spostata o riscritta e non si scarica (#1119). Senza etichetta non si può dire, quindi no.
function etichettaCoincide(info) {
  const versione = info && info.version;
  const tag = info && info.tag;
  if (typeof versione !== 'string' || !versione || typeof tag !== 'string') return false;
  return tag.replace(/^v/, '') === versione;
}

// I file si scaricano dalla cartella della release etichettata: un «/», un «\», un «%» (un «..» codificato) o un «..»
// nel nome li prenderebbe da un'altra release, con l'etichetta giusta e l'installatore sbagliato (#1119).
function nomeNellaRelease(nome) {
  return typeof nome === 'string' && /^[^/\\%]+$/.test(nome) && !nome.includes('..');
}

function fileDellaRelease(info) {
  if (!info || typeof info !== 'object') return false;
  const nomi = [];
  if (info.files != null) {
    if (!Array.isArray(info.files)) return false;
    for (const f of info.files) nomi.push(f && f.url);
  }
  if (info.path != null) nomi.push(info.path);
  if (info.packages != null) {
    if (typeof info.packages !== 'object') return false;
    for (const p of Object.values(info.packages)) nomi.push(p && p.path);
  }
  return nomi.every(nomeNellaRelease);
}

// L'unica domanda «questa versione si può scaricare?»: numero uguale all'etichetta e file dentro quella release.
function releaseCoerente(info) {
  return etichettaCoincide(info) && fileDellaRelease(info);
}

function canaleScelto(impostazioni) {
  const c = impostazioni && impostazioni.aggiornamenti && impostazioni.aggiornamenti.canale;
  return CANALI.includes(c) ? c : CANALE_PREDEFINITO;
}

// L'unica domanda «questa versione è del canale scelto?», per ogni porta: trovarla, scaricarla, installarla.
function versioneDelCanale(versione, canale) {
  const p = parti(versione);
  if (!p) return false;
  return canale !== 'stabile' || p[2] === 0;
}

// La stabile più nuova, dal tag della release più recente: le minor escono solo il lunedì e la patch riparte da zero,
// quindi è la X.Y.0 della sua serie. Una settimana saltata lascia la serie com'è, e la stabile resta quella di prima.
function tagStabile(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(tag == null ? '' : tag));
  return m ? `v${Number(m[1])}.${Number(m[2])}.0` : null;
}

// Dove si scarica a mano `versione`. Il sito dà l'ultima uscita, sullo stabile quasi sempre una patch del veloce:
// la minor si prende dalla sua pagina, sotto il tag protetto. `nome` è come lo legge l'utente.
const PAGINA_DOWNLOAD = 'https://filo.red';
const PAGINA_RELEASE = 'https://github.com/sathyaram1/Filo/releases/tag/';
function doveScaricare(versione, canale) {
  const p = parti(versione);
  const url = canale === 'stabile' && p && p[2] === 0 ? `${PAGINA_RELEASE}v${p[0]}.${p[1]}.0` : PAGINA_DOWNLOAD;
  return { url, nome: url.replace('https://', '') };
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
// Una versione scaricata prima di passare al canale stabile, e che lì non esce, si dimentica.
function decidiAllAvvio({ piattaforma, versioneInUso, modo, pronto, installatoreValido = true, automatici = true, chiesta = null, canale = CANALE_PREDEFINITO } = {}) {
  const p = normalizza(pronto);
  const apri = (resta, avvisa = false) => ({ azione: 'apri', pronto: resta, avvisa });
  if (!p || !versioneDelCanale(p.versione, canale)) return apri(null);
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

// Solo i tag v* sono protetti su GitHub, e l'aggiornatore prende la release «più recente» qualunque tag abbia:
// una release sotto un altro tag, creata da un ramo, non si installa (#1073). Senza tag (provider non GitHub) passa.
function tagAccettato(info) {
  if (!info || info.tag == null) return true;
  return String(info.tag) === `v${info.version}`;
}

// Il tag della release più recente come lo dice GitHub: il «tag:» di latest.yml lo scrive chi crea la release (#1073).
function tagDiGitHubAccettato(tag, versione) {
  return typeof tag === 'string' && !!parti(versione) && tag === `v${versione}`;
}

function segmento(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

// Il tag e i percorsi dentro latest.yml li scrive chi ha creato la release: «tag: v99.0.0» e «../x1/…» portano
// altrove. Conta dove stanno davvero i file da scaricare: solo sotto il tag protetto v<versione> del nostro repo (#1073).
function fileDiRilascio({ versione, urls, owner, repo, host = 'github.com' } = {}) {
  if (!parti(versione) || !owner || !repo || !Array.isArray(urls) || !urls.length) return false;
  const attesi = [String(owner), String(repo), 'releases', 'download', `v${versione}`];
  return urls.every((u) => {
    let x;
    try { x = new URL(String(u)); } catch { return false; }
    if (x.protocol !== 'https:' || x.hostname !== host || x.username || x.password) return false;
    const seg = x.pathname.split('/').slice(1).map(segmento);
    const nome = seg[5];
    return seg.length === 6 && attesi.every((a, i) => seg[i] === a)
      && typeof nome === 'string' && nome !== '' && nome !== '.' && nome !== '..' && !/[/\\]/.test(nome);
  });
}

module.exports = {
  MODI, MODO_PREDEFINITO, TENTATIVI_DA_SOLI, CANALI, CANALE_PREDEFINITO,
  confrontaVersioni, etichettaCoincide, fileDellaRelease, releaseCoerente, modoScelto, piano, sceltaNonVale, haPulsante,
  canaleScelto, versioneDelCanale, tagStabile, PAGINA_DOWNLOAD, PAGINA_RELEASE, doveScaricare,
  ricordaScaricato, contaTentativo, decidiAllAvvio, fraseScaricato, tagAccettato, tagDiGitHubAccettato, fileDiRilascio,
};
