// Le porte d'uscita di Filo: conferme in sospeso, perimetro di lettura, giudizio sugli indirizzi, eliminazioni e
// rinomine preparate, il terminale. Libreria nata da handlers.js: le regole stanno in tests/unit/usciteSegreti.test.mjs.

const PageRead = require('./pageRead');
const { riquadroArrivato } = require('./riquadroArrivato');
const { spingiAllaScheda } = require('./impostazioniPerOrigine');
const { daFilo, origineDi, paginaNonDiFilo, daPaginaNonDiFilo } = require('./handlers/origine');
const SegretiLetti = require('./segretiLetti');
const VerdettiUscite = require('./verdettiUscite');
const ContatoriSicurezza = require('./contatoriSicurezza');
const { SN_CONST, SN_MSG } = globalThis;
const { MSG } = SN_MSG;
const Storage = globalThis.SN_STORAGE;
const FiloMem = globalThis.SN_FILO_MEMORY;
const { winOf, schedeLeggibili } = require('./handlersComuni');
const { getEffectiveSettings } = require('./impostazioniEffettive');
// Questi vivono in moduli che caricano questo: si chiedono al momento della chiamata, non al caricamento.
const decisioneAutonomia = (...a) => require('./autonomiaFonti').decisioneAutonomia(...a);

// ── cwd PERSISTENTE dei comandi dell'assistente ───────────────────────────────
// I comandi dell'assistente girano via runCommand one-shot (shell nuova ogni
// volta): senza traccia esplicita, ereditano la cwd del processo Electron (la
// cartella di Filo) e un `cd` non avrebbe effetto sul comando successivo. La
// teniamo per-webContents (muore con la scheda) con un fallback condiviso quando
// non c'è sender (test / chiamate interne). Parte da defaultCwd() = home, la
// STESSA mostrata nella barra della home → percorso mostrato e cartella reale
// coincidono. La shell PERSISTENTE della modalità terminale (src/main/services/
// shell.js) resta separata e off-limits all'LLM: qui non la tocchiamo.
// ⚠️ La cartella NON si appunta sul "mittente" del messaggio: quello è un
// oggetto costruito da capo a ogni messaggio che arriva da una pagina (vedi
// senderInfo in ipc.js). Appuntarcela sopra vuol dire dimenticarla appena
// l'utente scrive di nuovo — e, peggio, appena CONFERMA: la conferma di un
// comando è per forza un messaggio nuovo, quindi il comando che l'utente ha
// approvato leggendo «scriverò in questa cartella» girava nella sua cartella
// personale (#551, terzo giro di verifica). Quello che dura è la SCHEDA, cioè
// i suoi webContents: la teniamo lì, con una mappa debole, così l'appunto muore
// con la scheda come prima.
const _assistantCwdByTab = new WeakMap();
let _assistantCwdFallback = '';
// La scheda dietro a un mittente, se c'è. `wc` è il webContents grezzo che
// senderInfo porta con sé; un mittente costruito a mano dai test o dalle
// chiamate interne non ce l'ha, e allora si ripiega sul deposito condiviso.
function assistantCwdTab(sender) {
  const wc = sender && sender.wc;
  return wc && typeof wc === 'object' ? wc : null;
}
function getAssistantCwd(sender) {
  const { defaultCwd } = require('./shell');
  const tab = assistantCwdTab(sender);
  if (tab) return _assistantCwdByTab.get(tab) || defaultCwd();
  return _assistantCwdFallback || defaultCwd();
}
function setAssistantCwd(sender, cwd) {
  if (!cwd) return;
  const tab = assistantCwdTab(sender);
  if (tab) { try { _assistantCwdByTab.set(tab, cwd); return; } catch (_) {} }
  _assistantCwdFallback = cwd;
}

// La cartella in cui un comando girerà davvero: quella appuntata se c'è ancora,
// la home se è sparita (#551, quarto giro). La risposta la dà shell.js, perché
// sia la stessa che si dà il comando quando parte.
function cartellaDelComando(cwd) {
  try { return require('./shell').cartellaPerComando(cwd).cwd || cwd; } catch (_) { return cwd; }
}

// La home abbreviata in `~`: più corta e senza il nome utente, che altrimenti finirebbe
// nel popup che l'agente disegna dentro una pagina web qualsiasi.
function displayCwd(cwd) {
  const p = String(cwd || '');
  if (!p) return '';
  let home = '';
  try { home = require('node:os').homedir() || ''; } catch (_) {}
  if (home && (p === home || p.startsWith(`${home}/`) || p.startsWith(`${home}\\`))) {
    return `~${p.slice(home.length).replace(/\\/g, '/')}`;
  }
  return p;
}

// Corpus sensibile per il taint-match di NAVIGA (anti-esfiltrazione): i dati
// personali persistenti — memoria (profilo/preferenze/espansioni) e appunti.
// Ciò che il modello ha letto nel turno (comandi, documenti) lo aggiunge
// SN_URL_EXFIL.valutaNaviga dalle azioni viste. NON lo stato delle schede né le
// loro URL: un legittimo "riapri la scheda X" matcherebbe → falso positivo.
async function navExfilCorpus() {
  try {
    const mem = await FiloMem.getMemory();
    const { profilo, preferenze, espansioni } = FiloMem.renderMemoryForPrompt(mem);
    // Il materiale da proteggere è il contenuto dei file dell'editor (#379.10).
    let notes = '';
    try { const EF = require('./editorFiles'); notes = await EF.notesCorpusText(); } catch (_) {}
    return [profilo, preferenze, espansioni, notes].filter(Boolean).join('\n');
  } catch (_) { return ''; }
}

