// Il filo dell'attesa (#578): i titoli dei nodi si calcolano, mai generati, e il gomitolo cresce col lavoro.
// Regole: patterns/il-filo-dell-attesa.md. Logica pura, niente Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'src', 'pages', 'dashboard');
const require = createRequire(import.meta.url);

function carica() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(DIR, 'filo-attesa.js'), 'utf8'), sandbox, { filename: 'filo-attesa.js' });
  return sandbox.SN_FILO_ATTESA;
}
const F = carica();

test('si carica senza toccare il DOM e si registra', () => {
  assert.equal(typeof F.titoloNodo, 'function');
  assert.equal(typeof F.crea, 'function');
});

test('la pagina lo carica prima del blocco di attività che lo usa', () => {
  const html = readFileSync(join(DIR, 'dashboard.html'), 'utf8');
  const filo = html.indexOf('src="filo-attesa.js"');
  assert.ok(filo > 0, 'dashboard.html non carica filo-attesa.js');
  assert.ok(filo < html.indexOf('src="dashboard-attivita.js"'), 'filo-attesa.js va caricato prima di dashboard-attivita.js');
});

test('una azione: il nome dell\'azione e il suo dettaglio', () => {
  assert.equal(F.titoloNodo([{ tipo: 'CERCA_WEB', testo: 'Cerco sul web: orari treni Bologna', esito: 'ok' }]),
    'Cercato sul web · orari treni Bologna');
  assert.equal(F.titoloNodo([{ tipo: 'TIMER', testo: 'Timer avviato · Pasta · 5 min', esito: 'ok' }]),
    'Avviato un timer · Pasta · 5 min');
  assert.equal(F.titoloNodo([{ tipo: 'CAPACITA_DETTAGLIO', testo: 'Verifico cosa so fare', esito: 'ok' }]),
    'Verificato cosa so fare');
  assert.equal(F.titoloNodo([{ tipo: 'NAVIGA', testo: '', dettaglio: 'trenitalia.com', esito: 'ok' }]),
    'Aperta una pagina · trenitalia.com');
});

test('più azioni dello stesso tipo: il plurale dal verbo e dal conto, al massimo tre dettagli', () => {
  const pagine = ['trenitalia.com', 'italotreno.it', 'omio.it'].map((d) => ({ tipo: 'NAVIGA', testo: '', dettaglio: d, esito: 'ok' }));
  assert.equal(F.titoloNodo(pagine), 'Aperte tre pagine · trenitalia.com, italotreno.it, omio.it');
  const cinque = [...pagine, { tipo: 'NAVIGA', dettaglio: 'a.it', esito: 'ok' }, { tipo: 'NAVIGA', dettaglio: 'b.it', esito: 'ok' }];
  assert.equal(F.titoloNodo(cinque), 'Aperte cinque pagine · trenitalia.com, italotreno.it, omio.it +2');
  // Dei dettagli lunghi si tiene il primo pezzo: tre timer non diventano un paragrafo.
  const timer = [{ tipo: 'TIMER', testo: 'Timer avviato · Pasta · 5 min', esito: 'ok' }, { tipo: 'TIMER', testo: 'Timer avviato · Uovo · 1 min', esito: 'ok' }];
  assert.equal(F.titoloNodo(timer), 'Avviati due timer · Pasta, Uovo');
});

test('più azioni di tipo diverso: nessun verbo le copre, si contano', () => {
  const v = [
    { tipo: 'SVEGLIA', testo: 'Sveglia impostata · 06:00', esito: 'ok' },
    { tipo: 'SALVA_APPUNTO', testo: 'Appunto salvato · treni Bologna', esito: 'ok' },
    { tipo: 'NAVIGA', testo: '', dettaglio: 'trenitalia.com', esito: 'ok' },
  ];
  assert.equal(F.titoloNodo(v), '3 azioni · sveglia, appunto, pagina');
});

