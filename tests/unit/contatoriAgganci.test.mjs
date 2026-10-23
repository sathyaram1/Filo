// Gli agganci dei contatori anonimi nel codice (#1461): gli avvisi d'errore si contano per chiave e la chiave viene
// dall'elenco chiuso; le icone le conta una parte sola; i messaggi dei contatori mandano nomi, mai testo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'disposizioneIcone', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const contenuti = readdirSync(join(ROOT, 'src', 'content')).filter((f) => f.endsWith('.js')).map((f) => [f, leggi('src', 'content', f)]);

test('ogni avviso d’errore dei content script si conta per chiave, e la chiave sta nell’elenco chiuso', () => {
  const usate = new Set();
  for (const [f, s] of contenuti) {
    for (const m of s.matchAll(/toastErrore\('([a-z_]+)'/g)) {
      assert.ok(C.AVVISI_ERRORE.includes(m[1]), `${f}: «${m[1]}» non è in SN_CONTATORI.AVVISI_ERRORE`);
      usate.add(m[1]);
    }
    // Un avviso d'errore mostrato col testo e basta sfugge ai contatori.
    for (const m of s.matchAll(/showToast\(I18n\.t\('([a-z_]+)'/g)) {
      assert.ok(!C.AVVISI_ERRORE.includes(m[1]), `${f}: «${m[1]}» è un avviso d'errore: va mostrato con toastErrore`);
    }
  }
  const actions = contenuti.find(([f]) => f === 'actions.js')[1];
  for (const k of ['toast_audio_save_failed', 'toast_video_save_failed']) assert.ok(actions.includes(`'${k}'`), k);
  assert.ok(usate.size >= 10, 'gli avvisi d’errore si contano davvero');
});

test('un’icona del tasto destro si conta una volta sola: o nella pagina, o nel main al suo messaggio', () => {
  const icone = leggi('src', 'content', 'menuIcons.js');
  const m = /const CONTATE_DAL_MAIN = new Set\(\[([^\]]*)\]\)/.exec(icone);
  assert.ok(m, 'manca l’elenco delle icone che conta il main');
  const dalMain = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const nav = leggi('src', 'main', 'services', 'handlers', 'nav.js');
  // Il messaggio che ognuna manda al main, e l'azione con cui nav.js la conta.
  const attese = {
    back: ['NAV_BACK', 'navigate-back-forward'], forward: ['NAV_FORWARD', 'navigate-back-forward'], reload: ['NAV_RELOAD', 'reload'],
    closeTab: ['CLOSE_TAB', 'close-tab'], newTab: ['OPEN_NEW_TAB', 'new-tab'], incognito: ['OPEN_INCOGNITO', 'incognito'],
    openOptions: ['OPEN_OPTIONS', 'options-models'], home: ['GO_HOME', 'home'],
  };
  // Quelle che aprono una pagina di Filo le conta l'apertura stessa, per indirizzo, come da ogni altra strada.
  const perPagina = { editorApp: 'filo://editor/editor.html', feedbackApp: 'filo://feedback/feedback.html' };
  assert.deepEqual([...dalMain].sort(), [...Object.keys(attese), ...Object.keys(perPagina)].sort());
  for (const [icona, url] of Object.entries(perPagina)) {
    assert.ok(icone.includes(`type: MSG.OPEN_URL, url: '${url}'`), `l’icona ${icona} apre ${url}`);
    assert.equal(C.azioneDiPagina(url), C.AZIONE_DI_ICONA[icona]);
  }
  for (const [icona, [msg, azione]] of Object.entries(attese)) {
    assert.match(icone, new RegExp(`${icona}:[^\\n]*type: MSG\\.${msg}\\b`), `l’icona ${icona} manda ${msg}`);
    const handler = new RegExp(`on\\(MSG\\.${msg}, [\\s\\S]*?contata\\('${azione}'`).exec(nav);
    assert.ok(handler, `nav.js conta ${msg} come ${azione}`);
    assert.equal(C.AZIONE_DI_ICONA[icona], azione);
  }
});

test('i gesti contati nelle pagine mandano solo nomi da elenchi chiusi e numeri', () => {
  const tutto = contenuti.map(([, s]) => s).join('\n')
    + leggi('src', 'pages', 'dashboard', 'dashboard-cerca.js') + leggi('src', 'pages', 'editor', 'editor.js') + leggi('src', 'shared', 'comboBox.js')
    + leggi('src', 'shared', 'ascolto.js') + leggi('src', 'pages', 'dashboard', 'dashboard.js');
  for (const m of tutto.matchAll(/misura: '([a-z-]+)'/g)) {
    assert.ok(['azione', 'icona', 'ricerca', 'proposta', 'annullato', 'chiesto', 'avviso', 'errore-modello', 'intervista',
      'tasto-annulla', 'anticipo-aperto', 'conferma', 'aiuto', 'ricerca-web-tetto', 'dettatura', 'lettura', 'suggerimento',
      'in-corso'].includes(m[1]), m[1]);
    assert.match(leggi('src', 'main', 'services', 'handlers', 'contatori.js'), new RegExp(`case '${m[1]}':|misura === '${m[1]}'`), `il main riceve «${m[1]}»`);
  }
  for (const m of tutto.matchAll(/pannello: '([a-z-]+)'/g)) assert.ok(C.PANNELLI.includes(m[1]), m[1]);
  // La ricerca porta l'esito, l'attesa e la posizione: mai la query.
  for (const s of [leggi('src', 'pages', 'dashboard', 'dashboard-cerca.js'), leggi('src', 'shared', 'comboBox.js'), leggi('src', 'pages', 'editor', 'editor.js')]) {
    for (const m of s.matchAll(/contaRicerca\(\{([^}]*)\}\)/g)) assert.doesNotMatch(m[1], /\bq\b|value|testo|query|search\.value/, m[1]);
  }
});

// Le attività contate nelle pagine (#1467) portano numeri e nomi: nessun campo per un selettore, una query, un testo.
// Lo stesso oggetto va al main finché l'attività è aperta («in-corso») e quando finisce.
test('le attività contate nelle pagine mandano solo i campi della loro misura', () => {
  const campi = {
    aiuto: ['esito', 'passiDaSolo', 'passiCliccati', 'nonTrovati', 'documenti', 'id'],
    dettatura: ['motivo', 'frasi', 'invio', 'provvisorie', 'id'],
    lettura: ['voce', 'ripiego', 'codice', 'chiaveRifiutata', 'senzaModello', 'quota', 'finita', 'id'],
    suggerimento: ['tipo', 'posizione', 'etaMs'],
  };
  const fonti = {
    aiuto: [leggi('src', 'content', 'sidebar.js'), /const datiSessione = \(s\) => \(\{([^}]*)\}\)/g],
    dettatura: [leggi('src', 'shared', 'ascolto.js'), /MSG\.CONTATORI_EVENTO, misura, cosa: 'dettatura',([^}]*)\}/g],
    lettura: [leggi('src', 'content', 'tts.js'), /misura: 'lettura',([^}]*)\}/g],
    suggerimento: [leggi('src', 'pages', 'dashboard', 'dashboard.js'), /misura: 'suggerimento',([^}]*)\}/g],
  };
  for (const [misura, [s, re]] of Object.entries(fonti)) {
    const viste = [...s.matchAll(re)];
    assert.equal(viste.length, 1, `${misura}: un solo punto che la compone`);
    const chiavi = [...viste[0][1].replace(/\([^()]*\)/g, '').matchAll(/(?:^|[,{\s])(\w+):/g)].map((m) => m[1]).filter((k) => k !== 'type');
    assert.deepEqual(chiavi.sort(), [...campi[misura]].sort(), `${misura}: ${chiavi}`);
  }
  // Chi manda le attività le compone da lì, e da nessun'altra parte.
  assert.doesNotMatch(leggi('src', 'content', 'sidebar.js'), /misura: 'aiuto', (?!\.\.\.datiSessione)/);
  assert.match(leggi('src', 'content', 'sidebar.js'), /misura: 'ricerca-web-tetto' \}/, 'il tetto delle ricerche dell’Aiuto non porta la query');
});

