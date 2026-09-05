// Unit test per src/shared/actionTools.js (SN_ACTION_TOOLS): le azioni della
// chat come strumenti nativi del modello.
//
// La sentinella che conta: il registro dei LIVELLI (actionLevels.js) e
// l'elenco degli STRUMENTI devono combaciare. Uno strumento senza livello non
// si esegue mai (il dispatch rifiuta le azioni fuori registro); un livello
// senza strumento è un potere che il modello non può più chiamare. Il resto
// fissa la forma delle definizioni, la traduzione chiamata → azione (argomenti
// rotti compresi) e la tolleranza per il formato vecchio.

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
  for (const fn of ['definitions', 'toolCallsToActions', 'legacyEnvelope', 'assistantMessage', 'toolMessage', 'haRisultato']) {
    assert.equal(typeof Tools[fn], 'function', `manca ${fn}()`);
  }
});

test('sentinella: ogni azione del registro dei livelli è uno strumento, e viceversa', () => {
  const levels = Object.keys(Levels.REGISTRY).sort();
  const tools = Tools.NAMES.slice().sort();
  assert.deepEqual(tools, levels, 'registro dei livelli e strumenti divergono');
});

test('le definizioni hanno la forma che il fornitore capisce', () => {
  const defs = Tools.definitions({ sistema: 'win32' });
  assert.ok(defs.length > 20);
  for (const d of defs) {
    assert.equal(d.type, 'function');
    assert.match(d.function.name, /^[A-Z_]+$/, `nome non valido: ${d.function.name}`);
    assert.ok(d.function.description.length > 20, `descrizione vuota: ${d.function.name}`);
    assert.equal(d.function.parameters.type, 'object');
    assert.ok(Array.isArray(d.function.parameters.required));
    for (const r of d.function.parameters.required) {
      assert.ok(r in d.function.parameters.properties, `${d.function.name}: obbligatorio "${r}" senza schema`);
    }
  }
  // ONBOARDING solo durante l'intervista di benvenuto.
  assert.ok(!defs.some((d) => d.function.name === 'ONBOARDING'));
  const onb = Tools.definitions({ sistema: 'win32', onboarding: true });
  assert.ok(onb.some((d) => d.function.name === 'ONBOARDING'));
  assert.equal(onb.length, defs.length + 1);
});

test('le descrizioni che dipendono dal sistema lo dicono per quel sistema', () => {
  const win = Tools.definitions({ sistema: 'win32' }).find((d) => d.function.name === 'IMPOSTA_PREFERENZA').function.description;
  const mac = Tools.definitions({ sistema: 'darwin' }).find((d) => d.function.name === 'IMPOSTA_PREFERENZA').function.description;
  assert.ok(win.includes(C.descriviSistema('win32').shellPref));
  assert.ok(mac.includes(C.descriviSistema('darwin').shellPref));
  assert.notEqual(win, mac);
  const doc = Tools.definitions({ sistema: 'darwin' }).find((d) => d.function.name === 'LEGGI_DOCUMENTO').function.description;
  assert.ok(!/C:\\/.test(doc), 'un esempio di percorso Windows finirebbe davanti a chi sta su un Mac');
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
