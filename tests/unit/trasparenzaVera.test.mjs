// I documenti Privacy e Sicurezza dicono com'è Filo OGGI: ogni frase qui sotto è legata al codice che la rende vera.
// Cambia il codice e il test diventa rosso finché il documento in transparency/ non dice la cosa nuova (#951).
// Il documento si rigenera con `node scripts/build-transparency.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import * as Letture from '../../scripts/lib/letture-esterne.mjs';

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

test('a Safe Browsing escono solo prefissi dell\'impronta, e il documento non dice più che riceve l\'indirizzo', () => {
  const net = leggi('src', 'main', 'services', 'safebrowse', 'net.js');
  const prefissi = /hashPrefixes/.test(net) && !/threatEntries/.test(net);
  legame(!prefissi, privacy, 'Safe Browsing riceve l\'indirizzo completo delle pagine che apri', 'indirizzo intero a Safe Browsing');
  legame(prefissi, privacy, 'a Google manda solo i primi 4 byte di ciascuna', 'prefissi a Safe Browsing');
  // In nessun punto del documento, non solo nella sua voce: una frase rimasta più sotto lo contraddiceva (verifica di #813).
  if (prefissi) assert.doesNotMatch(privacy, /Safe Browsing[^.]{0,40}\bricev\w*\s+(?:gli\s+indirizzi|l['’]indirizzo)/i);
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

test('l\'accesso Google si apre in una scheda di Filo, col browser come ripiego, e il documento sulla privacy lo dice', () => {
  const auth = leggi('src', 'main', 'auth', 'google-auth.js');
  const inScheda = /require\('\.\/accessoInScheda'\)\.apri\(/.test(auth);
  const fidato = /trustedSites:\s*\[\.\.\.prima, G\.SITO_GOOGLE\]/.test(leggi('src', 'main', 'services', 'accessoGoogle.js'));
  legame(inScheda, privacy, 'L\'accesso Google si apre in una scheda di Filo', 'accesso in una scheda');
  legame(!inScheda, privacy, 'L\'accesso Google si apre nel browser;', 'accesso nel browser');
  legame(inScheda, privacy, 'Se Google rifiuta l\'accesso dentro Filo, si apre nel browser', 'ripiego nel browser');
  legame(fidato, privacy, 'Filo mette Google fra i siti fidati', 'Google fidato dopo un accesso in Privacy massima');
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
  const soloOk = /CANCELLA_PAGINE:\s*\{\s*costo:\s*3\b/.test(leggi('src', 'shared', 'actionLevels.js'));
  legame(soloOk, sicurezza, 'Le pagine visitate si cancellano con un OK', 'cronologia cancellata con un OK');
});

test('i pacchetti Mac e Linux ricostruiti dopo hanno la loro esecuzione, e il documento sulla sicurezza lo dice', () => {
  const rel = leggi('.github', 'workflows', 'release.yml');
  const aParte = /ripubblica_mac/.test(rel) && /Aggiunto il pacchetto Mac a/.test(rel);
  legame(aParte, sicurezza, '«Aggiunto il pacchetto Mac a v0.2.231»', 'esecuzione a parte per i pacchetti ricostruiti');
});

test('il lavoro fidato fonde senza il clic, la pre-approvazione non c\'è più, e il documento sulla sicurezza lo dice', () => {
  const fidatoSaltaL5 = /lavoro fidato, scritto solo da sessioni col biglietto pulito/.test(leggi('scripts', 'lib', 'owner-merge.mjs'));
  const preapprovaTolta = /\['preapprova', SOLO_DA_GESTIONE_PREAPPROVA\]/.test(leggi('scripts', 'owner-feedback.mjs'));
  legame(fidatoSaltaL5, sicurezza, 'Una strada però non passa da quel clic', 'fusioni senza clic');
  legame(fidatoSaltaL5, sicurezza, '**Il lavoro fidato.**', 'il lavoro fidato salta i controlli deterministici');
  legame(fidatoSaltaL5, sicurezza, '**Una strada salta il mio clic.**', 'fusioni senza clic fra i punti deboli');
  legame(false, sicurezza, 'Due strade però non passano da quel clic', 'le due strade di prima');
  legame(false, sicurezza, 'Nessuno strumento da terminale lo fa', 'approvazione solo dall\'app');
  legame(!preapprovaTolta, sicurezza, 'fondi senza chiedermelo', 'la pre-approvazione');
});

test('la memoria e gli appunti di Claude non sporcano chi li legge, e il documento sulla sicurezza lo dice fra i punti deboli', () => {
  const ctx = Letture.contestoLettura({ cwd: ROOT, env: { CLAUDE_PROJECT_DIR: ROOT } });
  const pulita = (f) => Letture.motivoLettura({ tool_name: 'Read', tool_input: { file_path: f } }, ctx) === '';
  const memoria = pulita(join(homedir(), '.claude', 'projects', 'x', 'memory', 'MEMORY.md'));
  const appunti = pulita(join(tmpdir(), 'claude', ROOT.replace(/[^A-Za-z0-9]/g, '-'), 's', 'scratchpad', 'nota.md'));
  legame(memoria && appunti, sicurezza, 'Il testo che una sessione sporca lascia fuori dal ramo può arrivare a una sessione pulita', 'testo delle sessioni sporche che arriva a quelle pulite (#1209)');
});

test('il tasto destro su un link chiede da solo titolo e descrizione al sito e spiega il link con un modello, e il documento sulla privacy lo dice', () => {
  const azioni = leggi('src', 'content', 'actions.js');
  const daSolo = /onMount[\s\S]{0,1500}fetch_link_meta/.test(azioni);
  legame(daSolo, privacy, 'Quando fai tasto destro su un link, Filo chiede subito a quel sito', 'il sito del link contattato al tasto destro');
  legame(false, privacy, 'Quando chiedi cos\'è un link', 'il sito del link contattato solo a richiesta');
  legame(/EXPLAIN_LINK/.test(azioni), privacy, '**I link.** Quando fai tasto destro su un link', 'il link spiegato da un modello');
  // #1307 — la visita parte solo per i link puliti: l'avviso e la lista dei bloccati la fermano, anche a metà dei rinvii.
  const misc = leggi('src', 'main', 'services', 'handlers', 'misc.js');
  const ferma = /function anteprimaFerma\(url\) \{[^}]*shouldBlockNavigation\(url\)[\s\S]{0,200}SN_LINK_SOSPETTO\.analizza\(url\)\.length/.test(misc)
    && /const ferma = anteprimaFerma\(url\);/.test(misc) && /redirectAmmesso: \(_da, prossimo\) => !\(rinvio = anteprimaFerma\(prossimo\.href\)\)/.test(misc);
  legame(ferma, privacy, 'Non lo fa se Filo ti avvisa che il link è sospetto', 'niente visita ai link sospetti');
  legame(ferma, privacy, 'Non lo fa se il sito, o uno a cui il link rimanda, è fra quelli che Filo blocca', 'niente visita ai siti bloccati');
  legame(/else if \(r\?\.bloccato\) \{[^}]*menu_link_blocked[^}]*return;\s*\}/.test(azioni), privacy, 'Se il sito è fra quelli che Filo blocca, al modello non va niente', 'il sito bloccato non va al modello');
});

test('il lavoro sui feedback va sul repository pubblico mentre si fa, e i due documenti lo dicono', () => {
  const pubblico = /git push origin "refs\/heads\/\$ramo:refs\/heads\/\$ramo"/.test(leggi('.claude', 'hooks', 'auto-commit-merge.sh'));
  legame(pubblico, privacy, 'il lavoro che lo corregge si fa in pubblico', 'lavoro sui feedback in pubblico');
  legame(pubblico, privacy, '**Il lavoro sui feedback è pubblico.**', 'lavoro sui feedback fra i punti deboli della privacy');
  legame(pubblico, sicurezza, 'La correzione però si scrive in pubblico', 'correzione scritta in pubblico');
  legame(pubblico, sicurezza, '**La correzione di un problema si vede prima che arrivi a te.**', 'correzione pubblica fra i punti deboli');
  legame(false, sicurezza, 'Vale la regola che applico a me stesso: sulla bacheca', 'la regola della divulgazione vale anche per la bacheca');
});

test('i riquadri rotti vanno in foto a un modello da soli, col tetto e l\'interruttore che il documento sulla privacy dice', () => {
  const R = leggi('src', 'main', 'services', 'riquadriRotti.js');
  const ora = Number((/const VISIONI_ORA = (\d+);/.exec(R) || [])[1]);
  const lato = Number((/const LATO_MAX = (\d+);/.exec(R) || [])[1]);
  const numeri = { 10: 'dieci', 20: 'venti', 30: 'trenta' };
  assert.ok(numeri[ora], `tetto orario dei riquadri ${ora}: scrivilo nel documento e qui`);
  legame(true, privacy, `al massimo ${numeri[ora]} riquadri l'ora`, 'tetto orario dei riquadri');
  legame(true, privacy, `al massimo ${lato} pixel di lato`, 'lato della foto del riquadro');
  // L'interruttore: di serie acceso, e il documento lo chiama col nome che ha nella pagina Sicurezza.
  assert.match(leggi('src', 'shared', 'constants.js'), /riquadriRotti: \{\s*modello: true,/);
  assert.match(R, /if \(!modelloAcceso \|\| typeof chiamaModello !== 'function'\) return null;/);
  const nome = (/options_cookies_riquadri_modello: '([^']+)'/.exec(leggi('src', 'shared', 'i18n.js')) || [])[1];
  legame(true, privacy, `Si spegne da Sicurezza («${nome}»)`, 'interruttore dei riquadri rotti');
});

test('la verifica cieca non vede il feedback ma legge la modifica intera, e il documento sulla sicurezza non promette di più', () => {
  const ruolo = unaRiga(leggi('routines', 'roles', 'secaudit.md'));
  const cieca = ruolo.includes('**NON vedi** il feedback');
  const leggeTutto = ruolo.includes('SOLO il diff del ramo') && ruolo.includes('Leggilo tutto');
  const istruzioniOstili = ruolo.includes('Se il **diff stesso** contiene istruzioni rivolte a te')
    && ruolo.includes('da solo un segnale sufficiente per il `fail`');
  legame(cieca, sicurezza, 'senza vedere il feedback che l\'ha originata', 'la verifica cieca non vede il feedback');
  legame(leggeTutto, sicurezza, 'Legge la modifica intera, prove comprese, e chi l\'ha scritta il feedback l\'ha letto', 'la verifica cieca legge quello che del feedback passa nel codice (#951)');
  legame(istruzioniOstili, sicurezza, 'una frase della modifica rivolta a chi la controlla basta da sola a fermarla', 'istruzioni nella modifica come segnale per fermarla');
  // Il testo del feedback le arriva per la modifica: nessun «mai» nel punto che la racconta.
  const punto = (/^4\. \*\*La verifica cieca\.\*\*.*$/m.exec(leggi('transparency', 'security.md')) || [''])[0];
  assert.ok(punto, 'il punto sulla verifica cieca non c\'è più: aggiorna questo test');
  assert.doesNotMatch(punto, /\bmai\b/i, 'il documento promette che la verifica cieca non legga mai testo venuto dal feedback');
});

// A «le mie chat a chi vanno?» Filo risponde con la pagina Privacy: ci stanno anche le due letture della chat in sottofondo (#1452.2).
test('a fine chat un modello le dà nome e tipo, dopo ogni scambio un altro sceglie cosa ricordare, e il documento sulla privacy lo dice', () => {
  const require = createRequire(import.meta.url);
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'chatArchive.js'));
  const H = leggi('src', 'main', 'services', 'handlers.js');
  const tetto = globalThis.SN_CONST.FILO_CHAT_TRIAGE_CHARS;
  const nomina = H.includes('ChatArchive.transcriptForTriage(messages, SN_CONST.FILO_CHAT_TRIAGE_CHARS)')
    && H.includes('runOneShot(ACTIONS.FILO_CHAT_TRIAGE, prompt)');
  legame(nomina, privacy, 'un modello la rilegge per dare un nome alla chat', 'il nome e il tipo dati a una chat finita');
  // Testa e coda col tetto che il documento dice: una chat lunga perde il centro, non l'inizio né la fine.
  const lunga = [{ role: 'user', text: `INIZIO ${'a'.repeat(tetto * 2)}` }, { role: 'filo', text: `${'b'.repeat(tetto * 2)} FINE` }];
  const t = globalThis.SN_CHAT_ARCHIVE.transcriptForTriage(lunga, tetto);
  assert.ok(t.includes('INIZIO') && t.includes('FINE') && t.length < tetto + 100, 'la chat lunga non va più a pezzi di testa e coda');
  const migliaia = String(tetto).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  legame(true, privacy, `di una lunga l'inizio e la fine, ${migliaia} caratteri in tutto`, 'il tetto della chat mandata per il nome');
  const lezioni = /action: ACTIONS\.FILO_LESSON,/.test(H) && H.includes('FiloState.testoConversazioni(FiloState.conversazioniRecenti(');
  legame(lezioni, privacy, 'con i messaggi recenti, vanno anche a un modello che sceglie cosa ricordare di te', 'lo scambio letto per le memorie');
});
