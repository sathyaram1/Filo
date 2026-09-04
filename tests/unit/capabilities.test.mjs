// Unit test per src/shared/capabilities.js — il manifesto delle capacità di
// Filo (F1). Verifica due cose:
//   1. integrità strutturale del manifesto e della sua API;
//   2. anti-stale: incrocia alcune voci col CODICE REALE (shortcut globali,
//      icone del menu, pagine filo://) così che, se una capacità sparisce o
//      cambia invocazione senza aggiornare il manifesto, il test diventi rosso.
// Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'capabilities.js'));
const CAP = globalThis.SN_CAPABILITIES;

test('si registra su globalThis con la sua API', () => {
  assert.ok(CAP, 'SN_CAPABILITIES assente');
  for (const fn of ['index', 'get', 'byCategory', 'all']) {
    assert.equal(typeof CAP[fn], 'function', `manca ${fn}()`);
  }
  assert.ok(Array.isArray(CAP.CAPABILITIES) && CAP.CAPABILITIES.length > 0);
});

test('ogni voce ha i campi obbligatori e una categoria valida', () => {
  for (const c of CAP.CAPABILITIES) {
    for (const field of ['id', 'title', 'category', 'desc', 'invoke']) {
      assert.ok(c[field] && typeof c[field] === 'string', `voce ${c.id || c.title}: campo "${field}" mancante o non stringa`);
    }
    assert.ok(CAP.CATEGORIES[c.category], `voce ${c.id}: categoria sconosciuta "${c.category}"`);
    if (c.doesNot !== undefined) {
      assert.equal(typeof c.doesNot, 'string', `voce ${c.id}: doesNot deve essere stringa`);
    }
  }
});

