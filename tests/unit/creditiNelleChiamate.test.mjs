// Crediti (#1156): il consumo della sessione viaggia con ogni chiamata del canale, non solo col battito, così quello
// fatto dopo l'ultimo battito arriva al rilascio, alla richiesta del biglietto e alla domanda di chiusura.
// E lo strumento delle parole d'ordine dà a ogni routine il suo account, senza il quale il consumo non conta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const canale = await import('../../scripts/routine-channel.mjs');
const { consumoSessione } = await import('../../scripts/lib/consumo-progressivo.mjs');

const CONSUMO = { sessionId: 'sess-x', tokens: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }, costUsd: 1.5, turni: 2, modelli: ['claude-opus-5-5'] };

function registra() {
  const corpi = [];
  const fetchImpl = async (url, init) => {
    corpi.push({ path: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true, work: false, reason: 'idle', question: 'D?', id: 'c1' }) };
  };
  return { corpi, opts: { fetchImpl, sleep: async () => {}, misureCrediti: () => ({ consumo: CONSUMO, barra: 'assente' }) } };
}

test('biglietto, sondaggio, rilascio e domanda di chiusura portano il consumo della sessione', async () => {
  const { corpi, opts } = registra();
  await canale.ticket('parola', opts);
  await canale.probe('parola', opts);
  await canale.release('tkt', '', opts);
  await canale.domandaChiusura({ passphrase: 'parola' }, opts);
  await canale.rispostaChiusura({ passphrase: 'parola', id: 'c1' }, 'niente', opts);
  assert.deepEqual(corpi.map((c) => c.path), ['routineTicket', 'routineTicket', 'routineRelease', 'routineClosing', 'routineClosing']);
  for (const c of corpi) {
    assert.deepEqual(c.body.consumo, CONSUMO, c.path);
    assert.equal(c.body.barra, 'assente', c.path);
  }
});

test('una misura che non si legge non ferma la chiamata', async () => {
  const { corpi, opts } = registra();
  opts.misureCrediti = () => { throw new Error('transcript illeggibile'); };
  const r = await canale.release('tkt', '', opts);
  assert.equal(r.ok, true);
  assert.equal(corpi[0].body.consumo, undefined);
});

test('rilascio da riga di comando: il consumo fino a quel momento arriva col rilascio', async () => {
  const base = cartellaTemporanea('crediti-chiamate-');
  const lavoro = join(base, 'lavoro');
  mkdirSync(join(lavoro, '.claude'), { recursive: true });
  const transcript = join(base, 'sess-rilascio.jsonl');
  const uso = { input_tokens: 5, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000, output_tokens: 700 };
  writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: uso, content: [] } })}\n`);
  const atteso = consumoSessione({ root: join(base, 'conto'), env: { FILO_TRANSCRIPT: transcript } }).consumo;
  const ricevute = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { ricevute.push({ url: req.url, body: JSON.parse(b || '{}') }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const code = await new Promise((ok) => {
      const p = spawn(process.execPath, [join(ROOT, 'scripts', 'routine-channel.mjs'), 'release', 'biglietto-di-prova-1234567890', '--senza-push'], {
        cwd: lavoro, stdio: 'ignore',
        env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: lavoro, FILO_TRANSCRIPT: transcript, FILO_ROUTINE: '1', FILO_NO_BEAT: '1' },
      });
      p.on('close', ok);
    });
    assert.equal(code, 0);
    const rilascio = ricevute.find((r) => r.url.endsWith('/routineRelease'));
    assert.ok(rilascio, 'il server ha ricevuto il rilascio');
    assert.deepEqual(rilascio.body.consumo, atteso);
  } finally {
    srv.close();
    togliCartella(base);
  }
});

test('parole d ordine: l account si scrive e si vede, e un account sbagliato non chiama il server', async () => {
  const corri = (args) => new Promise((ok) => {
    execFile(process.execPath, [join(ROOT, 'scripts', 'routine-keys.mjs'), ...args], { env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: '' } },
      (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` }));
  });
  const aiuto = await corri(['--help']);
  assert.equal(aiuto.code, 0);
  assert.match(aiuto.out, /account <nome> <A\|B>/);
  for (const args of [['account', 'routine-a', 'C'], ['account', 'routine-a'], ['account']]) {
    const r = await corri(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.out, /Uso: node scripts\/routine-keys\.mjs account <nome> <A\|B>/);
  }
});