// Gli avvisi d'errore che non nascono in una pagina web (quelli che il main manda a tutte le schede, quelli delle
// pagine di Filo) si contano anche loro, per chiave dell'elenco chiuso.
test('gli avvisi d’errore del main e delle pagine di Filo si contano, con una chiave dell’elenco chiuso', () => {
  const fuori = [
    ['src', 'main', 'services', 'handlers', 'wallet.js'], ['src', 'main', 'services', 'handlers', 'ai.js'],
    ['src', 'main', 'services', 'handlers.js'], ['src', 'main', 'services', 'handlers', 'misc.js'],
    ['src', 'renderer', 'shell.js'], ['src', 'pages', 'decks', 'decks.js'], ['src', 'pages', 'editor', 'editor.js'],
    ['src', 'main', 'shim', 'storage.js'], ['src', 'main', 'updater.js'],
    ['src', 'pages', 'downloads', 'downloads.js'], ['src', 'pages', 'dashboard', 'dashboard-carte.js'],
    ['src', 'pages', 'dashboard', 'dashboard-sistema.js'],
  ].map((p) => [p.join('/'), leggi(...p)]);
  const chiavi = new Set();
  for (const [f, s] of fuori) {
    for (const m of s.matchAll(/erroreVisto\('avviso:([a-z_]+)'\)|misura: 'avviso', chiave: '([a-z_]+)'|(?:\{ |, )errore: '([a-z_]+)' \}|avvisoErrore\([^;]*?, '([a-z_]+)'|null, '([a-z_]+)'\)/g)) {
      const k = m[1] || m[2] || m[3] || m[4] || m[5];
      assert.ok(C.AVVISI_ERRORE.includes(k), `${f}: «${k}» non è in SN_CONTATORI.AVVISI_ERRORE`);
      chiavi.add(k);
    }
  }
  for (const k of ['crediti_finiti', 'tetto_automatiche', 'pesi_aperti_violati', 'allegati_non_caricati', 'accesso_non_riuscito', 'mazzi_non_riuscito',
    'dati_illeggibili', 'dati_non_salvati', 'segnalazione_non_partita', 'aggiornamento_non_avviato', 'scheda_da_altro_paese',
    'file_non_aperto', 'cartella_non_aperta', 'nome_non_rimesso', 'editor_non_salvato', 'titolo_non_generato',
    'comando_sistema_non_riuscito']) {
    assert.ok(chiavi.has(k), `l’avviso «${k}» non si conta`);
  }
  // Nella pagina Download e sulle carte della home un errore passa dalla funzione che lo conta.
  assert.doesNotMatch(fuori.find(([f]) => f.endsWith('downloads.js'))[1], /\bflash\((res\.error \|\| '(Impossibile|Cartella)|'Il file non c’è più)/);
  assert.doesNotMatch(fuori.find(([f]) => f.endsWith('dashboard-carte.js'))[1], /\bavviso\(\(?(res|r)\b[^)]*\.error/);
  // Nella barra delle schede e nei Mazzi un avviso d'errore passa dalla funzione che lo conta.
  assert.doesNotMatch(fuori.find(([f]) => f.endsWith('shell.js'))[1], /(showToast|NOTIFS\.show)\([^)]*(non riuscit|Non sono riuscito|Non è stato possibile|non c’è più)/);
  // Nell'Editor un errore letto passa dal conto: la bolla della chat, il titolo, il salvataggio.
  const editor = fuori.find(([f]) => f.endsWith('editor.js'))[1];
  assert.match(editor, /const erroreInChat = \(res, ripiego\) => \{\s*contaModello\(res\);/);
  const titolo = /showEditorToast\('Non sono riuscito a generare il titolo\.'\)/g;
  const contato = /(contaModello\(r\)|contaErroreVisto\(\{ misura: 'avviso', chiave: 'titolo_non_generato' \}\)); showEditorToast\('Non sono riuscito a generare il titolo\.'\)/g;
  assert.equal([...editor.matchAll(contato)].length, [...editor.matchAll(titolo)].length);
  // L'Aiuto della barra laterale conta la sua bolla d'errore come la chat della home.
  assert.match(leggi('src', 'content', 'sidebar.js'), /sn-sidebar-msg-error'\);\s*\/\/[^\n]*\n\s*try \{ global\.SN_POPUP\?\.conta\?\.\(\{ misura: 'errore-modello'/);
  assert.doesNotMatch(fuori.find(([f]) => f.endsWith('decks.js'))[1], /showToast\([^)]*(non riuscit|Non sono riuscito)/);
});

// Le azioni del tasto destro (#1461): ogni capacità che si fa scegliendo una voce del menu ha la sua attesa. La misura
// la fa il menu stesso (`azione` sulla voce), una regola per tutte; le funzioni coi modelli si contano come usi.
test('ogni voce del tasto destro che fa un’azione del catalogo la misura, e il menu la misura da solo', () => {
  const menu = leggi('src', 'content', 'menu.js');
  assert.match(menu, /function open\(\{ x, y, items, keepOnScroll, alChiudere \}\) \{\s*misuraLeAzioni\(items\);/);
  assert.match(leggi('src', 'content', 'menuNelloStrato.js'), /Menu\.open = \(o\) => \{ if \(o\) Menu\.misuraLeAzioni\(o\.items\);/);
  // Le pagine di Filo danno le loro voci allo stesso menu (SN_VOCI_PAGINA): un'azione lì si misura come nel resto.
  const pagine = readdirSync(join(ROOT, 'src', 'pages'), { recursive: true }).filter((f) => String(f).endsWith('.js'))
    .map((f) => leggi('src', 'pages', String(f))).filter((s) => s.includes('SN_VOCI_PAGINA'));
  assert.ok(pagine.length >= 3, 'le pagine che danno voci al tasto destro si leggono');
  const tutto = [...contenuti.map(([, s]) => s), ...pagine].join('\n');
  const nelMenu = new Set([...tutto.matchAll(/azione: '([a-z0-9-]+)'/g)].map((m) => m[1]));
  for (const id of nelMenu) assert.ok(C.azioni().includes(id), `«${id}» non è nel catalogo delle azioni`);
  const main = ['ipc.js', 'shortcuts.js', 'menu.js', 'tabs.js', 'barraLaterale.js'].map((f) => leggi('src', 'main', f)).join('\n')
    + leggi('src', 'main', 'services', 'handlers', 'nav.js');
  const misurate = new Set([...Object.values(C.AZIONE_DI_ICONA), ...Object.values(C.AZIONE_DI_PAGINA), ...nelMenu,
    ...[...main.matchAll(/(?:azione|gesto\(win,|contata|conta)\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
    ...[...main.matchAll(/'[a-z-]+': '([a-z0-9-]+)'/g)].map((m) => m[1])]);
  // Si scelgono dal menu ma passano da un modello: la loro attesa è quella dell'uso.
  const coiModelli = ['edit-selection', 'dictate'];
  // Gli appunti si aprono con l'icona dell'Editor: la loro attesa è quella di «editor».
  const altroNome = { 'filo-notes': 'editor' };
  const K = globalThis.SN_CAPABILITIES.CAPABILITIES;
  const dalMenu = K.filter((c) => /(menu del tasto destro|[Cc]lic destro)[^.]*?(→|scegli)/.test(String(c.invoke)));
  assert.ok(dalMenu.length >= 15, 'le capacità del tasto destro si riconoscono');
  for (const c of dalMenu) {
    if (coiModelli.includes(c.id)) continue;
    assert.ok(misurate.has(altroNome[c.id] || c.id), `«${c.id}» si sceglie dal tasto destro ma la sua attesa non si misura`);
  }
});

// Ogni menu a comparsa di Filo è un pannello dove si cerca una voce: la regola sta nel menu, non in chi lo apre.
test('i menu a comparsa contano apertura, scelta con il posto e chiusura senza scelta, per tutti', () => {
  const pm = leggi('src', 'main', 'popup-menu.js');
  assert.ok(C.PANNELLI.includes('menu'));
  assert.match(pm, /contaRicerca\(s, 'aperta'\)/);
  assert.match(pm, /contaRicerca\(s, 'scelta', \{ attesaMs: [^}]*posizione:/);
  assert.match(pm, /if \(ric && !ric\.fatta\) contaRicerca\(s, 'vuota'\);/);
  assert.match(pm, /C\.ricerca\('menu', \{ esito, \.\.\.extra \}, \{ incognito: !!\(s\.parent && s\.parent\._filoIncognito\) \}\)/);
});