// ── Difesa in profondità sulle azioni confermate (#250) ─────────────────────
// FILO_CONFIRM_ACTION esegue un'azione con `confirmed:true`, saltando la
// sospensione dei livelli ≥ 2. È legittimo SOLO dopo il giro di conferma
// (RUN → popup di Filo → CONFIRM). Il canale è però raggiungibile anche dai
// content script delle pagine web esterne: oggi contextIsolation lo blocca, ma
// se quell'unico strato cadesse una pagina ostile potrebbe forgiare un
// FILO_CONFIRM_ACTION "a freddo" per attivare un'impostazione sensibile (es. la
// modalità terminale) SENZA che il popup sia mai apparso.
//
// Barriera: un'azione confermata da un'origine NON filo:// viene eseguita solo
// se quello stesso mittente ha PRIMA ricevuto la richiesta di conferma per la
// stessa azione (l'agente on-page: FILO_RUN_ACTION → popup → FILO_CONFIRM_ACTION).
// Le pagine interne filo:// (chat della dashboard) restano fidate per origine e
// non hanno bisogno del pending. Un CONFIRM forgiato senza il RUN corrispondente
// non ha un pending e viene rifiutato.
const pendingConfirms = new Map(); // key → { scade, mostrati }
const PENDING_CONFIRM_TTL = 5 * 60 * 1000;
// Ignora i campi iniettati dal main (prefisso `_`), così RUN e CONFIRM combaciano.
function actionSignature(action) {
  try {
    const clean = {};
    for (const k of Object.keys(action).sort()) {
      if (k.startsWith('_')) continue;
      clean[k] = action[k];
    }
    return JSON.stringify(clean);
  } catch (_) { return String(action && action.type || ''); }
}
function senderKey(sender) {
  return String(sender?.tab?.id ?? sender?.url ?? sender?.origin ?? '?');
}
function pendingConfirmKey(sender, action) {
  return `${senderKey(sender)}::${actionSignature(action)}`;
}
function recordPendingConfirm(sender, action) {
  const now = Date.now();
  // Purga opportunistica delle scadute (la mappa resta piccola).
  for (const [k, rec] of pendingConfirms) if (rec.scade <= now) pendingConfirms.delete(k);
  pendingConfirms.set(pendingConfirmKey(sender, action), {
    scade: now + PENDING_CONFIRM_TTL,
    mostrati: { righe: action._righe, targetIds: action._targetIds, proposte: action._proposte, nome: action._nomeSistema, indirizzo: action._indirizzoSistema, finestra: action._finestra, file: action._file },
  });
}
function consumePendingConfirm(sender, action) {
  const key = pendingConfirmKey(sender, action);
  const rec = pendingConfirms.get(key);
  if (!rec) return false;
  pendingConfirms.delete(key); // one-time
  return rec.scade > Date.now();
}
function daPaginaDiFilo(sender) {
  return daFilo(origineDi(sender), sender);
}
// La richiesta in cui una finestra guardata resta approvata (#778): la scheda della chat, finché l'utente non scrive di nuovo.
function chiaveSchermo(sender) {
  return String(sender?.wc?.id ?? senderKey(sender));
}
// All'OK si agisce su quello che il popup ha mostrato, non su ciò che lo stesso
// riferimento trova adesso: nel frattempo la lista può essere cambiata (#592).
// Una pagina di Filo rimanda l'azione col popup che ha mostrato; per le altre
// vale quello registrato alla richiesta di conferma.
function bersagliMostrati(sender, action) {
  if (daPaginaDiFilo(sender)) return { righe: action._righe, targetIds: action._targetIds, proposte: action._proposte, nome: action._nomeSistema, indirizzo: action._indirizzoSistema, finestra: action._finestra, file: action._file };
  const rec = pendingConfirms.get(pendingConfirmKey(sender, action));
  return rec && rec.scade > Date.now() ? rec.mostrati : null;
}

// Normalizza i sinonimi che un modello può produrre per riferirsi a una sveglia o a un
// timer; `tipo` restringe solo quando la richiesta lo dice.
function timerRefOf(action) {
  const a = action || {};
  const kindRaw = String(a.tipo ?? a.kind ?? a.genere ?? '').toLowerCase();
  const kind = /svegli|alarm/.test(kindRaw) ? 'alarm' : (/timer|countdown/.test(kindRaw) ? 'timer' : null);
  const allRaw = a.tutte ?? a.tutti ?? a.all;
  const all = allRaw === true || /^(true|1|si|sì|yes|tutte|tutti)$/i.test(String(allRaw ?? ''));
  return {
    id: a.id || null,
    label: String(a.etichetta ?? a.label ?? a.nome ?? a.riferimento ?? '').trim(),
    all,
    kind,
  };
}

// Voce in chiaro per il popup di conferma e per la risposta al modello.
function describeTimerEntry(t) {
  const label = t && t.label ? `“${t.label}”` : '(senza nome)';
  if (!t || t.kind !== 'alarm') return `Timer ${label}`;
  const d = new Date(t.endsAt);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const rep = (t.repeat && t.repeat.length && FiloMem.formatRepeat) ? FiloMem.formatRepeat(t.repeat) : '';
  return `Sveglia ${label} ${hhmm}${rep ? ` (${rep})` : ''}`;
}

