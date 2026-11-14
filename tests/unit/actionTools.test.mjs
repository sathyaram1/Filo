// src/shared/actionTools.js: gli strumenti generali del modello e la strada da strumento(azione) al tipo eseguito.
// Sentinella: registro dei costi e azioni combaciano (un'azione senza costo non parte, un costo senza azione non si
// chiama), e ogni azione si raggiunge da uno strumento coi suoi parametri.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');
const Tools = globalThis.SN_ACTION_TOOLS;
const Levels = globalThis.SN_ACTION_LEVELS;
const C = globalThis.SN_CONST;

test('si registra su globalThis con la sua API', () => {
  assert.ok(Tools, 'SN_ACTION_TOOLS assente');
  for (const fn of ['definitions', 'toolCallsToActions', 'legacyEnvelope', 'assistantMessage', 'toolMessage', 'haRisultato', 'chiamata']) {
    assert.equal(typeof Tools[fn], 'function', `manca ${fn}()`);
  }
});

test('sentinella: ogni azione del registro dei livelli è uno strumento, e viceversa', () => {
  const levels = Object.keys(Levels.REGISTRY).sort();
  const tools = Tools.NAMES.slice().sort();
  assert.deepEqual(tools, levels, 'registro dei livelli e strumenti divergono');
});

test('le definizioni sono una decina di strumenti generali, ognuno con la sua azione (SPEC-CONTESTO § Gli strumenti)', () => {
  const defs = Tools.definitions();
  assert.ok(defs.length >= 8 && defs.length <= 12, `strumenti: ${defs.length}`);
  for (const d of defs) {
    assert.equal(d.type, 'function');
    assert.match(d.function.name, /^[a-z_]+$/, `nome non valido: ${d.function.name}`);
    assert.ok(d.function.description.length > 20, `descrizione vuota: ${d.function.name}`);
    const p = d.function.parameters;
    assert.equal(p.type, 'object');
    assert.deepEqual(p.required, ['azione']);
    assert.deepEqual(p.properties.azione.enum, Object.keys(Tools.AZIONI[d.function.name]));
    for (const a of p.properties.azione.enum) {
      assert.ok(d.function.description.includes(`\n- ${a}(`), `${d.function.name}: l'azione ${a} non è descritta`);
    }
  }
});

test('ogni azione di oggi si raggiunge da uno strumento generale, con tutti i suoi parametri', () => {
  const defs = Object.fromEntries(Tools.definitions().map((d) => [d.function.name, d.function.parameters.properties]));
  const viste = new Set();
  for (const tipo of Tools.NAMES) {
    const [s, a] = Tools.TOOLS[tipo].via;
    assert.equal(Tools.AZIONI[s][a], tipo, `${tipo}: ${s}(${a}) non porta qui`);
    assert.ok(!viste.has(`${s}(${a})`), `${s}(${a}) è di due azioni`);
    viste.add(`${s}(${a})`);
    const props = Tools.TOOLS[tipo].properties;
    for (const k of Object.keys(typeof props === 'function' ? props({}) : props)) {
      assert.ok(k in defs[s], `${tipo}: il parametro ${k} manca in ${s}`);
    }
  }
});

// Un valore d'esempio per ogni tipo di parametro, così la chiamata nuova e la vecchia portano gli stessi campi.
function esempio(sch) {
  const t = sch.anyOf ? sch.anyOf[0] : sch;
  if (t.enum) return t.enum[0];
  if (t.type === 'integer' || t.type === 'number') return 3;
  if (t.type === 'boolean') return true;
  if (t.type === 'array') return [esempio(t.items || { type: 'string' })];
  if (t.type === 'object') return { selettore: 'h1', css: 'color:red' };
  return 'x';
}

test('i parametri di oggi arrivano agli stessi gestori: strumento(azione) dà la stessa azione del nome vecchio', () => {
  for (const tipo of Tools.NAMES) {
    const t = Tools.TOOLS[tipo];
    const props = typeof t.properties === 'function' ? t.properties({}) : t.properties;
    const args = Object.fromEntries(Object.entries(props).map(([k, sch]) => [k, esempio(sch)]));
    const [nuova] = Tools.toolCallsToActions([{ id: 'n', name: t.via[0], arguments: JSON.stringify({ azione: t.via[1], ...args }) }]);
    const [vecchia] = Tools.toolCallsToActions([{ id: 'n', name: tipo, arguments: JSON.stringify(args) }]);
    assert.deepEqual(nuova, vecchia, tipo);
    assert.ok(!nuova._argsError, `${tipo}: ${nuova._argsError}`);
    assert.ok(Levels.REGISTRY[nuova.type], `${tipo}: il registro dei costi non la conosce`);
  }
});