test('gli id sono unici e stabili (kebab-case)', () => {
  const ids = CAP.CAPABILITIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id duplicati nel manifesto');
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id non kebab-case: ${id}`);
  }
});

test('index() è compatto, get()/byCategory()/all() coerenti', () => {
  const idx = CAP.index();
  assert.equal(idx.length, CAP.CAPABILITIES.length);
  for (const e of idx) {
    assert.deepEqual(Object.keys(e).sort(), ['category', 'id', 'title']);
    assert.ok(CAP.get(e.id), `get(${e.id}) deve risolvere`);
  }
  assert.equal(CAP.get('id-inesistente'), undefined);
  assert.equal(CAP.all().length, CAP.CAPABILITIES.length);
  // all() torna una copia: mutarla non tocca l'originale.
  CAP.all().pop();
  assert.equal(CAP.all().length, CAP.CAPABILITIES.length);
});

// ── Anti-stale: incrocio col codice reale ────────────────────────────────────

test('ogni comando degli shortcut globali è coperto dal manifesto', () => {
  // shortcuts.js definisce i 4 comandi OS; ognuno deve esistere come capacità.
  const src = readFileSync(join(ROOT, 'src', 'main', 'shortcuts.js'), 'utf8');
  const commands = [...src.matchAll(/'(Alt\+[A-Z])':\s*'([a-z-]+)'/g)].map((m) => ({ accel: m[1], cmd: m[2] }));
  assert.ok(commands.length >= 4, 'mi aspetto almeno 4 shortcut globali');
  // Mappa comando-shortcut → id capacità che lo descrive.
  const cmdToCap = {
    'explain-selection': 'explain-selection',
    'translate-selection': 'translate-selection',
    'save-for-later': 'save-for-later',
    'open-help-sidebar': 'help-sidebar',
  };
  for (const { accel, cmd } of commands) {
    const capId = cmdToCap[cmd];
    assert.ok(capId, `shortcut ${accel} → comando "${cmd}" non mappato nel test: aggiorna manifesto+test`);
    const cap = CAP.get(capId);
    assert.ok(cap, `manca la capacità "${capId}" per lo shortcut ${accel} (${cmd})`);
    // l'invocazione deve citare lo shortcut, così il manifesto non mente su come si attiva.
    assert.ok(cap.invoke.includes(accel), `la capacità "${capId}" non cita lo shortcut ${accel} in invoke`);
  }
});

test('ogni handler MSG.FILO_* dell’assistente è coperto dal manifesto', () => {
  // Il sottosistema "assistente" (chat, dashboard generata, memoria, note, timer,
  // notifiche, azioni agentiche) vive negli handler MSG.FILO_* di filo.js. Ogni
  // handler che corrisponde a una capacità VISIBILE all'utente deve avere una
  // voce nel manifesto: se aggiungi un nuovo handler FILO_* senza aggiornare il
  // manifesto (e questa mappa), il test diventa rosso.
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  const handlers = [...src.matchAll(/on\(MSG\.(FILO_[A-Z_]+)/g)].map((m) => m[1]);
  assert.ok(handlers.length >= 10, `mi aspetto ≥10 handler FILO_*, trovati ${handlers.length}`);

  // Handler interni che NON sono una capacità utente a sé (l'agente li usa dietro
  // le quinte): vanno dichiarati qui per non far fallire il test, ma con una
  // ragione esplicita così la lista resta onesta.
  const INTERNAL = new Set([
    'FILO_GET_STATE', // assemblaggio dello stato (schede/cronologia) per il prompt dell'agente
    // Compattazione forzata della memoria (#524): meccanica interna del sistema
    // di memoria, che l'utente conosce già come "filo-memory". Non è una voce a
    // sé: nessuno chiede "compatta le lezioni", chiede "ricordati questo".
    'FILO_COMPACT_MEMORY',
  ]);

  // Mappa handler → id della capacità che lo descrive nel manifesto. Più handler
  // della stessa feature (es. add/get/delete) puntano alla stessa voce.
  const FILO_MSG_TO_CAP = {
    FILO_CHAT: 'filo-assistant',
    FILO_GENERATE_DASHBOARD: 'generate-dashboard',
    FILO_RUN_ACTION: 'agent-actions',
    FILO_CONFIRM_ACTION: 'agent-actions',
    FILO_GET_MEMORY: 'filo-memory',
    // Gli appunti non hanno handler propri: la capacità "filo-notes" è servita
    // dall'azione SALVA_APPUNTO (FILO_RUN_ACTION), che scrive nei file dell'editor.
    FILO_GET_TIMERS: 'filo-timers',
    FILO_ADD_TIMER: 'filo-timers',
    FILO_DELETE_TIMER: 'filo-timers',
    FILO_PAUSE_TIMER: 'filo-timers',
    FILO_RESUME_TIMER: 'filo-timers',
    FILO_STOP_TIMER_ALARM: 'filo-timers',
    FILO_GET_NOTIFICATIONS: 'filo-notifications',
    FILO_DISMISS_NOTIFICATION: 'filo-notifications',
    FILO_GET_ONBOARDING: 'onboarding',
    FILO_RESTART_ONBOARDING: 'onboarding',
  };

  for (const h of handlers) {
    if (INTERNAL.has(h)) continue;
    const capId = FILO_MSG_TO_CAP[h];
    assert.ok(capId, `handler ${h} non mappato: aggiungi una voce nel manifesto e in FILO_MSG_TO_CAP (o, se è interno, in INTERNAL con la ragione)`);
    assert.ok(CAP.get(capId), `manca la capacità "${capId}" nel manifesto per l'handler ${h}`);
  }
});