// Etichetta scritta dal modello: finisce nel diario e nella colonna dei timer, va ripulita.
function cleanLabel(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

// Il perimetro di lettura del comando o documento (#587): lo decide il main,
// mai l'LLM, e lo sovrascrive sempre (gli argomenti del modello possono averne uno).
function perimetroLettura(sender, cartella = null) {
  let home = '';
  try { home = require('node:os').homedir() || ''; } catch (_) {}
  const win = process.platform === 'win32';
  let cwd = '';
  try { cwd = cartellaDelComando(cartella == null ? getAssistantCwd(sender) : cartella) || ''; } catch (_) {}
  let reti = [];
  try { reti = require('./shell').unitaDiRete(cwd); } catch (_) {}
  const perimetro = { cwd, home, win, maiuscole: win || process.platform === 'darwin', reti };
  // #892.2 — il classificatore chiede qui se un bersaglio c'è già. Non enumerabile: il perimetro resta un dato.
  Object.defineProperty(perimetro, 'esiste', { value: statoSulDisco });
  // #2292 — se le impostazioni del repository di una cartella possono avviare programmi anche a una lettura di git.
  const gitVisti = new Map();
  Object.defineProperty(perimetro, 'gitLancia', { value: (dir) => {
    if (!gitVisti.has(dir)) gitVisti.set(dir, require('./terminal').gitLanciaIn(dir));
    return gitVisti.get(dir);
  } });
  return perimetro;
}

// 'file', 'cartella', null se non c'è, 'ignoto' se il disco non risponde. I percorsi di rete li scarta prima chi chiede.
function statoSulDisco(p) {
  // Un'unità che porta a un altro computer non si guarda nemmeno (#1072): resta da chiedere.
  const u = /^([A-Za-z]):/.exec(String(p || ''));
  try { if (u && require('./shell').unitaDiRete(p).includes(`${u[1].toLowerCase()}:`)) return 'ignoto'; } catch (_) { return 'ignoto'; }
  try { return require('node:fs').statSync(p).isDirectory() ? 'cartella' : 'file'; } catch (e) {
    return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? null : 'ignoto';
  }
}

// La shell delle Preferenze che eseguirà i comandi dell'assistente, già risolta per questo sistema.
async function shellDeiComandi() {
  let settings = {};
  try { settings = await Storage.getSettings(); } catch (_) {}
  return require('./terminal').resolveShell(settings.terminal && settings.terminal.shell);
}

async function segretiCustoditi() {
  let salvate = {};
  let effettive = {};
  let chiaveFeedback = null;
  try { salvate = await Storage.getSettings(); } catch (_) {}
  try { effettive = await getEffectiveSettings(); } catch (_) {}
  try { chiaveFeedback = await require('./chiaveFeedback').getPrivateKey(); } catch (_) {}
  return require('./segretiCustoditi').custoditi({ impostazioni: [salvate, effettive], chiaveFeedback });
}

// Quello che l'assistente vede nella schermata, non solo il testo in chiaro: riquadri, caselle, parti
// incapsulate (#810). Un riquadro interno si legge nel suo mondo: un sito ostile nasconde solo sé stesso.
const MONDO_USCITE = 1002;
const MAX_TESTO_PAGINA = 8000000;
const MAX_RIQUADRI = 60;
const LEGGI_PAGINA_JS = `(function(){try{
var out=[String(document.title||''),String((document.body&&document.body.innerText)||'')];
var NO={hidden:1,checkbox:1,radio:1,file:1,submit:1,button:1,reset:1,image:1,range:1,color:1};
function etichetta(c){var t='';try{if(c.labels&&c.labels.length)t=c.labels[0].innerText||'';}catch(e){}
if(!t)t=c.getAttribute('aria-label')||c.getAttribute('placeholder')||c.getAttribute('title')||'';
if(!t&&c.previousElementSibling)t=c.previousElementSibling.innerText||'';
if(!t&&c.parentElement)t=c.parentElement.innerText||'';return String(t).slice(-120);}
function campi(root){var cc=root.querySelectorAll('input,textarea');for(var i=0;i<cc.length&&i<5000;i++){var c=cc[i];
if(NO[String(c.type||'').toLowerCase()])continue;var v=String(c.value||'');if(v.trim())out.push(etichetta(c)+' '+v);}}
var visti=0;function ombre(root,n){if(n>8)return;var tt=root.querySelectorAll('*');
for(var i=0;i<tt.length&&visti<300000;i++){visti++;var sr=tt[i].shadowRoot;if(!sr)continue;
for(var k=0;k<sr.children.length;k++){var e=sr.children[k];out.push(String(e.innerText||e.textContent||''));}
campi(sr);ombre(sr,n+1);}}
campi(document);ombre(document,0);return out.join('\\n');}catch(e){return '';}})()`;
async function testoDellaPagina(sender) {
  const url = String(sender?.tab?.url || sender?.url || '');
  const wc = sender?.wc;
  if (!daPaginaNonDiFilo(sender) || !wc || wc.isDestroyed?.()) return null;
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  const leggi = (avvia) => {
    let p;
    try { p = Promise.resolve(avvia()); } catch (_) { return Promise.resolve(''); }
    return Promise.race([
      p.catch(() => ''),
      new Promise((res) => { const t = setTimeout(() => res(''), 3000); t.unref?.(); }),
    ]);
  };
  SegretiLetti.primaDiLeggere(wc);
  const letture = [leggi(() => wc.executeJavaScriptInIsolatedWorld(MONDO_USCITE, [{ code: LEGGI_PAGINA_JS }]))];
  let riquadri = [];
  try { riquadri = (wc.mainFrame && wc.mainFrame.framesInSubtree) || []; } catch (_) {}
  for (const f of riquadri) {
    if (letture.length > MAX_RIQUADRI) break;
    if (f === wc.mainFrame || !riquadroArrivato(f)) continue;
    letture.push(leggi(() => f.executeJavaScript(LEGGI_PAGINA_JS)));
  }
  const testo = (await Promise.all(letture)).map((t) => String(t || '')).filter((t) => t.trim()).join('\n\n');
  return { testo: testo.length > MAX_TESTO_PAGINA ? testo.slice(-MAX_TESTO_PAGINA) : testo, host };
}

// I segreti che l'assistente ha avuto davanti qui (#810): la pagina può cambiare senza ricaricarsi, il
// codice letto prima resta. Si svuota a ogni caricamento, quando anche l'assistente ricomincia.
const LETTI_DALL_AIUTO = new WeakMap();
const MAX_LETTI_AIUTO = 50000;
// `payload` è la richiesta dell'assistente: il sommario degli elementi (etichette e valori che il
// testo della pagina non ha) e i risultati di una sua ricerca entrano anche loro nel contesto.
async function ricordaLettoDallAiuto(sender, payload = null) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const wc = sender?.wc;
  if (!G || !wc) return;
  const p = await testoDellaPagina(sender);
  const dallaPagina = globalThis.SN_URL_EXFIL.fonteDallaPagina(p && p.host);
  // Quello che l'utente ha immesso qui lo ferma la porta di questa pagina, ma il registro che resta non lo tiene (#810.8).
  const fonti = [{ testo: p ? p.testo : '', fonte: dallaPagina }];
  if (payload && typeof payload.outline === 'string') fonti.push({ testo: payload.outline, fonte: dallaPagina });
  const risultati = payload && payload.esterno && payload.esterno.ricercaWeb && payload.esterno.ricercaWeb.results;
  if (Array.isArray(risultati)) {
    const t = risultati.filter(Boolean).map((r) => `${r.title || ''}\n${r.url || ''}\n${r.snippet || ''}`).join('\n');
    fonti.push({ testo: t, fonte: 'dai risultati di una ricerca' });
  }
  const documenti = payload && payload.esterno && payload.esterno.documenti && payload.esterno.documenti.risultati;
  if (Array.isArray(documenti)) {
    const t = documenti.filter(Boolean).map((r) => `${r.nome || ''}\n${r.inizio || ''}\n${r.squarcio || ''}`).join('\n');
    fonti.push({ testo: t, fonte: 'dai documenti trovati sul disco' });
  }
  let reg = LETTI_DALL_AIUTO.get(wc);
  if (!reg) {
    reg = SegretiLetti.registro(MAX_LETTI_AIUTO);
    LETTI_DALL_AIUTO.set(wc, reg);
    try { wc.on('did-navigate', () => reg.svuota()); } catch (_) {}
  }
  for (const f of fonti) {
    if (typeof f.testo !== 'string' || !f.testo.trim()) continue;
    const trovati = G.segretiNelTesto(f.testo);
    reg.aggiungiTutti(trovati, f.fonte);
    SegretiLetti.aggiungiTutti(trovati, f.fonte);
  }
}


function ricordaLettoInChat(azioni, storia = []) {
  const Exfil = globalThis.SN_URL_EXFIL;
  if (Exfil) for (const e of Exfil.contestoDaAzioni(azioni).esterni) SegretiLetti.ricorda(e.testo, e.fonte);
  // Di una frase di Filo conta solo ciò che veniva da fuori quando l'ha scritta: una password che propone lui
  // resta sua. L'esito di un comando lanciato a mano invece è testo di fuori per intero.
  for (const m of Array.isArray(storia) ? storia : []) {
    if (!m || m.role !== 'filo') continue;
    for (const x of Array.isArray(m.letti) ? m.letti.slice(0, 200) : []) {
      if (x && typeof x.valore === 'string') SegretiLetti.aggiungi({ valore: x.valore, regola: String(x.regola || 'codice') }, String(x.fonte || 'da fuori'));
    }
    if (typeof m.esterno === 'string' && m.esterno && typeof m.text === 'string') SegretiLetti.ricorda(m.text, m.esterno);
  }
}

// Le azioni hanno portato nel contesto testo che non ha scritto né l'utente né Filo: un file, un documento, l'esito
// di un comando, una ricerca, una chat archiviata. Senza il modulo che lo sa dire, si assume di sì.
function testoDiAltriNelleAzioni(azioni) {
  const Exfil = globalThis.SN_URL_EXFIL;
  if (!Exfil) return true;
  const c = Exfil.contestoDaAzioni(azioni);
  return c.nonFidato || !!String(c.letto || '').trim();
}

function lettiDallAiuto(sender) {
  const reg = sender?.wc ? LETTI_DALL_AIUTO.get(sender.wc) : null;
  return reg ? reg.tutti() : [];
}