test('un\'azione non riuscita o in attesa di conferma tiene la sua frase: il titolo non promette il contrario', () => {
  assert.equal(F.titoloNodo([{ tipo: 'CERCA_WEB', testo: 'Ricerca non riuscita · offline', esito: 'fallita' }]),
    'Ricerca non riuscita · offline');
  assert.equal(F.titoloNodo([{ tipo: 'PULISCI_TAB', testo: 'Conferma chiesta · Riordinare le schede', esito: 'chiesta' }]),
    'Conferma chiesta · Riordinare le schede');
  // Insieme a una riuscita dello stesso tipo il plurale «fatto» mentirebbe: si contano.
  const misto = [
    { tipo: 'CERCA_WEB', testo: 'Cerco sul web: a', esito: 'ok' },
    { tipo: 'CERCA_WEB', testo: 'Ricerca non riuscita', esito: 'fallita' },
  ];
  assert.equal(F.titoloNodo(misto), '2 azioni · ricerca');
  const nessuna = [
    { tipo: 'LEGGI_DOCUMENTO', testo: 'Documento non letto · non trovato', esito: 'fallita' },
    { tipo: 'NAVIGA', testo: 'Link non aperto', esito: 'fallita' },
  ];
  assert.equal(F.titoloNodo(nessuna), '2 azioni non riuscite · documento, pagina');
  assert.equal(F.titoloNodo([]), '');
});

test('un tipo d\'azione sconosciuto non lascia un nodo senza nome', () => {
  assert.equal(F.titoloNodo([{ tipo: 'NUOVA_COSA', testo: 'nuova cosa', esito: 'ok' }]), 'nuova cosa');
  assert.equal(F.titoloNodo([{ tipo: 'NUOVA_COSA', testo: '', esito: 'ok' }]), 'Azione');
});

test('ogni azione registrata ha il suo titolo: un tipo nuovo va in TITOLI', () => {
  globalThis.self = globalThis;
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const L = globalThis.SN_ACTION_LEVELS;
  const tipi = Object.keys(L.REGISTRY || L.registry || {});
  assert.ok(tipi.length > 20, 'il registro delle azioni non si legge più');
  const senza = tipi.filter((t) => !F.TITOLI[t]);
  assert.deepEqual(senza, [], 'azioni senza titolo nel filo dell\'attesa');
});

test('il dettaglio è quello che viene dopo il primo separatore della riga', () => {
  assert.equal(F.dettaglioDi('Cerco sul web: orari'), 'orari');
  assert.equal(F.dettaglioDi('Timer avviato · Pasta · 5 min'), 'Pasta · 5 min');
  assert.equal(F.dettaglioDi('Verifico cosa so fare'), '');
  assert.equal(F.dettaglioDi('  Impostato · tema: chiaro → scuro '), 'tema: chiaro → scuro');
});

test('il gomitolo cresce con la lunghezza vera del filo, fino a stare in una riga', () => {
  const corto = F.raggioGomitolo(30);
  const medio = F.raggioGomitolo(90);
  const lungo = F.raggioGomitolo(180);
  assert.ok(corto < medio && medio < lungo, `raggi ${corto}, ${medio}, ${lungo}`);
  assert.ok(F.raggioGomitolo(100000) <= 11.5, 'il gomitolo esce dalla sua riga');
});

test('le durate si leggono in millisecondi o secondi, con un tetto', () => {
  assert.equal(F.ms('450ms', 1), 450);
  assert.equal(F.ms('0.8s', 1), 800);
  assert.equal(F.ms(' 0ms ', 1), 0);
  assert.equal(F.ms('', 7), 7);
  assert.equal(F.ms('lento', 7), 7);
  assert.equal(F.ms('99s', 1), 10000);
});

test('le durate del filo sono token estetici validati come durate', () => {
  require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
  const T = globalThis.SN_THEME_TOKENS;
  for (const n of ['filo.nodo.durata', 'filo.gomitolo.durata']) {
    assert.equal(T.get(n).type, 'time');
    assert.ok(T.validate(n, '450ms'));
    assert.ok(T.validate(n, '1.2s'));
    assert.ok(T.validate(n, '0ms'));
    assert.ok(!T.validate(n, '20s'));
    assert.ok(!T.validate(n, '450'));
    assert.ok(!T.validate(n, '1s; color: red'));
  }
  assert.ok(T.validate('filo.trama.opacity', '0.3'));
  assert.match(T.pageCss({ 'filo.nodo.durata': '900ms' }), /--dash-filo-nodo: 900ms;/);
  assert.match(T.pageCss({ 'filo.trama.opacity': '0.2' }), /--dash-trama-opacity: 0.2;/);
  const css = readFileSync(join(DIR, 'dashboard.css'), 'utf8');
  for (const v of ['--dash-filo-nodo: 450ms', '--dash-filo-gomitolo: 850ms', '--dash-trama-opacity: 0.5']) {
    assert.ok(css.includes(v), `dashboard.css non ha il predefinito ${v}, uguale a quello del token`);
  }
});