test('azione mancante, sconosciuta o senza i suoi campi: l\'errore torna al modello e l\'azione non parte', () => {
  const [senza, ignota, monca, ok] = Tools.toolCallsToActions([
    { id: 'a', name: 'scheda', arguments: '{"url":"https://example.com"}' },
    { id: 'b', name: 'scheda', arguments: '{"azione":"vola"}' },
    { id: 'c', name: 'promemoria', arguments: '{"azione":"timer","etichetta":"Pasta"}' },
    { id: 'd', name: 'promemoria', arguments: '{"azione":"timer","secondi":600}' },
  ]);
  assert.match(senza._argsError, /manca l'azione in scheda: scegli fra apri, /);
  assert.match(ignota._argsError, /l'azione «vola» non c'è in scheda/);
  assert.match(monca._argsError, /per promemoria\(timer\) manca secondi/);
  assert.deepEqual(ok, { type: 'TIMER', secondi: 600, _callId: 'd' });
  assert.equal(Tools.chiamata('CERCA_CHAT'), 'filo(cerca)');
});

// #1564: i valori delle chiavi frequenti escono dal setter; il colore delle schede non ha voce in impostazioni(leggi),
// quindi questa riga è l'unico posto da cui il modello impara «più preciso».
test('impostazioni(imposta) porta i valori delle chiavi frequenti presi dalle impostazioni', () => {
  require('../../src/shared/preferences.js');
  const d = Tools.TOOLS.IMPOSTA_PREFERENZA.description({});
  assert.match(d, /colore_tab \(più vivaci\|più neutre\|nessuno\|più preciso\|predefinito\)/);
  assert.match(d, /tema \(sistema\|chiaro\|scuro\)/);
});

// #1564: il modello copia i nomi dell'azione accanto; due nomi per lo stesso dato in uno strumento facevano respingere
// come mancante un campo che il gestore sa leggere.
test('dentro uno strumento un dato ha un nome solo', () => {
  const SINONIMI = [['time', 'orario', 'at'], ['label', 'etichetta'], ['dominio', 'domain', 'sito'], ['seconds', 'secondi']];
  for (const d of Tools.definitions()) {
    const nomi = Object.keys(d.function.parameters.properties);
    for (const gruppo of SINONIMI) {
      const usati = gruppo.filter((n) => nomi.includes(n));
      assert.ok(usati.length <= 1, `${d.function.name}: ${usati.join(' e ')} sono lo stesso dato`);
    }
  }
  const [allunga, sposta, ricorre, sveglia, vuota] = Tools.toolCallsToActions([
    { id: 'a', name: 'promemoria', arguments: '{"azione":"modifica","etichetta":"pasta","secondi":600}' },
    { id: 'b', name: 'promemoria', arguments: '{"azione":"modifica","etichetta":"palestra","orario":"08:00"}' },
    { id: 'c', name: 'promemoria', arguments: '{"azione":"modifica","etichetta":"palestra","ripeti":"feriali"}' },
    { id: 'd', name: 'promemoria', arguments: '{"azione":"sveglia","orario":"07:30","etichetta":"palestra"}' },
    { id: 'e', name: 'promemoria', arguments: '{"azione":"modifica","etichetta":"pasta"}' },
  ]);
  for (const a of [allunga, sposta, ricorre, sveglia]) assert.equal(a._argsError, undefined, JSON.stringify(a));
  assert.match(vuota._argsError, /per promemoria\(modifica\) serve almeno uno fra orario, secondi, ripeti/);
});

test('filo(espandi) è una lettura: costo 0, e quello che riporta da fuori torna sospetto come la prima volta', () => {
  assert.equal(Levels.costoFor({ type: 'ESPANDI_FILO', da: '2026-11-12T20:00' }), 0);
  assert.ok(Levels.diSolaLettura('ESPANDI_FILO'));
  assert.equal(Levels.fonteDi({ type: 'ESPANDI_FILO', _output: { righe: 2, esterno: false, classeLetta: 1 } }), null);
  assert.equal(Levels.fonteDi({ type: 'ESPANDI_FILO', _output: { righe: 2, esterno: true, classeLetta: 1 } }).classe, 5);
  assert.equal(Levels.fonteDi({ type: 'ESPANDI_FILO', _output: { righe: 2, esterno: false, classeLetta: 3 } }).classe, 3);
});

test('intervista: le voci da spuntare sono quelle dell’intervista, e c’è la scelta dell’autonomia (#1188)', () => {
  const props = Tools.definitions().find((d) => d.function.name === 'filo_su_di_se').function.parameters.properties;
  assert.deepEqual(props.spunta.items.enum, globalThis.SN_ONBOARDING.ITEM_IDS, 'una voce nuova dell’intervista arriva da sola allo strumento');
  assert.ok(props.spunta.items.enum.includes('autonomia'));
  assert.equal(props.autonomia.type, 'boolean');
});

test('gli strumenti sono gli stessi su ogni sistema: shell e percorsi di questo computer li dice la parte dell\'utente', () => {
  const defs = Tools.definitions();
  for (const d of defs) assert.ok(!/C:\\|\/Users\/|\/home\//.test(d.function.description), `${d.function.name}: un percorso di un sistema solo`);
  assert.ok(defs.find((d) => d.function.name === 'file').function.description.includes("IL COMPUTER DELL'UTENTE"));
});

test('il prompt della chat non descrive più il formato JSON, ma spiega gli strumenti', () => {
  const s = C.PROMPTS.filoChat({ capacita: 'x', sistema: 'win32', profilo: '', preferenze: '', stato: '', files: '' });
  assert.ok(!s.includes('"actions"'));
  assert.ok(!s.includes('FORMATO OUTPUT'));
  assert.ok(s.includes('COME LAVORI IN UN TURNO'));
  assert.ok(/Prima AGISCI, poi PARLI/.test(s));
});

test('chiamate del modello → azioni: argomenti letti, tipo e id della chiamata fissati', () => {
  const acts = Tools.toolCallsToActions([
    { id: 'c1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
    { id: 'c2', function: { name: 'cerca_web', arguments: '{"query":"meteo domani","type":"NAVIGA"}' } },
    { id: 'c3', name: 'SVEGLIA', arguments: { time: '07:00' } },
  ]);
  assert.equal(acts.length, 3);
  assert.deepEqual(acts[0], { secondi: 300, etichetta: 'Pasta', type: 'TIMER', _callId: 'c1' });
  // Il nome vince sull'argomento omonimo: un "type" negli argomenti non cambia azione.
  assert.equal(acts[1].type, 'CERCA_WEB');
  assert.equal(acts[1].query, 'meteo domani');
  assert.equal(acts[1]._callId, 'c2');
  assert.equal(acts[2].time, '07:00');
});

test('argomenti rotti: l\'azione porta l\'errore invece di sparire in silenzio', () => {
  const acts = Tools.toolCallsToActions([
    { id: 'c1', name: 'CERCA_WEB', arguments: '{"query": "senza chiusura' },
    { id: 'c2', name: 'CERCA_WEB', arguments: '[1,2]' },
    { id: 'c3', name: '', arguments: '{}' },
  ]);
  assert.equal(acts.length, 2, 'una chiamata senza nome non è un\'azione');
  assert.equal(acts[0].type, 'CERCA_WEB');
  assert.match(acts[0]._argsError, /non leggibili/);
  assert.match(acts[1]._argsError, /oggetto JSON/);
});

test('formato vecchio: il JSON nel testo viene ancora letto, la prosa no', () => {
  const env = Tools.legacyEnvelope('```json\n{"text":"Ecco.","actions":[{"type":"TIMER","seconds":60}]}\n```');
  assert.deepEqual(env, { text: 'Ecco.', actions: [{ type: 'TIMER', seconds: 60 }] });
  assert.equal(Tools.legacyEnvelope('Ciao, come posso aiutarti?'), null);
  assert.equal(Tools.legacyEnvelope('{"altro": 1}'), null, 'un JSON qualunque non è la busta della chat');
  assert.deepEqual(Tools.legacyEnvelope('{"text":"solo testo"}'), { text: 'solo testo', actions: [] });
  // Coda spuria dopo la busta (il modello ha scritto altro): si legge la busta.
  assert.equal(Tools.legacyEnvelope('{"text":"ok","actions":[]} grazie').text, 'ok');
});

test('i messaggi da rimandare al fornitore hanno la forma giusta', () => {
  const m = Tools.assistantMessage({
    text: 'Cerco…',
    toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"x"}' }, { name: 'TIMER', arguments: { secondi: 5 } }],
    reasoningDetails: [{ type: 'reasoning.text', text: 'penso' }],
  });
  assert.equal(m.role, 'assistant');
  assert.equal(m.content, 'Cerco…');
  assert.equal(m.tool_calls.length, 2);
  assert.deepEqual(m.tool_calls[0], { id: 'c1', type: 'function', function: { name: 'CERCA_WEB', arguments: '{"query":"x"}' } });
  assert.equal(m.tool_calls[1].function.arguments, '{"secondi":5}');
  assert.ok(m.tool_calls[1].id, 'una chiamata senza id ne riceve uno');
  assert.deepEqual(m.reasoning_details, [{ type: 'reasoning.text', text: 'penso' }]);
  const plain = Tools.assistantMessage({ text: '', toolCalls: [], reasoningDetails: [] });
  assert.ok(!('tool_calls' in plain) && !('reasoning_details' in plain));
  assert.deepEqual(Tools.toolMessage('c1', 'esito'), { role: 'tool', tool_call_id: 'c1', content: 'esito' });
});

test('haRisultato distingue chi riporta un esito da leggere da chi conferma e basta', () => {
  for (const t of ['CERCA_WEB', 'LEGGI_FILE', 'LEGGI_DOCUMENTO', 'LEGGI_TRASPARENZA', 'CAPACITA_DETTAGLIO', 'ESEGUI_COMANDO']) {
    assert.ok(Tools.haRisultato(t), t);
  }
  for (const t of ['TIMER', 'NAVIGA', 'SVEGLIA']) assert.ok(!Tools.haRisultato(t), t);
});