// La porta unica delle uscite (#810, regole in src/shared/urlExfil.js → valutaUscita): la
// chiamano executeFiloAction e la ricerca dell'assistente di pagina, prima di ogni livello.
// Non lancia mai: su un guasto torna un blocco con `regola: 'guasto'` (#1505, verdettiUscite.js). Ogni blocco si conta
// fra le uscite fermate qui dentro (#1474); chi giudica un collegamento prima del clic passa `soloGiudizio`.
const controllaUscita = ContatoriSicurezza.contaUscite(VerdettiUscite.chiudiAGuasto(giudicaUscita, {
  avvisa: (e) => console.warn('[Filo] controllo delle uscite non riuscito', e?.message || e),
}));
// Trascrivere un indirizzo lo scarica come leggerlo (#519): stessa regola d'uscita.
const comeLettura = (tipo) => tipo === 'LEGGI_PAGINA' || tipo === 'TRASCRIVI_MEDIA';
async function giudicaUscita(action, { sender = null, contesto = null, provenienza = null, parole = '', domanda = '' } = {}) {
  const Exfil = globalThis.SN_URL_EXFIL;
  const tipo = String((action && action.type) || '').toUpperCase();
  if (!Exfil || !Exfil.verboUscita(tipo)) return { blocca: false, exfil: false };
  const daPagina = daPaginaNonDiFilo(sender);
  const indirizzo = (tipo === 'NAVIGA' || comeLettura(tipo)) ? globalThis.SN_ACTION_LEVELS.indirizzoDi(action) : '';
  const delComando = tipo === 'ESEGUI_COMANDO' ? Exfil.indirizziDelComando(action) : [];
  let memoria = '';
  if (tipo === 'NAVIGA' || tipo === 'CERCA_WEB' || tipo === 'IMMAGINI_WEB' || comeLettura(tipo) || delComando.length) {
    const riservato = [indirizzo, ...delComando].filter(Boolean).map((u) => PageRead.materialeRiservato(u));
    memoria = [await navExfilCorpus(), ...riservato].filter(Boolean).join('\n');
  }
  const azioni = Array.isArray(contesto) ? contesto : [];
  const testoParole = typeof parole === 'string' ? parole : '';
  const v = Exfil.valutaUscita(action, {
    segreti: await segretiCustoditi(),
    azioni,
    pagina: daPagina ? await testoDellaPagina(sender) : null,
    letti: (daPagina ? lettiDallAiuto(sender) : []).concat(SegretiLetti.tutti()),
    parole: testoParole,
    domanda: typeof domanda === 'string' ? domanda : '',
    memoria,
    daPagina,
  });
  if (v.blocca || !provenienza) return v;
  // Un comando che va in rete: la stessa regola per ogni indirizzo che contatta (#2293). Il peggiore decide.
  if (tipo === 'ESEGUI_COMANDO') {
    const lista = Array.isArray(v.indirizzi) ? v.indirizzi : [];
    if (!lista.length || !testoDiSconosciuti(azioni)) return v;
    const esiti = [];
    for (const x of lista) esiti.push(await indirizzoScritto(tipo, x.url, { ...v, exfil: x.exfil, reason: x.reason }, { sender, azioni, provenienza, testoParole, memoria }));
    const mai = esiti.find((e) => e.nonCompare);
    const dati = esiti.find((e) => e.exfil || (e.nonCompare && e.datiReason));
    if (mai) return { ...v, exfil: false, reason: '', nonCompare: true, insiste: esiti.some((e) => e.insiste), datiReason: dati ? (dati.datiReason || dati.reason) : '' };
    return { ...v, exfil: !!dati, reason: dati ? dati.reason : '' };
  }
  if (!indirizzo) return v;
  // Si giudica l'indirizzo che partirà: senza «https://», fra virgolette o con due barre, lettura e apertura lo completano.
  const web = indirizzoCaricato(tipo, indirizzo);
  if (!/^https?:/i.test(web)) return v;
  // La regola dell'indirizzo scritto (#553, decisione su D-20) vale solo dopo che nella chat è entrato testo di
  // sconosciuti: prima nessuno può aver dettato al modello dove portare i dati.
  if (!testoDiSconosciuti(azioni)) return v;
  return indirizzoScritto(tipo, web, v, { sender, azioni, provenienza, testoParole, memoria });
}

// Compare → costo 1; dall'elenco dei siti o dal modulo di ricerca di un sito → le parole come una ricerca sul web;
// scritto dal modello → costo 3, con un OK (#553).
async function indirizzoScritto(tipo, web, v, { sender, azioni, provenienza, testoParole, memoria }) {
  const schede = schedeLeggibili(sender);
  // Una pagina che la lettura trova aperta in una scheda si legge da lì: niente esce.
  if (comeLettura(tipo) && PageRead.trovaScheda(web, schede)) return { ...v, exfil: false, reason: '' };
  if (!provenienza.cronologia) provenienza.cronologia = PageRead.chiaviCronologia(await indirizziDellaCronologia());
  const ver = PageRead.verificaIndirizzo(provenienza, web, {
    schede: schede.flatMap((x) => [x.url, urlDellaScheda(x)]), cronologia: provenienza.cronologia, parole: testoParole,
    scaricata: comeLettura(tipo),
  });
  if (ver.compare) return { ...v, exfil: false, reason: '' };
  if (ver.sito) {
    const r = globalThis.SN_URL_EXFIL.valutaRicerca(ver.sito.parole, { memoria, azioni });
    return { ...v, exfil: r.exfil, reason: r.reason };
  }
  // Se il controllo di prima ci vede dei dati, il pannello lo dice.
  return { ...v, exfil: false, reason: '', nonCompare: true, insiste: ver.insiste, datiReason: v.exfil ? v.reason : '' };
}

function testoDiSconosciuti(azioni) {
  try { return !!globalThis.SN_URL_EXFIL.contestoDaAzioni(Array.isArray(azioni) ? azioni : []).nonFidato; } catch (_) { return true; }
}

function indirizzoCaricato(tipo, indirizzo) {
  if (tipo === 'LEGGI_PAGINA') return PageRead.normalizzaUrl(indirizzo).url || '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(indirizzo)) return indirizzo;
  return (globalThis.SN_URL_NAV && globalThis.SN_URL_NAV.normalizeUrl && globalThis.SN_URL_NAV.normalizeUrl(indirizzo)) || '';
}

function urlDellaScheda(s) {
  try { return String(s.wc.getURL() || ''); } catch (_) { return ''; }
}

// Le pagine della cronologia (il filo delle visite): un indirizzo già visitato non è scritto dal modello (#553).
async function indirizziDellaCronologia() {
  try {
    const F = globalThis.SN_IL_FILO;
    const pagine = F && F.pagine ? await F.pagine({ da: null, a: null }) : [];
    return pagine.map((p) => p && p.url).filter(Boolean);
  } catch (_) { return []; }
}

// Il rilevatore dei siti pericolosi per una lettura: la porta della finestra di chi chiede, che sa dell'incognito.
function analizzaPer(sender) {
  const tm = winOf(sender)?._filoTabs;
  return tm && typeof tm._sbAnalizza === 'function' ? (u, ctx) => tm._sbAnalizza(u, ctx) : null;
}

// Il modello conosce le azioni come strumento(azione), non per tipo.
const chiamataPerModello = (type) => (globalThis.SN_ACTION_TOOLS ? globalThis.SN_ACTION_TOOLS.chiamata(type) : type);

// Cosa sente il modello quando l'indirizzo che ha scritto non compare da nessuna parte (#553).
function rifiutoNonCompare(type) {
  const verbo = type === 'LEGGI_PAGINA' ? 'letto' : 'aperto';
  return `Azione ${chiamataPerModello(type)} NON fatta: l'indirizzo l'hai scritto tu e non compare da nessuna parte (nelle parole dell'utente, `
    + 'nei risultati, nelle pagine lette o nei loro link, nelle schede, nella cronologia). Non l\'ho ' + verbo + '. Trovalo: '
    + 'cercalo con web(cerca) o segui un link di una pagina letta, e usa l\'indirizzo esatto. Per un sito comune puoi '
    + 'usare la sua home o la sua ricerca, oppure cerca_nel_sito con la home del sito '
    + 'che l\'utente ha nominato. Se richiami lo stesso indirizzo, lo chiedo all\'utente. Se non lo trovi, diglielo: '
    + 'sotto la risposta resta il bottone per aprirlo lui, se vuole.';
}

