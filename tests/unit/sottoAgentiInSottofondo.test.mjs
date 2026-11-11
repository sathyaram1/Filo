// Un worker che lancia sotto-agenti li aspetta senza turni a vuoto (#2304): li lancia in primo piano, e quelli in
// sottofondo li aspetta con `aspetta <biglietto>`, che guarda anche loro. L'audit faceva 1.485 controlli in 21 minuti.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { claudeConSottoAgenti } from '../helpers/sottoAgenti.mjs';
import { sottoAgentiAlLavoro, sottoAgentiVivi, vociSottoAgenti, cartellaSottoAgenti, SOGLIA_FERMO_MS } from '../../scripts/lib/veglia-worker.mjs';
import { USCITA_LAVORO_VIVO, testoLavoroVivo } from '../../scripts/lib/branch-integrity.mjs';
import { USCITA_LIBERA } from '../../scripts/lib/aspetta-cartella.mjs';
import { decidi, comando, FIGLIO_IN_SOTTOFONDO } from '../../scripts/lib/orchestratore-cieco.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANALE = join(RADICE, 'scripts', 'routine-channel.mjs');
const T = 'C'.repeat(43);
const SID = 'sessione-2304';
const MIN = 60 * 1000;
const ADESSO = Date.parse('2026-11-08T00:30:00Z');
const voce = (id, meta, faMin = 1) => ({ id, meta, ms: ADESSO - faMin * MIN });

test('al lavoro: i figli non chiusi e recenti; non il worker, non i chiusi, non gli zitti oltre la soglia, non i figli di un chiuso', () => {
  const voci = [
    voce('w1', { agentType: 'routine-worker' }),
    voce('c1', { agentType: 'Explore', description: 'cerca i buchi', parentAgentId: 'w1' }, 3),
    voce('c2', { agentType: 'Explore', parentAgentId: 'w1', finished: true }),
    voce('c3', { agentType: 'Explore', parentAgentId: 'w1' }, SOGLIA_FERMO_MS / MIN + 1),
    voce('w0', { agentType: 'routine-worker', finished: true }, 40),
    voce('c4', { agentType: 'Explore', parentAgentId: 'w0' }, 2),
    voce('n1', { agentType: 'scettico', parentAgentId: 'c1' }),
    { id: 'rotto', meta: null, ms: ADESSO },
  ];
  const vivi = sottoAgentiAlLavoro(voci, { adesso: ADESSO });
  assert.deepEqual(vivi.map((v) => v.nome), ['Explore', 'scettico']);
  assert.deepEqual(vivi[0], { tipo: 'sotto-agente', nome: 'Explore', descrizione: 'cerca i buchi', etaMs: 3 * MIN });
  assert.deepEqual(sottoAgentiAlLavoro([], { adesso: ADESSO }), []);
  assert.deepEqual(sottoAgentiAlLavoro(undefined), []);
});

