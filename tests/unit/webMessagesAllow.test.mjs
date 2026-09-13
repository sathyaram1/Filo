// #592, giro 9 — cosa una pagina VISITATA può chiedere a Filo.
//
// Il canale dei messaggi è uno solo e ci arrivano sia le pagine interne sia gli
// script che Filo fa girare dentro le pagine web. Il gate era scritto a mano
// dentro i singoli handler, uno per volta, quindi un messaggio nuovo nasceva
// APERTO a qualunque sito visitato: da un indirizzo web si leggevano lo stato
// che il modello legge a ogni messaggio (schede aperte, sveglie, notifiche,
// registro delle azioni, messaggio della home), l'archivio delle schede chiuse e
// le pagine messe da parte; si scriveva una sveglia il cui NOME finisce in ogni
// prompt; si svuotava l'archivio delle schede.
//
// Adesso l'elenco è di ciò che è lecito e il gate è uno solo, nel dispatch.
// Questa sentinella tiene le due metà che un elenco così può perdere:
//   • dentro NON c'è niente che riguardi la memoria di Filo, lo stato del
//     prompt, le cronologie o i dati messi da parte — se qualcuno ce lo rimette,
//     qui diventa rosso;
//   • ogni messaggio che gli script delle pagine visitate mandano DAVVERO sta
//     nell'elenco: senza, quella funzione smetterebbe di funzionare in silenzio
//     su ogni sito, e un elenco scritto a mano invecchia senza dirlo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const radice = join(__dirname, '..', '..');
require(join(radice, 'src', 'shared', 'messages.js'));
const { MSG, WEB_ALLOWED } = globalThis.SN_MSG;

test('nell\'elenco non c\'è la memoria di Filo, lo stato del prompt né le cronologie', () => {
  const vietati = [
    // La memoria e le lezioni: una riga entrata da fuori sta in ogni prompt.
    MSG.FILO_GET_MEMORY, MSG.FILO_LIST_MEMORY, MSG.FILO_COMPACT_MEMORY,
    MSG.FILO_FORGET_LESSON, MSG.FILO_FORGET_MEMORY_LINE, MSG.FILO_FORGET_MEMORY_MODULE,
    // Lo stato che il modello legge a ogni messaggio, e chi lo scrive.
    MSG.FILO_GET_STATE, MSG.FILO_GENERATE_DASHBOARD,
    MSG.FILO_GET_TIMERS, MSG.FILO_ADD_TIMER, MSG.FILO_DELETE_TIMER,
    MSG.FILO_PAUSE_TIMER, MSG.FILO_RESUME_TIMER, MSG.FILO_STOP_TIMER_ALARM,
    MSG.FILO_GET_NOTIFICATIONS, MSG.FILO_DISMISS_NOTIFICATION,
    // Dove è stato l'utente e cosa ha messo da parte.
    MSG.GET_ARCHIVED_TABS, MSG.SEARCH_ARCHIVED_TABS, MSG.DELETE_ARCHIVED_TABS,
    MSG.REMOVE_ARCHIVED_TAB, MSG.CLEAR_ARCHIVED_TABS, MSG.REOPEN_ARCHIVED_TAB,
    MSG.GET_SAVED_PAGES, MSG.REMOVE_SAVED_PAGE, MSG.CONSUME_SAVED_PAGE,
    MSG.GET_CATEGORIES, MSG.RENAME_CATEGORY, MSG.DELETE_CATEGORY,
    MSG.MERGE_CATEGORIES, MSG.MOVE_PAGE_CATEGORY,
    // Le conversazioni con Filo, i costi, il portafoglio, i download.
    MSG.GET_HISTORY, MSG.CLEAR_HISTORY, MSG.GET_COSTS,
    MSG.WALLET_STATE, MSG.DOWNLOADS_LIST,
    // L'intervista di benvenuto e i mazzi.
    MSG.FILO_GET_ONBOARDING, MSG.FILO_RESTART_ONBOARDING,
    MSG.DECKS_LIST, MSG.DECKS_CREATE, MSG.DECKS_UPDATE, MSG.DECKS_DELETE,
    // Spegnere Filo o chiudere tutto quello che l'utente ha aperto.
    MSG.QUIT_APP, MSG.CLOSE_ALL_TABS, MSG.RUN_TAB_TRIAGE, MSG.REORDER_TABS,
  ];
  for (const tipo of vietati) {
    assert.ok(tipo, 'messaggio inesistente: la prova non sta provando niente');
    assert.equal(WEB_ALLOWED.has(tipo), false, `una pagina web può chiamarlo: ${tipo}`);
  }
});

test('ogni voce dell\'elenco è un messaggio che esiste davvero', () => {
  // Canali interni dello shim chrome.*, che non stanno nel catalogo MSG.
  const interni = new Set([
    '_storage:get', '_storage:set', '_storage:remove', '_storage:clear',
    '_tabs:create', '_tabs:remove', 'fetch_link_meta',
  ]);
  const catalogo = new Set(Object.values(MSG));
  for (const tipo of WEB_ALLOWED) {
    assert.ok(
      catalogo.has(tipo) || interni.has(tipo),
      `nell'elenco c'è un messaggio che non esiste: ${tipo}`,
    );
  }
});

test('quello che gli script delle pagine visitate mandano davvero sta nell\'elenco', () => {
  // I nomi si leggono dal CODICE degli script, non da una lista scritta a mano
  // qui: quella invecchierebbe in silenzio, ed è il difetto che l'elenco cura.
  const sorgenti = [];
  const dir = join(radice, 'src', 'content');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) sorgenti.push(join(dir, f));
  sorgenti.push(join(radice, 'src', 'preload', 'page-preload.js'));

  // Solo i messaggi che gli script MANDANO: `type: MSG.X` dentro una
  // sendMessage. I nomi che compaiono altrove nel file sono quelli che lo script
  // RICEVE da un broadcast del main, e non c'entrano con questo elenco.
  const mandati = new Set();
  for (const file of sorgenti) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/type:\s*MSG\.([A-Z0-9_]+)/g)) mandati.add(m[1]);
    for (const m of src.matchAll(/type:\s*['"](_[a-z]+:[a-z]+|fetch_link_meta)['"]/g)) mandati.add(m[1]);
  }
  assert.ok(mandati.size > 30, `trovati troppo pochi messaggi (${mandati.size}): la prova non sta leggendo il codice`);

  // I messaggi che nessun handler serve non c'entrano: sono richieste che il
  // content script manda ad ALTRI content script (il frame in cima, gli altri
  // riquadri), non a Filo.
  const conHandler = new Set();
  const hDir = join(radice, 'src', 'main', 'services', 'handlers');
  const hFile = [join(radice, 'src', 'main', 'services', 'handlers.js')];
  for (const f of readdirSync(hDir).filter((n) => n.endsWith('.js'))) hFile.push(join(hDir, f));
  for (const file of hFile) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bon\(\s*MSG\.([A-Z0-9_]+)/g)) conHandler.add(m[1]);
    for (const m of src.matchAll(/\bon\(\s*['"]([a-z_:][\w:]*)['"]/g)) conHandler.add(m[1]);
  }

  for (const nome of mandati) {
    const tipo = MSG[nome] || nome;
    if (!conHandler.has(nome)) continue;
    assert.equal(
      WEB_ALLOWED.has(tipo), true,
      `uno script delle pagine visitate manda ${nome} e l'elenco non lo ammette: `
      + 'su ogni sito quella funzione risponderebbe "vietato" senza dire niente',
    );
  }
});