// «Cerca X sul sito Y» (#553): dall'elenco dei siti comuni, o dal modulo di ricerca della home del sito. L'indirizzo
// che ne esce lo costruisce Filo, e le parole passano dal controllo della ricerca sul web. Senza modulo, o con un sito
// che dopo testo di sconosciuti l'utente non ha nominato, il modello può scrivere lui l'indirizzo: arriva il pannello.
async function ricercaNelSito(action, { provenienza, contesto = null, parole = '', sender = null } = {}) {
  const q = String(action.cerca_nel_sito ?? action.cercaNelSito ?? '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const Levels = globalThis.SN_ACTION_LEVELS;
  const home = Levels.indirizzoDi(action);
  const type = String(action.type || '').toUpperCase();
  if (!/^https?:\/\//i.test(home)) {
    return { executed: false, kept: false, rejected: true, error: 'per cerca_nel_sito metti in url la home del sito (https://…)' };
  }
  const dallElenco = globalThis.SN_SITI_COMUNI.costruisci(home, q);
  if (dallElenco) {
    for (const k of ['url', 'href', 'link', 'indirizzo']) delete action[k];
    action.url = dallElenco;
    return null;
  }
  // Le parole vanno a chi possiede il sito. Dopo testo di sconosciuti il sito deve averlo nominato l'utente: uno che
  // compare solo in una pagina letta o nei risultati può averlo scelto chi ha scritto quella pagina.
  if (testoDiSconosciuti(contesto)) {
    const sue = PageRead.contestoChat();
    PageRead.annotaLink(sue, parole);
    if (!PageRead.verificaIndirizzo(sue, home, { parole }).compare) {
      return {
        executed: false,
        kept: false,
        rejected: true,
        senzaModulo: true,
        error: `Azione ${chiamataPerModello(type)} NON fatta: cerca_nel_sito vale per i siti comuni e per i siti che l'utente ha nominato, e ${home} `
          + 'non è fra questi. Se serve, scrivi tu l\'indirizzo della ricerca di quel sito: prima di aprirlo lo chiedo all\'utente. '
          + 'Oppure cerca la pagina con web(cerca).',
        output: { senzaModulo: true, url: home },
      };
    }
  }
  const modulo = await PageRead.moduloDellaHome(home, { analizza: analizzaPer(sender) });
  if (!modulo) {
    return {
      executed: false,
      kept: false,
      rejected: true,
      senzaModulo: true,
      error: `Azione ${chiamataPerModello(type)} NON fatta: nella home ${home} non trovo un modulo di ricerca. Se serve, scrivi tu l'indirizzo della `
        + 'ricerca di quel sito: prima di aprirlo lo chiedo all\'utente. Oppure cerca la pagina con web(cerca).',
      output: { senzaModulo: true, url: home },
    };
  }
  const url = PageRead.urlConParole(modulo, q);
  PageRead.annotaRicerca(provenienza, url, q);
  for (const k of ['url', 'href', 'link', 'indirizzo']) delete action[k];
  action.url = url;
  return null;
}

// Un indirizzo che una pagina di Filo apre o passa al sistema l'ha scelto quasi sempre un modello (#810): passa dalla
// porta qualunque gesto l'abbia chiesto (clic, menu del tasto destro, posta). Fermato, la pagina lo dice se `avvisa`.
const SCHEMI_USCITA = /^(?:https?|mailto|tel|sms):/i;

// #868.6 — un collegamento che un modello scrive, cliccato, chiede lo stesso OK che chiederebbe se lo aprisse lui. Il
// verdetto lo dà chi ha il contesto quando il collegamento nasce (risposta della chat, home); al clic lo si ritrova
// nel registro di verdettiUscite.js, che vale anche per icona e anteprima (#1505).
const sitoDaConfermare = (url) => VerdettiUscite.sitoDaConfermare(url);
// Prima del clic (icona, anteprima) un indirizzo si contatta solo se al clic si aprirebbe senza OK (#1505). Da una pagina
// di Filo decide il registro; da un sito, per un collegamento non suo (`delSito` falso), anche la decisione di apriDaFilo.
async function contattabilePrimaDelClic(url, { sender = null, daFilo = false, proposta = false, delSito = false, porta = null } = {}) {
  if (!VerdettiUscite.contattabile(url, { proposta: daFilo && proposta })) return false;
  if (daFilo || delSito) return true;
  const u = porta || await controllaUscita({ type: 'NAVIGA', url }, { sender, soloGiudizio: true });
  return !u.blocca && !(await exfilChiedeOk(String(url || ''), u, { wc: sender?.wc || null, pagina: paginaDi(sender?.wc) || sender?.url || '' }));
}
const ricordaVerdettiArchiviati = (messages) => VerdettiUscite.ricordaArchiviati(messages, indirizziCliccabili);
// Le richieste di OK mostrate a una pagina web: solo quella pagina, per quel link, può tornare con l'OK (#250).
const OK_CHIESTI_AI_SITI = new WeakMap(); // wc → Set di chiavi

const LINK_NEL_TESTO = /https?:\/\/[^\s<>"'`)\]]+/gi;
const ENTITA_HREF = { '&amp;': '&', '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };
// Gli indirizzi che la chat rende cliccabili, presi dallo stesso disegnatore che li disegna: ogni differenza fra come
// li legge il controllo e come diventano collegamenti era una porta (#868.6). Il testo nudo resta, per gli altri disegni.
function indirizziCliccabili(testo) {
  const t = String(testo || '');
  const out = [...t.matchAll(LINK_NEL_TESTO)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
  try {
    if (!globalThis.SN_MARKDOWN) require('../../shared/filoMarkdown.js');
    const html = globalThis.SN_MARKDOWN.render(t);
    for (const m of html.matchAll(/<a [^>]*href="([^"]*)"/g)) out.push(m[1].replace(/&(?:amp|#39|quot|lt|gt);/g, (e) => ENTITA_HREF[e]));
  } catch (_) {}
  return out;
}
// I collegamenti web di un testo scritto da un modello che, aperti da lui con questo contesto, chiederebbero l'OK.
// `indirizzi` = quelli dei bottoni che il modello ha messo sotto la risposta, cliccabili come i collegamenti.
// Il giudizio sta in verdettiUscite.js (giudica): una porta guasta o un collegamento oltre il tetto chiedono l'OK.
async function linkCheChiedonoOk(testo, { sender = null, contesto = null, provenienza = null, fontiLette = null, parole = '', domanda = '', richiesta = '', origine = 'chat', sempre = false, indirizzi = [] } = {}) {
  const Levels = globalThis.SN_ACTION_LEVELS;
  let impostazioni = null;
  return VerdettiUscite.giudica([...indirizzi, ...indirizziCliccabili(testo)], {
    porta: (url) => controllaUscita({ type: 'NAVIGA', url }, { sender, contesto, provenienza, parole, domanda, soloGiudizio: true }),
    chiede: async (url, u) => {
      if (sempre || !Levels) return true;
      if (!impostazioni) { try { impostazioni = await Storage.getSettings(); } catch (_) { impostazioni = {}; } }
      const verdetto = u.nonCompare ? { _nonCompare: true } : { _exfil: true };
      const ing = Levels.ingressi({ type: 'NAVIGA', url, ...verdetto, _exfilReason: u.reason }, { richiesta, impostazioni });
      return !ing || decisioneAutonomia(ing, { sender, contesto, fontiLette, assistente: false, origine, dentroPerimetro: ing.dentroPerimetro, impostazioni }).risposta !== 'si';
    },
  });
}

function paginaDi(wc) {
  try { return wc && !wc.isDestroyed?.() ? String(wc.getURL() || '') : ''; } catch (_) { return ''; }
}

// Sopra una pagina web l'agente ha letto la pagina: un dato dell'utente in un collegamento di Filo chiede l'OK come per
// NAVIGA. La stessa domanda la fa l'anteprima prima del clic (contattabilePrimaDelClic).
async function exfilChiedeOk(indirizzo, u, { wc = null, pagina = '' } = {}) {
  if (!u || !u.exfil || !paginaNonDiFilo(pagina) || !/^https?:/i.test(indirizzo)) return false;
  const Levels = globalThis.SN_ACTION_LEVELS;
  let impostazioni = {};
  try { impostazioni = await Storage.getSettings(); } catch (_) {}
  const ing = Levels ? Levels.ingressi({ type: 'NAVIGA', url: indirizzo, _exfil: true, _exfilReason: u.reason }, { impostazioni }) : null;
  return !ing || decisioneAutonomia(ing, { sender: { wc, url: pagina }, assistente: true, dentroPerimetro: ing.dentroPerimetro, impostazioni }).risposta !== 'si';
}

// `proposta`: il collegamento l'ha scritto un modello in una pagina di Filo (src/shared/filoMarkdown.js): se non ha un
// verdetto, perché la risposta si è interrotta o nessuno l'ha giudicato, chiede l'OK (#1505).
async function apriDaFilo(url, { wc = null, parole = '', apri, avvisa = true, tipo = 'NAVIGA', chiedi = '', confermato = false, proposta = false } = {}) {
  const indirizzo = String(url || '').trim();
  const pagina = paginaDi(wc);
  const u = await controllaUscita({ type: tipo, url: indirizzo }, { sender: wc ? { wc, url: pagina } : null, parole });
  if (u.blocca) {
    if (avvisa && wc) spingiAllaScheda(wc, { type: MSG.USCITA_FERMATA, frase: u.frase }, { inVista: true });
    return { aperto: false, frase: u.frase };
  }
  const daSito = paginaNonDiFilo(pagina);
  const k = VerdettiUscite.chiave(indirizzo);
  const v = /^https?:/i.test(indirizzo) ? VerdettiUscite.alClic(indirizzo, { chiedi, proposta }) : { daChiedere: false, motivo: '' };
  const motivo = v.motivo;
  const daChiedere = v.daChiedere || await exfilChiedeOk(indirizzo, u, { wc, pagina });
  if (daChiedere) {
    const chiesti = daSito && wc ? (OK_CHIESTI_AI_SITI.get(wc) || new Set()) : null;
    const ok = confermato && (!chiesti || chiesti.delete(k));
    if (!ok) {
      // Un OK arrivato senza la domanda non ne apre una: altrimenti due OK forgiati di fila aprirebbero.
      if (chiesti && !confermato) { chiesti.add(k); OK_CHIESTI_AI_SITI.set(wc, chiesti); }
      const Levels = globalThis.SN_ACTION_LEVELS;
      const azione = { type: 'NAVIGA', url: indirizzo, _exfil: true, _exfilReason: motivo || u.reason || '' };
      return { aperto: false, conferma: Levels ? Levels.describe(azione) : indirizzo, ...(Levels ? { parti: Levels.describeParts(azione) } : {}) };
    }
  }
  if (typeof apri === 'function') apri();
  return { aperto: true };
}
// tabs.js non vede i gestori: le aperture delle pagine di Filo (window.open, link con target) arrivano da qui.
globalThis.SN_USCITA_DA_FILO = (url, wc, apri) => (SCHEMI_USCITA.test(String(url || '')) ? apriDaFilo(url, { wc, apri }) : (apri(), Promise.resolve({ aperto: true })));

// `contesto` = le azioni (con il loro `_output`) che il modello ha davanti in
// questo turno, turni passati compresi: servono all'anti-esfiltrazione di NAVIGA.
// Vero finché la chat non ha MOSTRATO la frase sul terminale: il segno lo mette
// chi la disegna, così un turno perso a metà (scheda chiusa, ricarica) non la brucia.
async function primaVoltaDelTerminale() {
  try { return (await Storage.getRaw(SN_CONST.STORAGE_KEYS.FILO_TERMINALE_SPIEGATO, false)) !== true; } catch (_) { return false; }
}

// #874 — l'azione della chat nella forma che capiscono i tasti della home: il tipo dice cosa, il resto passa.
// L'indirizzo Bluetooth no: vale solo per i tasti di Filo, e a scriverlo qui sarebbe il modello, che sceglie un
// dispositivo mentre la conferma ne nomina un altro (#2394.1).
function richiestaDiSistema(type, action) {
  const { _richiestaSistema, _nomeSistema, _indirizzoSistema, indirizzo, ...resto } = action || {};
  return { ...resto, cosa: type === 'VOLUME' ? 'volume' : type === 'WIFI' ? 'wifi' : 'bluetooth' };
}

// Parte la rete o il dispositivo che la conferma ha nominato: il nome vero, non le parole del modello, e per il
// Bluetooth l'indirizzo che il main ha trovato con quel nome.
function richiestaDaEseguire(type, action) {
  const r = richiestaDiSistema(type, action);
  const nome = action && action._nomeSistema;
  if (nome && type === 'WIFI') return { ...r, rete: nome };
  if (nome && type === 'BLUETOOTH') {
    const ind = action._indirizzoSistema;
    return { ...r, dispositivo: nome, ...(typeof ind === 'string' && ind ? { indirizzo: ind } : {}) };
  }
  return r;
}

// L'esito col numero e i nomi VERI. I nomi di reti e dispositivi li sceglie chi li gestisce: tornano in busta, e la
// frase per un errore si compone senza nomi.
function esitoSistemaPerModello(o) {
  const E = globalThis.SN_ESTERNO;
  const busta = (righe) => E.imbusta({ tipo: 'NOMI_DISPOSITIVI', testo: righe.map((r) => `- ${E.neutralizza(r, { unaRiga: true })}`).join('\n') });
  const C = require('./comandiSistema');
  if (!o.ok) {
    if (o.errore === 'richiesta') return `Non fatto: ${o.frase}. Correggi i parametri e riprova.`;
    const s = C.spiega(o.errore, { cosa: o.cosa });
    const apri = s.apri ? ' Sotto la tua risposta l\'utente trova il tasto che apre quelle impostazioni: diglielo.' : '';
    const nomi = Array.isArray(o.candidati) && o.candidati.length
      ? `\nI nomi che il sistema conosce:\n${busta(o.candidati)}\nSe uno è quello che l'utente intende, richiama con quel nome; altrimenti chiediglielo.`
      : '';
    const quale = o.dispositivo || o.rete ? `\nRiguarda:\n${busta([o.dispositivo || o.rete])}` : '';
    const acceso = o.accesoPrima ? ` Prima ho acceso ${o.cosa === 'wifi' ? 'il Wi-Fi' : 'il Bluetooth'}, che era spento.` : '';
    return `Non fatto: ${s.frase}${s.dove ? ` ${s.dove}` : ''}${acceso}${apri} Riporta all'utente queste parole; non riprovare uguale.${quale}${nomi}`;
  }
  if (o.cosa === 'volume') {
    const al = (n) => global.SN_SISTEMA.alPercento(n);
    const prima = typeof o.prima === 'number' ? ` (prima era ${al(o.prima)})` : '';
    const limite = o.limitato ? ' Il numero chiesto era fuori da 0-100: si è fermato al limite, dillo all\'utente.' : '';
    return `Volume del computer ora ${al(o.volume)}${o.muto ? ', in muto' : ''}${prima}.${limite}`;
  }
  const radio = o.cosa === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
  if (Array.isArray(o.elenco)) {
    const stato = o.acceso === true ? ` (${radio} acceso)` : o.acceso === false ? ` (${radio} spento)` : '';
    if (!o.elenco.length) return o.cosa === 'wifi' ? `Il computer non conosce nessuna rete Wi-Fi${stato}.` : `Nessun dispositivo Bluetooth abbinato${stato}.`;
    const righe = o.elenco.map((x) => `${x.nome}${x.collegato === true || x.attiva ? ' (collegato)' : ''}`);
    return `${o.cosa === 'wifi' ? 'Reti Wi-Fi conosciute' : 'Dispositivi Bluetooth abbinati'}${stato}:\n${busta(righe)}`;
  }
  if (typeof o.acceso === 'boolean') return `${radio} ${o.acceso ? 'acceso' : 'spento'}.`;
  const nome = o.dispositivo || o.rete;
  const acceso = o.accesoPrima ? ` ${radio} era spento: acceso prima.` : '';
  if (o.dimenticato) return `Dimenticato: per riusarlo va riabbinato dalle impostazioni del sistema.\n${busta([nome])}`;
  if (typeof o.preferito === 'boolean') return `${o.preferito ? 'Messo fra i preferiti (in cima all\'elenco nella home)' : 'Tolto dai preferiti'}:\n${busta([nome])}`;
  if (o.dimenticata) return `Rete dimenticata: per ricollegarsi servirà di nuovo la password.\n${busta([nome])}`;
  if (o.gia) return `Era già così, niente da cambiare:\n${busta([nome])}`;
  if (o.cosa === 'bluetooth') {
    if (o.collegato === null) return `Collegamento chiesto, ma Windows non l'ha ancora confermato: lo vedi nella home fra poco.${acceso}\n${busta([nome])}`;
    return `${o.collegato ? 'Collegato' : 'Scollegato'}:${acceso}\n${busta([nome])}`;
  }
  if (!o.confermato) return `Collegamento alla rete chiesto: il sistema non dice ancora a quale rete è collegato, lo vedi nella home fra poco.${acceso}\n${busta([nome])}`;
  return `Collegato alla rete Wi-Fi:${acceso}\n${busta([nome])}`;
}

// Il «per sempre» alza il costo: vale solo detto chiaro, mai una stringa qualunque del modello. Una lettura sola per
// memorie, conversazioni e file, o una delle tre leggerebbe il «per sempre» diversamente.
function perSempreDetto(v) {
  return v === true || /^(true|s[iì]|1)$/i.test(String(v ?? '').trim());
}

// `parole` = ciò che l'utente ha scritto in chat: un codice scritto da lui può uscire.
function idDelCambio(action) {
  const id = String(action.id ?? action.cambio ?? action.evento ?? '').trim();
  return id || null;
}

// I file che il modello nomina per cancellarli o rinominarli: una lettura sola, o con due campi le due azioni ne
// prenderebbero uno diverso (#1909.3).
function percorsiDellAzione(action) {
  return [].concat(action.percorsi ?? action.percorso ?? action.path ?? action.file ?? action.files ?? [])
    .map((x) => (x && typeof x === 'object' ? (x.percorso ?? x.path) : x))
    .filter((x) => typeof x === 'string' && x.trim());
}

// #1909 — cosa finisce nel cestino lo trova il main prima del gate: il popup nomina gli elementi veri, e all'OK si
// tocca solo quello che ha mostrato. Fuori dal perimetro, su un altro computer o la cartella personale intera: mai.
const { LOTTO_ELIMINA, LOTTO_RINOMINA } = globalThis.SN_ACTION_LEVELS;
// Perché un file resta dov'è, detto all'utente: la stessa frase per chi cancella e chi rinomina.
function fraseFuori(m) {
  if (/rete/.test(m)) return 'sta su un altro computer della rete';
  return /nascost/.test(m) ? 'è un file nascosto o di un programma' : 'sta fuori dalla tua cartella personale';
}
const TETTO_CONTEGGIO = 10000;
function motivoEliminazione(p, perimetro) {
  const C = globalThis.SN_CMD_CLASSIFY;
  if (!C) return 'non si sa dove sta';
  const m = C.fuoriPerimetro(p, perimetro);
  if (m) return fraseFuori(m);
  const nodePath = require('node:path');
  const full = String(C.pulisciPercorso(p));
  if (perimetro.home && nodePath.isAbsolute(full)) {
    const rel = nodePath.relative(full, perimetro.home);
    if (!rel || (!rel.startsWith('..') && !nodePath.isAbsolute(rel))) return 'è la tua cartella personale, o la contiene';
  }
  return '';
}
async function contaDentro(dir) {
  const fsp = require('node:fs/promises');
  const nodePath = require('node:path');
  let n = 0;
  const coda = [dir];
  while (coda.length && n < TETTO_CONTEGGIO) {
    const cur = coda.shift();
    let voci = [];
    try { voci = await fsp.readdir(cur, { withFileTypes: true }); } catch (_) { voci = []; }
    for (const v of voci) {
      n += 1;
      if (v.isDirectory()) coda.push(nodePath.join(cur, v.name));
    }
  }
  return { dentro: Math.min(n, TETTO_CONTEGGIO), oltre: n >= TETTO_CONTEGGIO };
}
async function preparaEliminazione(action, sender) {
  const DR = require('./documentRead');
  const fsp = require('node:fs/promises');
  const nodePath = require('node:path');
  const perimetro = perimetroLettura(sender);
  const cwd = cartellaDelComando(getAssistantCwd(sender));
  const stato = async (p) => { try { return await fsp.lstat(p); } catch (_) { return null; } };
  const elenco = percorsiDellAzione(action);
  if (!elenco.length) return { file: [], saltati: [], oltre: 0, errore: 'indica i file o le cartelle da cancellare, coi loro percorsi' };
  let file = [];
  const saltati = [];
  const visti = new Set();
  for (const x of elenco) {
    let full = DR.normalizePath(x, cwd);
    const nome = nodePath.basename(full) || String(x).trim();
    const m = motivoEliminazione(x, perimetro) || motivoEliminazione(full, perimetro);
    if (m) { saltati.push({ nome, perche: m }); continue; }
    let st = await stato(full);
    if (!st) {
      let alt = null;
      try { alt = await DR.risolviTollerante(full); } catch (_) { alt = null; }
      if (alt && alt.path && !motivoEliminazione(alt.path, perimetro)) { full = alt.path; st = await stato(full); }
    }
    if (!st) { saltati.push({ nome, perche: 'non c\'è' }); continue; }
    const chiave = perimetro.maiuscole ? full.toLowerCase() : full;
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    file.push({ percorso: full, nome: nodePath.basename(full), cartella: nodePath.dirname(full), tipo: st.isDirectory() ? 'cartella' : 'file' });
  }
  const oltre = Math.max(0, file.length - LOTTO_ELIMINA);
  file = file.slice(0, LOTTO_ELIMINA);
  for (const f of file) if (f.tipo === 'cartella') Object.assign(f, await contaDentro(f.percorso));
  return { file, saltati, oltre, errore: '' };
}
function motivoNonEliminato(e) {
  const c = e && e.code;
  if (c === 'ENOENT') return 'non c\'è più';
  if (c === 'EBUSY' || c === 'EPERM' || c === 'EACCES') return 'è aperto in un altro programma, o il sistema non lo lascia toccare';
  return 'il sistema non l\'ha permesso';
}

// Ogni stato che l'azione scrive diventa un evento del filo nel salvataggio (registroCambi.js):
// qui si dichiara solo che li ha chiesti la chat, e si raccolgono per il segno sulla bolla.
async function preparaRinomina(action, sender, avanzamento = null) {
  const NF = globalThis.SN_NOMI_FILE;
  const Nomi = require('./nomiFile');
  const DR = require('./documentRead');
  const fsp = require('node:fs/promises');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const C = globalThis.SN_CMD_CLASSIFY;
  const perimetro = perimetroLettura(sender);
  const cwd = cartellaDelComando(getAssistantCwd(sender));
  const saltati = [];
  const vero = (v) => v === true || /^(true|1|si|sì|yes)$/i.test(String(v ?? ''));
  // Fuori perimetro un file si salta comunque: il disco non si tocca, nemmeno per guardare (#1072).
  // Si misura anche il percorso come l'ha scritto il modello, lo stesso che misura il terminale.
  const motivoFuori = (...ps) => {
    if (!C) return 'non si sa dove legge';
    for (const p of ps) { const m = C.fuoriPerimetro(p, perimetro); if (m) return m; }
    return '';
  };
  const saltaFuori = (p, m) => ({ nome: nodePath.basename(p) || p, perche: fraseFuori(m) });
  const elenco = percorsiDellAzione(action);
  let candidati = [];
  for (const x of elenco) {
    let full = DR.normalizePath(x, cwd);
    const m = motivoFuori(x, full);
    if (m) { saltati.push(saltaFuori(full, m)); continue; }
    try { await fsp.stat(full); } catch (_) {
      try { const alt = await DR.risolviTollerante(full); if (alt && alt.path) full = alt.path; } catch (_) {}
    }
    candidati.push(full);
  }
  const cartella = action.cartella ?? action.folder ?? action.directory;
  if (typeof cartella === 'string' && cartella.trim()) {
    const dir = DR.normalizePath(cartella, cwd);
    let voci = null;
    const m = motivoFuori(cartella, dir);
    if (m) saltati.push({ ...saltaFuori(dir, m), nome: cartella.trim() });
    else try { voci = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { voci = null; }
    if (!voci) {
      if (!candidati.length && !saltati.length) return { proposte: [], saltati, oltre: 0, errore: `la cartella ${dir} non si apre (non c'è, o non è una cartella)` };
    } else {
      const tutti = vero(action.tutti ?? action.all);
      const scelti = voci.filter((d) => d.isFile() && !d.name.startsWith('.') && NF.tipoDi(d.name)
        && (tutti || NF.nomeSenzaSenso(d.name))).map((d) => nodePath.join(dir, d.name));
      const conData = await Promise.all(scelti.map(async (p) => {
        try { return { p, t: (await fsp.stat(p)).mtimeMs }; } catch (_) { return { p, t: 0 }; }
      }));
      conData.sort((a, b) => b.t - a.t);
      candidati.push(...conData.map((x) => x.p));
    }
  }
  candidati = [...new Set(candidati)];
  if (!candidati.length) {
    const errore = !elenco.length && !cartella ? 'indica i file o una cartella'
      : (!saltati.length && !elenco.length && !vero(action.tutti ?? action.all)
        ? 'nella cartella non c\'è un PDF, un\'immagine o un documento col nome che non dice niente: se vuoi rinominare anche gli altri, chiedilo' : '');
    return { proposte: [], saltati, oltre: 0, errore };
  }
  const oltre = Math.max(0, candidati.length - LOTTO_RINOMINA);
  candidati = candidati.slice(0, LOTTO_RINOMINA);
  const dettato = typeof action.nome === 'string' && action.nome.trim() && candidati.length === 1 ? action.nome : '';

  async function unaProposta(full) {
    const nome = nodePath.basename(full);
    const m = motivoFuori(full);
    if (m) return { saltato: saltaFuori(full, m) };
    let st = null;
    try { st = await fsp.stat(full); } catch (_) { st = null; }
    if (!st) return { saltato: { nome, perche: 'non c\'è' } };
    if (!st.isFile()) return { saltato: { nome, perche: 'non è un file' } };
    const { ext } = NF.scomponi(nome);
    if (dettato) {
      const base = NF.pulisci(dettato, { ext });
      return base ? { proposta: { da: full, prima: nome, nome: base + ext } } : { saltato: { nome, perche: 'il nome chiesto è vuoto' } };
    }
    const p = await Nomi.proponi(full);
    if (!p.ok) return { saltato: { nome, perche: p.frase } };
    const nuovo = p.proposta + p.ext;
    if (nuovo === nome) return { saltato: { nome, perche: 'ha già un nome che dice cos\'è' } };
    return { proposta: { da: full, prima: nome, nome: nuovo } };
  }
  // In parallelo, ma pochi alla volta: una cartella di scansioni non deve diventare quaranta chiamate insieme.
  const esiti = new Array(candidati.length);
  let prossimo = 0;
  let letti = 0;
  const segna = () => { try { if (avanzamento) avanzamento(letti, candidati.length); } catch (_) {} };
  segna();
  const lavora = async () => {
    while (prossimo < candidati.length) {
      const k = prossimo++;
      try { esiti[k] = await unaProposta(candidati[k]); } catch (_) {
        esiti[k] = { saltato: { nome: nodePath.basename(candidati[k]), perche: 'non sono riuscito a leggerlo' } };
      }
      letti += 1;
      segna();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, candidati.length) }, lavora));

  // Il popup promette nomi veri: due file dello stesso lotto, o un file già sul disco, non finiscono sullo stesso.
  const presi = new Map();
  const proposte = [];
  for (const e of esiti) {
    if (!e) continue;
    if (e.saltato) { saltati.push(e.saltato); continue; }
    const p = e.proposta;
    const dir = nodePath.dirname(p.da);
    if (!presi.has(dir)) presi.set(dir, new Set());
    const set = presi.get(dir);
    const occupato = (n) => set.has(n.toLowerCase())
      || (n.toLowerCase() !== p.prima.toLowerCase() && fs.existsSync(nodePath.join(dir, n)));
    const libero = NF.nomeLibero(p.nome, occupato);
    if (!libero) { saltati.push({ nome: p.prima, perche: 'non c\'è un nome libero' }); continue; }
    set.add(libero.toLowerCase());
    proposte.push({ ...p, nome: libero });
  }
  return { proposte, saltati, oltre };
}

module.exports = {
  getAssistantCwd,
  setAssistantCwd,
  cartellaDelComando,
  displayCwd,
  pendingConfirmKey,
  recordPendingConfirm,
  consumePendingConfirm,
  daPaginaDiFilo,
  chiaveSchermo,
  bersagliMostrati,
  timerRefOf,
  describeTimerEntry,
  cleanLabel,
  perimetroLettura,
  shellDeiComandi,
  segretiCustoditi,
  ricordaLettoDallAiuto,
  ricordaLettoInChat,
  testoDiAltriNelleAzioni,
  controllaUscita,
  analizzaPer,
  chiamataPerModello,
  rifiutoNonCompare,
  ricercaNelSito,
  SCHEMI_USCITA,
  sitoDaConfermare,
  contattabilePrimaDelClic,
  ricordaVerdettiArchiviati,
  linkCheChiedonoOk,
  apriDaFilo,
  primaVoltaDelTerminale,
  richiestaDiSistema,
  richiestaDaEseguire,
  esitoSistemaPerModello,
  perSempreDetto,
  idDelCambio,
  LOTTO_ELIMINA,
  motivoEliminazione,
  preparaEliminazione,
  motivoNonEliminato,
  LOTTO_RINOMINA,
  preparaRinomina,
};
