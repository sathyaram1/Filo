// Il pacchetto #2337.3 (con .1, .2, .5) dal lato dell'app: il rapporto di fine sessione conta la rete anche dietro un
// prefisso, una shell figlia o Monitor, e le letture a mano dei rami dei worker; rami, incroci, censimento e righe delle
// schede del manutentore usano la perizia dei non fidati invece di perderli.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

import { chiamaLaRete, leggeIRamiDeiWorker, STRUMENTO_RETE, STRUMENTO_RAMI, analizzaRighe } from '../../scripts/session-report.mjs';
import { motivoLettura } from '../../scripts/lib/letture-esterne.mjs';
import { conNonFidati, senzaChiusi, rigaSchedaServer, rigaPerizia } from '../../scripts/manutentore.mjs';
import { letturaCloud, leggiNonFidati, fileProbabiliDi, riepilogo, NON_FIDATI } from '../../scripts/schede.mjs';

test('la rete dietro un prefisso comune o dentro una shell figlia si conta', () => {
  const rete = [
    'timeout 30 curl https://a.b', 'timeout -k 5 30s wget https://a.b', 'LANG=C curl -s https://a.b', 'A=1 B=2 wget https://a.b',
    'nice -n 10 curl https://a.b', 'stdbuf -oL curl https://a.b', 'bash -c "curl https://a.b"', "sh -c 'wget -q https://a.b'",
    'bash -lc "cd /tmp && curl -s https://a.b"', '/bin/bash -c "timeout 5 curl https://a.b"', 'eval "curl https://a.b"',
    'zsh -c "LANG=C bash -c \\"curl https://a.b\\""', 'env -i PATH=/usr/bin curl https://a.b',
  ];
  for (const c of rete) assert.equal(chiamaLaRete(c), true, c);
  for (const c of ['timeout 30 npm run test:unit', 'LANG=C grep -n curl scripts/a.mjs', 'bash -c "npm run test:unit"', "sh -c 'echo fatto'", 'A=1 node scripts/x.mjs']) {
    assert.equal(chiamaLaRete(c), false, c);
  }
});

test('le letture a mano dei rami dei worker si contano; elencarli no', () => {
  for (const c of ['git log origin/main..origin/worker/abc-20261114T120000Z', 'git -C /tmp/x show origin/worker/abc-1:src/a.js', 'git diff main...worker/abc-1',
    'git --no-pager log --oneline origin/worker/abc-1', 'cd x && git checkout worker/abc-1']) {
    assert.equal(leggeIRamiDeiWorker(c), true, c);
  }
  for (const c of ['git branch -r --list "origin/worker/*"', 'git fetch origin --prune', 'git log --oneline -3', 'git ls-remote origin "refs/heads/worker/*"']) {
    assert.equal(leggeIRamiDeiWorker(c), false, c);
  }
});

test('il rapporto porta la rete di Monitor, comando o indirizzo, e le letture dei rami, dove il server le legge', async () => {
  let k = 0;
  const riga = (name, input) => JSON.stringify({
    type: 'assistant', sessionId: 's', timestamp: '2026-11-14T10:00:00.000Z',
    message: { id: `m${(k += 1)}`, model: 'claude-opus-5', role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: `t${k}`, name, input }] },
  });
  const rep = await analizzaRighe([
    riga('Monitor', { command: 'while true; do curl -s https://a.b; sleep 30; done', description: 'x', timeout_ms: 1000 }),
    riga('Monitor', { ws: { url: 'wss://eventi.esempio.com/flusso' }, description: 'y', timeout_ms: 1000 }),
    riga('Monitor', { command: 'tail -f /tmp/log | grep --line-buffered ERR', description: 'z', timeout_ms: 1000 }),
    riga('Bash', { command: 'git show origin/worker/abc-20261114T120000Z:src/a.js' }),
    riga('Bash', { command: 'timeout 30 curl https://a.b' }),
  ]);
  assert.deepEqual(rep.tools.byName, { Monitor: 3, Bash: 2, [STRUMENTO_RETE]: 3, [STRUMENTO_RAMI]: 1 });
});

