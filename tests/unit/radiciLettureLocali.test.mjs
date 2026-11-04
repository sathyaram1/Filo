// #1918: in una sessione locale chi legge dice al server COSA ha letto, e il server ne legge le radici; una
// conversazione scritta da biglietti puliti non sporca. Le regole del server stanno in filo-security (radiciLetture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { motiviDiLettura, sporca, rigaSporco, cartellaSporchi, ENV_FILE } from '../../scripts/lib/biglietto-locale.mjs';
import { radiceLettura } from '../../scripts/lib/letture-esterne.mjs';
import { lettiDi } from '../../scripts/domanda.mjs';

const TURNO_ROUTINE = "--- Aggiornamento dell'agente del 1/11/2026 ---\nReport del lavoro.";

function biglietto() {
  const dir = cartellaTemporanea('radici-locali-');
  const file = join(dir, 'biglietto.json');
  writeFileSync(file, JSON.stringify({ ticket: 'x'.repeat(40), fp: 'f'.repeat(64), natoIl: 1 }));
  return { dir, file, b: { path: file, fp: 'f'.repeat(64) } };
}

function server(risposta) {
  const mandati = [];
  const fetchImpl = async (_url, init) => {
    mandati.push(JSON.parse(init.body).data);
    return { ok: true, status: 200, json: async () => ({ result: Object.assign({ ok: true }, risposta) }) };
  };
  return { mandati, deps: { fetchImpl, idToken: async () => 'token-finto' } };
}

test('la conversazione: scritta da biglietti puliti non sporca; senza saperlo, il dubbio resta e decide il server', () => {
  assert.deepEqual(motiviDiLettura({ fiducia: 'fidato', notes: TURNO_ROUTINE, scrittoSporco: false }), []);
  assert.deepEqual(motiviDiLettura({ fiducia: 'fidato', notes: TURNO_ROUTINE }), ['conversazione con scritti di routine o sessioni']);
  assert.deepEqual(motiviDiLettura({ fiducia: 'fidato', notes: '', scrittoSporco: true }), ['conversazione con scritti di routine o sessioni']);
  assert.deepEqual(motiviDiLettura({ fiducia: 'non_fidato', notes: '' }), ['testo di un feedback non fidato']);
});

test('chi legge nomina cosa ha letto: al server vanno le letture e le radici, mai solo il motivo', async () => {
  const { dir, file } = biglietto();
  const s = server({ fiducia: 'non_fidato' });
  const r = await sporca('letto #1500: testo di un feedback non fidato', {
    env: { [ENV_FILE]: file }, cwd: dir, radici: ['feedback:1500'], letti: [{ tipo: 'feedback', id: 'abc' }, { tipo: 'feedback', id: 'abc' }], deps: s.deps,
  });
  assert.equal(r.sporcati, 1);
  const d = s.mandati.find((x) => x.op === 'sporca');
  assert.deepEqual(d.radici, ['feedback:1500']);
  assert.deepEqual(d.letti, [{ tipo: 'feedback', id: 'abc' }]);
  assert.equal(d.senzaCosa, undefined);
});

test('se il server dice che era tutto fidato la sessione non si dice sporca, e non resta il segno di sporco', async () => {
  const { dir, file, b } = biglietto();
  const s = server({ fiducia: 'fidato', pulito: true });
  const riga = await rigaSporco('letto #1500', ['conversazione con scritti di routine o sessioni'], {
    env: { [ENV_FILE]: file }, cwd: dir, letti: [{ tipo: 'feedback', id: 'abc' }], deps: s.deps,
  });
  assert.match(riga, /NON sporcato: letto #1500 viene da testo fidato/);
  const resti = existsSync(cartellaSporchi(b)) ? readdirSync(cartellaSporchi(b)) : [];
  assert.deepEqual(resti, [], 'niente annotazioni in attesa e niente segno «sporco sul server»');
});

test('una lettura che non dice cosa ha letto lo dichiara: il server le dà la radice del biglietto', async () => {
  const { dir, file } = biglietto();
  const s = server({ fiducia: 'non_fidato' });
  await sporca('ho letto una cosa', { env: { [ENV_FILE]: file }, cwd: dir, deps: s.deps });
  assert.equal(s.mandati.find((x) => x.op === 'sporca').senzaCosa, true);
});

test('il gancio sa dire la radice di una pagina, di una ricerca, di un server MCP e di un file fuori dal repo', () => {
  assert.equal(radiceLettura({ tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it/a?b=1' } }), 'web:https://esempio.it/a?b=1');
  assert.equal(radiceLettura({ tool_name: 'WebFetch', tool_input: { url: 'file:///etc/passwd' } }), '');
  assert.equal(radiceLettura({ tool_name: 'WebSearch', tool_input: { query: 'prezzo pizza' } }), 'web:ricerca prezzo pizza');
  assert.equal(radiceLettura({ tool_name: 'mcp__claude-in-chrome__navigate', tool_input: {} }), 'mcp:claude-in-chrome');
  assert.equal(radiceLettura({ tool_name: 'Read', tool_input: { file_path: '/altrove/nota.txt' } }, { cwd: '/' }), 'file:/altrove/nota.txt');
  assert.equal(radiceLettura({ tool_name: 'Artifact', tool_input: { action: 'read' } }), '');
});

test('le domande lette si nominano col loro numero; un id che non è una domanda non passa', () => {
  assert.deepEqual(lettiDi(['D-12', '?', 'D-x', 'D-3']), [{ tipo: 'domanda', id: 'D-12' }, { tipo: 'domanda', id: 'D-3' }]);
});