test('ogni pagina filo:// citata nel manifesto esiste davvero', () => {
  // Estrai i path filo://<area>/<file>.html dalle invocazioni/descrizioni.
  const refs = new Set();
  for (const c of CAP.CAPABILITIES) {
    for (const text of [c.invoke, c.desc]) {
      for (const m of text.matchAll(/filo:\/\/([a-z-]+)\/([a-z-]+\.html)/g)) {
        refs.add(`${m[1]}/${m[2]}`);
      }
    }
  }
  assert.ok(refs.size > 0, 'mi aspetto almeno una pagina filo:// citata');
  for (const ref of refs) {
    const [area, file] = ref.split('/');
    const p = join(ROOT, 'src', 'pages', area, file);
    assert.ok(existsSync(p), `il manifesto cita filo://${ref} ma ${p} non esiste`);
  }
});

test('la home e "Aperti per dopo" sono attribuite alla pagina giusta', () => {
  // Drift #387: la voce "Home di Filo" citava filo://home/home.html, che è
  // invece la pagina "Aperti per dopo"; la home vera è filo://newtab/ (la
  // dashboard/nuova scheda). Il controllo "il file esiste" non lo intercettava
  // perché home.html esiste eccome — solo, non è la home. Qui incrociamo il
  // TITOLO reale delle due pagine così che una futura inversione ridiventi rossa.
  const homeHtml = readFileSync(join(ROOT, 'src', 'pages', 'home', 'home.html'), 'utf8');
  const dashHtml = readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard.html'), 'utf8');
  assert.match(homeHtml, /<title>[^<]*Aperti per dopo/i,
    'filo://home/home.html non è più la pagina "Aperti per dopo": aggiorna il manifesto e questo test');
  assert.match(dashHtml, /<title>[^<]*Nuova scheda/i,
    'la dashboard non è più la nuova scheda/home: aggiorna il manifesto e questo test');

  const home = CAP.get('home-page');
  assert.ok(home, 'manca la capacità "home-page"');
  const homeText = `${home.invoke} ${home.desc}`;
  assert.ok(!/filo:\/\/home\/home\.html/.test(homeText),
    'la voce "Home di Filo" cita filo://home/home.html, che è invece "Aperti per dopo"');
  assert.ok(/filo:\/\/newtab\/|filo:\/\/dashboard\//.test(homeText),
    'la voce "Home di Filo" deve puntare alla home vera (filo://newtab/ o dashboard)');

  // Simmetria: se una voce cita filo://home/home.html, deve riguardare gli
  // "Aperti per dopo" — altrimenti sta di nuovo scambiando le due pagine.
  for (const c of CAP.CAPABILITIES) {
    const text = `${c.title} ${c.invoke} ${c.desc}`.toLowerCase();
    if (/filo:\/\/home\/home\.html/.test(`${c.invoke} ${c.desc}`)) {
      assert.match(text, /aperti per dopo|per dopo/,
        `la voce "${c.id}" cita filo://home/home.html ma non riguarda "Aperti per dopo"`);
    }
  }
});

