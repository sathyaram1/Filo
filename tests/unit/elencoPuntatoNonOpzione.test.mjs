// #878: un testo che comincia con un elenco puntato («- …») o con un inciso («— …») non è un'opzione scritta male,
// in nessuno degli strumenti che aprono un feedback (feedback:apri e la consegna del canale). Le opzioni storte
// («-dry-run», «—priorita») restano rifiutate: la regola sta in scripts/lib/argomenti.mjs.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apreUnElenco, controllaArgomenti, sembraOpzione } from '../../scripts/lib/argomenti.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELENCO = '- primo punto\n- secondo punto';
const FEEDBACK = {
  opzioni: ['--priorita', '--url', '--allega', '--locale', '--non-locale', '--aspetta', '--dry-run'],
  conValore: ['--priorita', '--url', '--allega', '--aspetta'],
  ripetibili: ['--allega'],
};

test('un trattino seguito da uno spazio o da un a capo è testo; le opzioni storte restano opzioni storte', () => {
  for (const testo of [ELENCO, '- punto', '— un inciso', '–\tpunto', '-\npunto', '-- vedi sotto', '--- separatore']) {
    assert.equal(apreUnElenco(testo), true, JSON.stringify(testo));
    assert.equal(controllaArgomenti(['Titolo', testo, '--non-locale'], FEEDBACK), null, JSON.stringify(testo));
    assert.equal(controllaArgomenti([testo, 'testo', '--non-locale'], FEEDBACK), null, `titolo ${JSON.stringify(testo)}`);
    assert.equal(controllaArgomenti(['T', 'x', '--url', testo, '--non-locale'], FEEDBACK), null, `valore ${JSON.stringify(testo)}`);
  }
  for (const storta of ['-dry-run', '—priorita', '-punto', '--puntoo']) {
    assert.match(controllaArgomenti(['T', storta, '--non-locale'], FEEDBACK) || '', /non ho toccato niente/, storta);
  }
  // Dove le parole libere non esistono, un elenco resta una parola che non si capisce: rifiutata, mai eseguita.
  assert.match(controllaArgomenti(['- print'], { opzioni: ['--print'], senzaParoleLibere: true }) || '', /non è un'opzione né un valore/);
  assert.equal(sembraOpzione('- punto'), true, 'la regola stretta della critica non cambia');
});

test('feedback:apri: titolo e testo a elenco puntato partono interi', async () => {
  const SCRIPT = await import('../../scripts/claude-feedback.mjs');
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
  SCRIPT.ambiente.routine = () => false;
  const FB = globalThis.SN_FEEDBACK;
  const orig = FB.submit;
  const visti = [];
  FB.submit = async (payload) => { visti.push(payload); return { id: 'd', seq: 9 }; };
  const log = console.log; const err = console.error;
  const errori = [];
  console.log = () => {}; console.error = (...a) => errori.push(a.join(' '));
  try {
    assert.equal(await SCRIPT.main(['Titolo', ELENCO, '--non-locale']), 0, errori.join('\n'));
    assert.equal(await SCRIPT.main(['- un titolo a punto', '-- vedi sotto', '--non-locale', '--priorita', '2']), 0, errori.join('\n'));
    assert.equal(await SCRIPT.main(['Titolo', '-dry-run', '--non-locale']), 1, 'un\'opzione storta resta un errore d\'uso');
  } finally { FB.submit = orig; console.log = log; console.error = err; }
  assert.equal(visti.length, 2);
  assert.equal(visti[0].text, ELENCO);
  assert.equal(visti[1].name, '- un titolo a punto');
  assert.equal(visti[1].text, '-- vedi sotto', 'il testo che comincia con due trattini non sparisce dal corpo');
});

// #1359: senza il `--` npm si prende «- …» e allo strumento non arriva niente: il rifiuto deve dire perché e come passarlo.
test('feedback:apri da npm col testo a elenco sparito: il rifiuto dice del trattino, dei due trattini e di stdin', async () => {
  const SCRIPT = await import('../../scripts/claude-feedback.mjs');
  SCRIPT.ambiente.routine = () => false;
  const err = console.error; const log = console.log;
  const prova = async (env) => {
    const righe = [];
    const prima = process.env.npm_lifecycle_event;
    if (env) process.env.npm_lifecycle_event = env; else delete process.env.npm_lifecycle_event;
    console.error = (...a) => righe.push(a.join(' ')); console.log = () => {};
    try { return { code: await SCRIPT.main(['Titolo', '--non-locale']), detto: righe.join('\n') }; } finally {
      console.error = err; console.log = log;
      if (prima === undefined) delete process.env.npm_lifecycle_event; else process.env.npm_lifecycle_event = prima;
    }
  };
  const npm = await prova('feedback:apri');
  assert.equal(npm.code, 1);
  assert.match(npm.detto, /testo mancante/);
  assert.match(npm.detto, /cominciava con un trattino.*npm l'ha preso per una sua opzione/);
  assert.match(npm.detto, /npm run feedback:apri -- "titolo" "- …"/);
  assert.match(npm.detto, /metti "-" al posto del testo e passalo da stdin/);
  const diretto = await prova('');
  assert.match(diretto.detto, /testo mancante/);
  assert.doesNotMatch(diretto.detto, /trattino/, 'lanciato senza npm, npm non c\'entra');
});

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { ricevuti.push({ url: req.url, body: JSON.parse(body || '{}') }); } catch (_) { /* lo dicono gli assert */ }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, num: '#1' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const canale = (argv, port) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...argv],
    { env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_ROUTINE_TICKET: '', FILO_NO_BEAT: '1' } },
    (e, so, se) => r({ code: e ? (e.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
});

test('canale: un feedback nuovo a elenco puntato arriva al server intero; un elenco fuori posto dice dove va il testo', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
  try {
    for (const [titolo, testo] of [['Titolo', ELENCO], ['— un inciso', '-- vedi sotto']]) {
      const r = await canale(['deliver', B, 'feedback', '--title', titolo, '--text', testo], port);
      assert.equal(r.code, 0, r.se);
      const d = ricevuti.at(-1).body.data;
      assert.equal(d.title, titolo);
      assert.equal(d.text, testo);
    }
    const prima = ricevuti.length;
    const fuori = await canale(['deliver', B, 'feedback', '--title', 'Titolo', ELENCO], port);
    assert.equal(fuori.code, 1);
    assert.match(fuori.se, /il testo di un feedback nuovo in --text/, 'il rimedio giusto, non «le opzioni si scrivono con due trattini»');
    const senza = await canale(['deliver', B, 'feedback', '--title', 'Titolo', '--text', '--name', 'x'], port);
    assert.equal(senza.code, 1, 'un campo al posto del testo resta un testo mancante');
    assert.equal(ricevuti.length, prima, 'niente al server dai due rifiuti');
  } finally { srv.close(); }
});