test('Monitor che apre un indirizzo sporca la sessione locale; col suo comando vale la shell', () => {
  assert.equal(motivoLettura({ tool_name: 'Monitor', tool_input: { ws: { url: 'wss://eventi.esempio.com/x' } } }), 'Monitor (eventi.esempio.com)');
  assert.equal(motivoLettura({ tool_name: 'Monitor', tool_input: { command: 'tail -f log' } }), '');
});

test('i non fidati aperti restano aperti per i rami e danno i file della perizia agli incroci', async () => {
  const cartella = cartellaTemporanea('filo-2337-3-schede-');
  try {
    // Il censimento: la lettura dal server, coi non fidati e la loro perizia.
    const riga = (n) => ({ _id: `f${n}`, seq: n, subSeq: 0, status: 'todo', priority: 1, updatedAt: '2026-11-14T10:00:00.000Z', waitsFor: [], unisce: [] });
    const perizia = { classe: 7, area: 'browser-schede', unioni: ['900'], file: ['src/main/tabs.js'] };
    const chiama = async () => ({ status: 200, body: { ok: true, resto: [], voci: [
      { num: '900', id: 'f900', riga: riga(900) },
      { num: '901', id: 'f901', riga: riga(901), nonFidato: true, perizia },
    ] } });
    const r = await letturaCloud('tk', { chiama });
    assert.deepEqual(r.periziati, [{ num: '901', id: 'f901', perizia }]);
    mkdirSync(cartella, { recursive: true });
    writeFileSync(join(cartella, NON_FIDATI), JSON.stringify(r.periziati));
    assert.deepEqual(leggiNonFidati(cartella).map((x) => x.num), ['901']);
    // Il riepilogo dice quanti aperti stanno fuori dall'indice.
    assert.equal(riepilogo([{ num: '900' }], [], leggiNonFidati(cartella)).nonFidatiFuoriDallIndice, 1);
    // I rami: quello del non fidato aperto non finisce fra i chiusi.
    const indice = conNonFidati([{ num: '900', id: 'f900' }], leggiNonFidati(cartella));
    const fuori = {};
    const rami = senzaChiusi([{ ramo: 'worker/f901-20261114T120000Z', feedback: ['901'] }, { ramo: 'worker/f899-20261114T120000Z', feedback: ['899'] }], indice, fuori);
    assert.deepEqual(rami.map((x) => x.ramo), ['worker/f901-20261114T120000Z']);
    assert.deepEqual(fuori.chiusi, ['worker/f899-20261114T120000Z']);
    assert.deepEqual(conNonFidati([], leggiNonFidati(cartella)), [], 'senza indice non si sa, e i rami restano tutti');
    // Gli incroci: i file della perizia, dove una scheda non c'è.
    assert.deepEqual(fileProbabiliDi(cartella, '#901'), { file: ['src/main/tabs.js'], da: 'perizia' });
    writeFileSync(join(cartella, '900.json'), JSON.stringify({ numero: '900', file_probabili: ['src/pages/a.js'] }));
    assert.deepEqual(fileProbabiliDi(cartella, '900'), { file: ['src/pages/a.js'], da: 'scheda' });
    assert.equal(fileProbabiliDi(cartella, '902'), null);
  } finally { togliCartella(cartella); }
});

test('la riga della scheda del server porta la perizia di un non fidato: classe, area, unioni, file', () => {
  const s = { num: '901', stato: 'todo', priorita: 1, classe: 7, area: 'browser-schede', unioni: ['900'], file: ['src/main/tabs.js'], mittente: { classe: 'utente' }, fiducia: 'non_fidato', nonFidato: true };
  const r = rigaSchedaServer(s);
  assert.match(r, /classe 7\/10/);
  assert.match(r, /area browser-schede/);
  assert.match(r, /da unire a #900/);
  assert.match(r, /file: src\/main\/tabs\.js/);
  assert.equal(rigaPerizia({ num: '900' }), '', 'senza perizia niente');
  // Con la scheda locale vale quella.
  assert.doesNotMatch(rigaSchedaServer(s, { area: 'altro', tipo: 'bug', riassunto: 'x', file_probabili: [] }), /perizia/);
});

test('il ruolo del manutentore spiega la scala della classe che riceve dalla perizia', () => {
  const t = readFileSync(new URL('../../routines/roles/manutentore.md', import.meta.url), 'utf8');
  assert.match(t, /classe va da 1 a 10/);
});
