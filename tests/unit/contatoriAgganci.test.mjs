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
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'disposizioneIcone', 'actionTools', 'contatoriGiornalieri']) {
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

test('un’icona della barra si conta una volta sola: quelle della pagina nella pagina, quelle della finestra nel main', () => {
  const D = globalThis.SN_DISPOSIZIONE_ICONE;
  const icone = leggi('src', 'content', 'menuIcons.js');
  // Il registro della pagina ha solo le sue azioni (#1246), e le conta tutte dal clic alla fine.
  const nelRegistro = [...icone.matchAll(/^\s+(\w+):\s*\{ id: '(\w+)'/gm)].map((m) => m[2]);
  const dellaPagina = Object.keys(D.ICONE).filter((id) => D.ICONE[id].tipo === 'pagina');
  assert.deepEqual([...nelRegistro].sort(), [...dellaPagina].sort());
  assert.match(icone, /for \(const \[id, voce\] of Object\.entries\(reg\)\) contaIcona\(id, voce\)/);
  // La barra le manda alla pagina e se ne va prima di contare: quelle della finestra le conta lei, una volta.
  const barra = leggi('src', 'main', 'barraLaterale.js');
  const esegui = /\n {2}esegui\(id[^\n]*\{\n([\s\S]*?)\n {2}\}/.exec(barra);
  assert.ok(esegui, 'manca esegui() nella barra');
  const pagina = esegui[1].indexOf("if (d.tipo === 'pagina')");
  const conta = esegui[1].indexOf('AzioniContate.azione(');
  assert.ok(pagina > 0 && conta > pagina && /if \(d\.tipo === 'pagina'\) \{[\s\S]*?return;\s*\}/.test(esegui[1]),
    'un’azione della pagina dalla barra la conta la pagina, non anche il main');
  for (const id of Object.keys(D.ICONE)) {
    if (D.ICONE[id].tipo === 'aiuto') continue;
    assert.ok(C.AZIONE_DI_ICONA[id], `l’icona ${id} non vale nessuna azione contata`);
  }
});

test('i gesti contati nelle pagine mandano solo nomi da elenchi chiusi e numeri', () => {
  const tutto = contenuti.map(([, s]) => s).join('\n')
    + leggi('src', 'pages', 'dashboard', 'dashboard-cerca.js') + leggi('src', 'pages', 'editor', 'editor.js') + leggi('src', 'shared', 'comboBox.js')
    + leggi('src', 'shared', 'ascolto.js') + leggi('src', 'pages', 'dashboard', 'dashboard.js');
  for (const m of tutto.matchAll(/misura: '([a-z-]+)'/g)) {
    assert.ok(['azione', 'icona', 'ricerca', 'proposta', 'annullato', 'chiesto', 'avviso', 'errore-modello', 'intervista',
      'tasto-annulla', 'anticipo-aperto', 'conferma', 'gesto', 'reazione', 'copia', 'aiuto', 'ricerca-web-tetto', 'dettatura', 'lettura',
      'suggerimento', 'in-corso'].includes(m[1]), m[1]);
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
  // Anche le icone della barra laterale (#1246): le azioni sulla pagina stanno lì, non più nel menu.
  const dalMenu = K.filter((c) => /(menu del tasto destro|[Cc]lic destro)[^.]*?(→|scegli)|[Ii]cona «[^»]+»[^.]*?barra laterale/.test(String(c.invoke)));
  assert.ok(dalMenu.length >= 20, 'le capacità del tasto destro e della barra si riconoscono');
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

// La chat (#1463): le reazioni e le copie che la home manda sono dell'elenco chiuso, e ogni chiusura di una chat dice
// la sua via; una chiusura senza via non si conterebbe.
test('la home manda reazioni e copie dell’elenco chiuso, e ogni chiusura di una chat dice come è finita', () => {
  const home = leggi('src', 'pages', 'dashboard', 'dashboard.js');
  const handlers = leggi('src', 'main', 'services', 'handlers.js');
  const filo = leggi('src', 'main', 'services', 'handlers', 'filo.js');
  const dette = [...home.matchAll(/contaReazione\('([a-z_]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(dette.filter((v) => !C.REAZIONI.includes(v)), []);
  assert.ok(dette.includes('riprova') && dette.includes('seguito_scritto'));
  // Lo stop porta la fase che la persona vedeva; «Continua» il motivo che il main ha dato alla risposta senza risposta.
  assert.match(home, /contaReazione\(`ferma_\$\{t\.fase\}`\)/);
  const fasi = new Set([...home.matchAll(/fase(?: =|:) '([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...fasi].sort(), ['durante_azioni', 'durante_testo', 'prima_del_testo']);
  for (const f of fasi) assert.ok(C.REAZIONI.includes(`ferma_${f}`), f);
  const motivi = new Set([...handlers.matchAll(/senzaRisposta = \{[^}]*motivo: '([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...motivi].sort(), ['muto_dopo_letture', 'tagliato', 'tetto_giri']);
  for (const m of motivi) { assert.ok(C.ESITI_TURNO.includes(m), m); assert.ok(C.REAZIONI.includes(`continua_${m}`), m); }
  for (const m of home.matchAll(/ruolo: '([a-z_]+)'|return '([a-z_]+)';/g)) {
    const r = m[1] || m[2];
    if (['attivita', 'utente', 'risposta'].includes(r)) assert.ok(C.RUOLI_COPIA.includes(r), r);
  }
  assert.match(home, /document\.addEventListener\('copy',/);
  assert.match(home, /document\.addEventListener\('filo-copia',/);
  assert.match(leggi('src', 'content', 'content.js'), /onClick: copia \}/, 'il Copia del tasto destro lo dice alla pagina');

  const chiamate = [...`${handlers}\n${filo}`.matchAll(/closeAndTriageChat\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1])
    .filter((a) => !/^chatId, opz = \{\}$/.test(a));
  assert.ok(chiamate.length >= 5, chiamate.join(' / '));
  for (const a of chiamate) assert.match(a, /\bvia\b/, `closeAndTriageChat(${a}) non dice la via`);
  // Anche la via scelta fra due («uscita» se la scheda se n'è andata con Filo, se no «appesa_all_avvio»).
  const vie = [...chiamate.join('\n').matchAll(/via: (?:\w+ \? )?'([a-z_]+)'(?: : '([a-z_]+)')?/g), ...home.matchAll(/closeCurrentChat\(\{[^}]*via: '([a-z_]+)'/g)]
    .flatMap((m) => m.slice(1).filter(Boolean));
  assert.ok(vie.length >= 6, vie.join(' '));
  assert.deepEqual([...new Set(vie)].filter((v) => !C.VIE_CHIUSURA.includes(v)), []);
  const dallaPagina = /\[([^\]]*)\]\.includes\(msg\.via\)/.exec(filo);
  assert.ok(dallaPagina, 'la via che manda la pagina si controlla');
  for (const v of [...dallaPagina[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) assert.ok(C.VIE_CHIUSURA.includes(v), v);
});