test('ogni icona fissa della home che apre una pagina filo:// è coperta dal manifesto', () => {
  // renderControls() in dashboard.js monta le icone fisse in alto a destra nella
  // home (Red Team, Cronologia, ...). Quelle che navigano a una pagina filo://
  // devono avere una capacità che cita QUEL indirizzo: drift #387: il Red Team
  // era a un click dalla home ma non compariva affatto nel manifesto, così
  // l'agente diceva di non saperlo fare.
  const dash = readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard.js'), 'utf8');
  const urls = [...dash.matchAll(/url:\s*'(filo:\/\/[a-z-]+\/[a-z-]+\.html)'/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, `mi aspetto ≥2 icone della home con url filo://, trovate ${urls.length}`);
  const manifestText = CAP.CAPABILITIES.map((c) => `${c.invoke} ${c.desc}`).join('\n');
  for (const url of urls) {
    assert.ok(manifestText.includes(url),
      `un'icona della home apre ${url} ma nessuna capacità del manifesto la cita: aggiungi/aggiorna la voce`);
  }
});

// ── Anti-stale: il manifesto non può citare strade che non esistono più ──────

// Etichette italiane delle icone del menu del tasto destro, per id, e insieme
// delle icone che un utente può DAVVERO vedere (registro meno le ritirate,
// limitato a quelle presenti nel layout di default o aggiunte per migrazione).
function menuIconLabels() {
  const src = readFileSync(join(ROOT, 'src', 'content', 'menuIcons.js'), 'utf8');
  const i18n = readFileSync(join(ROOT, 'src', 'shared', 'i18n.js'), 'utf8');
  const label = (key) => {
    const m = i18n.match(new RegExp(`\\b${key}:\\s*'([^']+)'`));
    return m ? m[1] : null;
  };
  // id → etichetta, per le voci del registro con label statica.
  const byId = new Map();
  for (const m of src.matchAll(/\bid:\s*'(\w+)'[^\n]*?label:\s*I18n\.t\('([a-z0-9_]+)'\)/g)) {
    const text = label(m[2]);
    if (text) byId.set(m[1], text);
  }
  const retired = new Set(
    [...(src.match(/RETIRED_ICONS\s*=\s*new Set\(\[([^\]]*)\]/)?.[1] || '').matchAll(/'(\w+)'/g)].map((m) => m[1]),
  );
  // Icone raggiungibili: quelle del layout di default più quelle che la
  // migrazione aggiunge ai layout già salvati. Un'icona fuori da qui non
  // compare nel menu di NESSUNO, anche se resta nel registro.
  const reachable = new Set();
  const layout = src.match(/DEFAULT_ICON_LAYOUT\s*=\s*\{([\s\S]*?)\n  \};/)?.[1] || '';
  const additions = src.match(/const additions\s*=\s*\[([^\]]*)\]/)?.[1] || '';
  for (const m of `${layout}${additions}`.matchAll(/'(\w+)'/g)) {
    if (!retired.has(m[1])) reachable.add(m[1]);
  }
  return { byId, retired, reachable };
}