test('il testo di chi lavora ancora nomina il sotto-agente, senza caratteri che rompono un --guasto', () => {
  const [s] = sottoAgentiAlLavoro([voce('c1', { agentType: 'Explore', description: 'leggi "tutto" `x` $HOME', parentAgentId: 'w1' }, 2)], { adesso: ADESSO });
  const t = testoLavoroVivo({ vivo: true, segni: [s] }, 'finito di aspettare');
  assert.match(t, /sotto-agente Explore «leggi 'tutto' 'x' 'HOME» al lavoro \(ultimo passo 2 minuti fa\)/);
});

test('letti dalla cartella della sessione come Claude Code la scrive', () => {
  const configDir = claudeConSottoAgenti(SID, [
    { id: 'w1', tipo: 'routine-worker' },
    { id: 'c1', padre: 'w1', tipo: 'Explore', descrizione: 'cercatore' },
    { id: 'c2', padre: 'w1', finito: true },
  ]);
  try {
    const voci = vociSottoAgenti(cartellaSottoAgenti({ sessione: SID, configDir }));
    assert.deepEqual(voci.map((v) => v.id).sort(), ['c1', 'c2', 'w1']);
    assert.deepEqual(sottoAgentiVivi({ sessione: SID, configDir }).map((v) => v.descrizione), ['cercatore']);
    assert.deepEqual(sottoAgentiVivi({ sessione: 'altra', configDir }), [], 'un\'altra sessione non ha figli');
    assert.deepEqual(sottoAgentiVivi({ sessione: '', configDir }), [], 'senza sessione nessuna lettura');
  } finally {
    togliCartella(configDir);
  }
});

const canale = (cwd, env, ...args) => new Promise((ok) => {
  const p = spawn(process.execPath, [CANALE, ...args], { cwd, env: { ...process.env, FILO_REPO_ROOT: cwd, FILO_NO_BEAT: '1', ...env } });
  let so = ''; let se = '';
  p.stdout.on('data', (c) => { so += c; });
  p.stderr.on('data', (c) => { se += c; });
  p.on('close', (code) => ok({ code, so, se }));
});

test('aspetta <biglietto> aspetta anche un sotto-agente in sottofondo: 5 finché lavora, 0 quando ha chiuso', async () => {
  const dir = cartellaTemporanea('aspetta-figli-');
  const vivo = claudeConSottoAgenti(SID, [{ id: 'w1', tipo: 'routine-worker' }, { id: 'c1', padre: 'w1', tipo: 'Explore', descrizione: 'cercatore' }]);
  const chiuso = claudeConSottoAgenti(SID, [{ id: 'w1', tipo: 'routine-worker' }, { id: 'c1', padre: 'w1', finito: true }]);
  try {
    const presto = await canale(dir, { FILO_ASPETTA_FETTA_MS: '1200', CLAUDE_CONFIG_DIR: vivo, CLAUDE_CODE_SESSION_ID: SID }, 'aspetta', T);
    assert.equal(presto.code, USCITA_LAVORO_VIVO, presto.so + presto.se);
    assert.match(presto.so, /sotto-agente Explore «cercatore» al lavoro/);
    assert.match(presto.so, /Rilancia lo stesso comando, subito/);
    const fine = await canale(dir, { FILO_ASPETTA_FETTA_MS: '30000', CLAUDE_CONFIG_DIR: chiuso, CLAUDE_CODE_SESSION_ID: SID }, 'aspetta', T);
    assert.equal(fine.code, USCITA_LIBERA, fine.so + fine.se);
    // Dove i processi non si leggono (Mac, Windows) l'uscita 0 lo dice al posto del «nessun sotto-agente».
    assert.match(fine.so, processiDiSistema() === null ? /i processi non si leggono/ : /nessun tuo sotto-agente è al lavoro/);
  } finally {
    for (const d of [dir, vivo, chiuso]) togliCartella(d);
  }
});

// Il default dello strumento Agent è il sottofondo: il gancio della sessione del giro lo dice al worker nel momento in
// cui succede, così l'attesa non la inventa lui.
test('gancio: un sotto-agente del worker resta intatto; in sottofondo il worker riceve come aspettarlo', () => {
  const opz = { sessione: 's1', creato: ADESSO, adesso: ADESSO, strumenti: '/tmp/filo-strumenti' };
  const dopo = (tool_response) => ({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: 's1', agent_id: 'w1', tool_input: { prompt: 'cerca' }, tool_response });
  const spostato = { status: 'async_launched', agentId: 'c1', outputFile: '/tmp/x/tasks/c1.output' };
  const h = decidi(dopo(spostato), opz).hookSpecificOutput;
  assert.equal(h.updatedToolOutput, undefined, 'il ritorno del figlio resta quello');
  assert.equal(h.additionalContext, `${FIGLIO_IN_SOTTOFONDO} Comando: node /tmp/filo-strumenti/scripts/routine-channel.mjs aspetta <il tuo biglietto>`);
  assert.equal(decidi(dopo('Async agent launched successfully. The agent is working in the background.'), opz).hookSpecificOutput.additionalContext.slice(0, 40), FIGLIO_IN_SOTTOFONDO.slice(0, 40));
  assert.equal(decidi(dopo({ status: 'completed', content: [{ type: 'text', text: 'trovati 3' }] }), opz), null, 'un figlio finito non riceve niente');
  assert.equal(decidi({ ...dopo(spostato), hook_event_name: 'PreToolUse', tool_input: { prompt: 'cerca', run_in_background: true } }, opz), null, 'il lancio non si tocca');
  assert.equal(decidi(dopo(spostato), { ...opz, strumenti: '' }).hookSpecificOutput.additionalContext, FIGLIO_IN_SOTTOFONDO);
  assert.doesNotMatch(FIGLIO_IN_SOTTOFONDO, /['\\]/, 'il testo finisce fra apici singoli nella shell del gancio');
  assert.doesNotThrow(() => comando({ sessione: 's1', creato: ADESSO, registro: '/tmp/r.json', strumenti: '/tmp/filo-strumenti' }));
});

test('il contratto dei worker dice come si aspetta un sotto-agente, e lo dice a ogni ruolo che lavora', () => {
  const contratto = readFileSync(join(RADICE, 'routines', 'roles', '_contratto-worker.md'), 'utf8').replace(/\s+/g, ' ');
  const da = contratto.indexOf('## Sotto-agenti');
  const sezione = contratto.slice(da, contratto.indexOf('## ', da + 3));
  assert.match(sezione, /run_in_background: false/, 'il primo piano si scrive nella chiamata');
  assert.match(sezione, /più d'uno nello stesso messaggio/);
  assert.match(sezione, /si aspetta con `aspetta`/);
  assert.match(sezione, /mai con controlli ripetuti/);
  assert.match(contratto, /nessun tuo sotto-agente è al lavoro/, 'l\'uscita 0 di aspetta li comprende');
  assert.match(contratto, /si aspetta prima del rilascio/);
  const dispatch = readFileSync(join(RADICE, 'scripts', 'dispatch.mjs'), 'utf8');
  for (const ruolo of ['compito', 'verifier', 'secaudit', 'new-work', 'fixer', 'manutentore']) {
    assert.match(dispatch, new RegExp(`RUOLI_LAVORABILI = \\[[^\\]]*'${ruolo}'`), `${ruolo} riceve il contratto`);
  }
  const verifier = readFileSync(join(RADICE, 'routines', 'roles', 'verifier.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(verifier, /lancia UN sotto-agente in primo piano \(`subagent_type: routine-lettura`, `run_in_background: false`/);
});
