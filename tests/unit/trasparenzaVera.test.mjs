// I documenti Privacy e Sicurezza dicono com'è Filo OGGI: ogni frase qui sotto è legata al codice che la rende vera.
// Cambia il codice e il test diventa rosso finché il documento in transparency/ non dice la cosa nuova (#951).
// Il documento si rigenera con `node scripts/build-transparency.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const unaRiga = (s) => s.replace(/\s+/g, ' ');
const privacy = unaRiga(leggi('transparency', 'privacy.md'));
const sicurezza = unaRiga(leggi('transparency', 'security.md'));

// Il codice dice `vero`: il documento deve contenere la frase. Il codice dice altro: la frase deve sparire.
function legame(vero, doc, frase, cosa) {
  assert.equal(doc.includes(frase), vero, vero
    ? `${cosa}: il documento non lo dice più («${frase}»)`
    : `${cosa} non è più vero: togli o riscrivi «${frase}»`);
}

test('la raccolta dei percorsi dell\'Aiuto è spenta, e il documento lo dice', () => {
  const spenta = /const RACCOLTA_ACCESA = false;/.test(leggi('src', 'main', 'services', 'pathsCollector.js'));
  legame(spenta, privacy, 'ma la raccolta è spenta', 'percorsi spenti');
});

test('il terminale è acceso di serie, e i due documenti lo dicono', () => {
  const acceso = /terminal:\s*\{\s*enabled:\s*true/.test(leggi('src', 'shared', 'constants.js'));
  legame(acceso, privacy, 'Il terminale è acceso di serie', 'terminale acceso di serie');
  legame(acceso, sicurezza, 'è acceso di serie', 'terminale acceso di serie');
});

test('Safe Browsing riceve l\'indirizzo intero, ed è fra i punti deboli', () => {
  const intero = /threatEntries:\s*\[\{\s*url:\s*rawUrl\s*\}\]/.test(leggi('src', 'main', 'services', 'safebrowse', 'net.js'));
  legame(intero, privacy, 'Safe Browsing riceve l\'indirizzo completo delle pagine che apri', 'indirizzo intero a Safe Browsing');
});

test('le richieste ai modelli non chiedono la ritenzione zero, ed è fra i punti deboli', () => {
  const chiede = /\bzdr\b|data_collection/.test(leggi('src', 'main', 'services', 'providers', 'openrouter.js'));
  legame(!chiede, privacy, 'non chiede ancora la ritenzione zero', 'ritenzione zero non richiesta');
});

test('del feedback restano in chiaro titolo della pagina e browser, e il documento lo dice', () => {
  const fb = leggi('src', 'shared', 'feedback.js');
  const chiaro = /title: toFsValue\(title \|\| ''\)/.test(fb) && /userAgent: toFsValue\(userAgent \|\| ''\)/.test(fb);
  const cifrati = /maybeEncrypt\(text \|\| ''\)/.test(fb) && /maybeEncrypt\(url \|\| ''\)/.test(fb);
  assert.ok(cifrati, 'testo e indirizzo del feedback non risultano più cifrati: il documento sulla privacy dice che lo sono');
  legame(chiaro, privacy, 'Restano in chiaro il titolo della pagina, browser e sistema', 'titolo e browser in chiaro');
  const nomiChiari = /uploadedFiles\.push\(\{[^}]*\bname: fname\b/.test(fb);
  legame(nomiChiari, privacy, 'i nomi dei file che alleghi', 'nomi dei file allegati in chiaro');
  legame(nomiChiari, privacy, 'lo pseudonimo e i nomi dei file allegati restano in chiaro', 'nomi dei file fra i punti deboli');
});

test('l\'installer non è firmato con un certificato, e il documento sulla sicurezza lo dice', () => {
  const build = JSON.parse(leggi('package.json')).build || {};
  const firmato = Boolean((build.win && (build.win.certificateFile || build.win.certificateSubjectName || build.win.azureSignOptions))
    || (build.mac && build.mac.identity));
  legame(!firmato, sicurezza, 'l\'installer non è firmato con un certificato', 'installer senza firma');
});

test('col login Google l\'app scrive email, nome e consumi sul server, e il documento sulla privacy lo dice', () => {
  const crediti = leggi('src', 'main', 'services', 'handlers', 'credits.js');
  const email = /fields\.email\s*=/.test(crediti) && /fields\.name\s*=/.test(crediti);
  const consumi = /SYNC_FIELDS\s*=\s*\[[^\]]*'byAction'/.test(crediti);
  legame(email, privacy, 'al server arrivano anche la tua email, il tuo nome', 'email e nome sul server col login');
  legame(email, privacy, 'email e nome finiscono accanto ai tuoi consumi', 'email e nome fra i punti deboli');
  legame(!email, privacy, 'I dati di Filo sul server (crediti, feedback, red team) ti conoscono solo', 'il server conosce solo un codice');
  legame(consumi, privacy, 'escono i totali per funzione', 'consumi per funzione sul server');
});

test('le ricerche su Google dal tasto destro sono fra gli altri servizi', () => {
  const azioni = leggi('src', 'content', 'actions.js');
  legame(/lens\.google\.com/.test(azioni), privacy, 'apre Google Lens', 'ricerca per immagine con Google Lens');
  legame(/google\.com\/search/.test(azioni), privacy, 'apre la ricerca di Google', 'ricerca del testo selezionato');
});

test('l\'Aiuto chiede al server i percorsi del sito, e il documento sulla privacy lo dice', () => {
  const chiede = /ACTIONS\.HELP[\s\S]{0,600}Paths\.listByDomain\(/.test(leggi('src', 'main', 'services', 'handlers.js'));
  legame(chiede, privacy, 'Filo chiede al server i percorsi già noti per quel sito', 'lettura dei percorsi dal server');
  legame(chiede, privacy, 'il nome del sito su cui apri l\'Aiuto', 'nome del sito fra le cose che arrivano al server');
  legame(chiede, privacy, 'Per chi usa l\'app fa cinque cose', 'i percorsi fra i compiti del server');
});

test('cancellare le pagine visitate chiede solo un OK, e il documento sulla sicurezza lo dice', () => {
  const soloOk = /CANCELLA_PAGINE:\s*\{\s*level:\s*2\b/.test(leggi('src', 'shared', 'actionLevels.js'));
  legame(soloOk, sicurezza, 'Le pagine visitate si cancellano con un OK', 'cronologia cancellata con un OK');
});

test('i pacchetti Mac e Linux ricostruiti dopo hanno la loro esecuzione, e il documento sulla sicurezza lo dice', () => {
  const rel = leggi('.github', 'workflows', 'release.yml');
  const aParte = /ripubblica_mac/.test(rel) && /Aggiunto il pacchetto Mac a/.test(rel);
  legame(aParte, sicurezza, '«Aggiunto il pacchetto Mac a v0.2.231»', 'esecuzione a parte per i pacchetti ricostruiti');
});

test('lavoro locale e pre-approvazione fondono senza il clic e partono dal terminale, e il documento sulla sicurezza lo dice', () => {
  const preapprova = /--preapprova/.test(leggi('scripts', 'owner-feedback.mjs'));
  const localeSaltaL5 = /L5 saltato/.test(leggi('scripts', 'lib', 'owner-merge.mjs'));
  legame(preapprova || localeSaltaL5, sicurezza, 'Due strade però non passano da quel clic', 'fusioni senza clic');
  legame(preapprova || localeSaltaL5, sicurezza, 'Due strade saltano il mio clic', 'fusioni senza clic fra i punti deboli');
  legame(false, sicurezza, 'Nessuno strumento da terminale lo fa', 'approvazione solo dall\'app');
  legame(localeSaltaL5, sicurezza, '**Il lavoro locale.**', 'il lavoro locale salta i controlli deterministici');
  legame(preapprova, sicurezza, '**Il segno «fondi senza chiedermelo».**', 'la pre-approvazione da terminale');
});

test('il tasto destro su un link chiede da solo titolo e descrizione al sito e spiega il link con un modello, e il documento sulla privacy lo dice', () => {
  const azioni = leggi('src', 'content', 'actions.js');
  const daSolo = /onMount[\s\S]{0,1500}fetch_link_meta/.test(azioni);
  legame(daSolo, privacy, 'Quando fai tasto destro su un link, Filo chiede subito a quel sito', 'il sito del link contattato al tasto destro');
  legame(false, privacy, 'Quando chiedi cos\'è un link', 'il sito del link contattato solo a richiesta');
  legame(/EXPLAIN_LINK/.test(azioni), privacy, '**I link.** Quando fai tasto destro su un link', 'il link spiegato da un modello');
});