test('nessuna capacità promette un\'icona del menu del tasto destro che non c\'è più', () => {
  // Drift #252: "Aperti per dopo" era stato ritirato dalle icone del menu, ma il
  // manifesto continuava a dire «Menu del tasto destro → "Aperti per dopo"».
  // L'agente, che legge il manifesto, dava all'utente istruzioni impossibili.
  // Qui incrociamo OGNI etichetta citata come voce del tasto destro con le icone
  // davvero raggiungibili: se una capacità cita un'icona ritirata, il test è rosso.
  const { byId, reachable } = menuIconLabels();
  assert.ok(byId.size >= 8, `mi aspetto ≥8 icone con etichetta statica, trovate ${byId.size}`);
  assert.ok(reachable.size >= 8, `mi aspetto ≥8 icone raggiungibili, trovate ${reachable.size}`);

  // Etichette che NON sono più raggiungibili dal menu del tasto destro.
  const unreachableLabels = new Map();
  for (const [id, text] of byId) if (!reachable.has(id)) unreachableLabels.set(text, id);

  for (const c of CAP.CAPABILITIES) {
    const invoke = String(c.invoke || '');
    if (!/tasto destro|clic destro/i.test(invoke)) continue;
    // Le voci citate fra virgolette (dritte o tipografiche) dopo un riferimento
    // al tasto destro sono la promessa concreta fatta all'utente.
    const quoted = [...invoke.matchAll(/["“«]([^"”»]+)["”»]/g)].map((m) => m[1].trim());
    for (const q of quoted) {
      const id = unreachableLabels.get(q);
      assert.ok(!id,
        `la capacità "${c.id}" promette «tasto destro → ${q}», ma quell'icona (${id}) non è più raggiungibile dal menu: `
        + 'correggi il manifesto (o rimetti l\'icona nel layout)');
    }
  }
});

test('ogni voce del menu «App» citata dal manifesto esiste davvero nel launcher', () => {
  // Simmetrico al test precedente sul lato "positivo": il manifesto indica il
  // menu App come strada per alcune pagine (Scaricamenti, Aperti per dopo…).
  // Se quella voce non è nel launcher, l'indicazione è falsa.
  const shell = readFileSync(join(ROOT, 'src', 'renderer', 'shell.js'), 'utf8');
  const appsBlock = shell.match(/const APPS\s*=\s*\[([\s\S]*?)\n  \];/)?.[1];
  assert.ok(appsBlock, 'non trovo il registro APPS del launcher in shell.js');
  const appLabels = new Set([...appsBlock.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(appLabels.size >= 5, `mi aspetto ≥5 voci nel menu App, trovate ${appLabels.size}`);

  let cited = 0;
  for (const c of CAP.CAPABILITIES) {
    for (const m of String(c.invoke || '').matchAll(/Menu\s+«App»\s*→\s*«([^»]+)»/g)) {
      cited++;
      assert.ok(appLabels.has(m[1].trim()),
        `la capacità "${c.id}" manda l'utente in «App» → «${m[1]}», ma quella voce non esiste nel menu App`);
    }
  }
  assert.ok(cited >= 1, 'mi aspetto almeno una capacità che passi dal menu «App»');
});

test('nessuna capacità cita la barra in alto / degli indirizzi, rimossa dalla shell', () => {
  // Drift #399 (stessa famiglia di #387/#252): la shell tiene la barra indirizzi
  // (<nav class="addr">) SEMPRE nascosta — applyChrome() forza compact=true e
  // boot.spec.mjs asserisce #addr assente. Sopra le schede ci sono solo le
  // linguette e i pulsanti finestra: indietro/avanti/ricarica vivono nel menu
  // del tasto destro, l'icona Home in alto a destra DENTRO la home. Il manifesto
  // aveva continuato a mandare l'utente a "frecce/pulsante nella barra in alto" e
  // a "digitare nella barra degli indirizzi", strade che non esistono più.
  //
  // Ancora anti-stale: se la barra tornasse davvero visibile, applyChrome() non
  // forzerebbe più compact=true incondizionatamente — questo test va allora
  // rivisto INSIEME al manifesto (non basta cancellarlo).
  const shell = readFileSync(join(ROOT, 'src', 'renderer', 'shell.js'), 'utf8');
  assert.match(shell, /function applyChrome[\s\S]*?const compact = true;/,
    'applyChrome() non forza più la barra compatta: la barra indirizzi potrebbe essere tornata visibile — rivedi manifesto e questo test');

  // "barra delle schede" (le linguette in alto) esiste eccome ed è lecita; a
  // essere sparita è la barra IN ALTO degli indirizzi/navigazione. Vietiamo solo
  // le formule che promettono quella.
  const FORBIDDEN = [
    { re: /barra in alto/i, why: 'la barra in alto (indirizzi/navigazione) è stata rimossa' },
    { re: /barra\s+(degli\s+)?indirizzi/i, why: 'la barra degli indirizzi è sempre nascosta' },
    // "nella barra" generico, TRANNE la barra delle schede (le linguette, che
    // esiste) o la barra in basso (chat del deck builder): intercetta formule
    // come "Pulsante Home nella barra" che rimandano alla barra sparita.
    { re: /nella barra(?!\s+(delle schede|in basso))/i, why: 'l\'unica barra sopra le schede è quella delle linguette' },
  ];
  for (const c of CAP.CAPABILITIES) {
    const text = `${c.invoke} ${c.desc}${c.doesNot ? ' ' + c.doesNot : ''}`;
    for (const { re, why } of FORBIDDEN) {
      assert.ok(!re.test(text),
        `la capacità "${c.id}" cita "${(text.match(re) || [''])[0]}", ma ${why}: `
        + 'aggiorna il manifesto (indietro/avanti/ricarica sono nel menu del tasto destro, '
        + 'l\'indirizzo si scrive con "/" nella nuova scheda, Home è in alto a destra nella home)');
    }
  }
});
