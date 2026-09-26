// Prove del giro 1 (verifica locale) sulla domanda di fine sessione delle routine.
// Non aprono Filo: la cosa chiesta vive negli strumenti delle routine e dell'owner, e si prova usandoli
// contro un canale finto che risponde come il server (stessi corpi, stessi stati HTTP).

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANALE = resolve(ROOT, 'scripts', 'routine-channel.mjs');

const DOMANDA = 'quanto hai aspettato per i test?';

/** Canale finto: una domanda per biglietto vivo, una risposta sola, 404 senza motivo per un percorso ignoto. */
function canaleFinto() {
  const risposte = new Map();
  const server = http.createServer((req, res) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => {
      const manda = (code, corpo) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corpo)); };
      if (req.url !== '/routineClosing') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<html>no</html>'); return; }
      const b = JSON.parse(s || '{}');
      if (b.ticket === 'morto') return manda(410, { ok: false, reason: 'dead_ticket' });
      if (b.ticket !== 'vivo') return manda(403, { ok: false, reason: 'bad_ticket' });
      if (b.op === 'question') return manda(200, { ok: true, question: DOMANDA });
      if (risposte.has(b.ticket) && risposte.get(b.ticket) !== b.answer) return manda(409, { ok: false, reason: 'already_answered' });
      risposte.set(b.ticket, b.answer);
      return manda(200, { ok: true });
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, risposte, base: `http://127.0.0.1:${server.address().port}` })));
}

function lancia(args, { base, input = '' }) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CANALE, ...args], {
      cwd: ROOT, env: { ...process.env, FILO_ROUTINE_API: base }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => ok({ code, out, err }));
    p.stdin.end(input);
  });
}

test('#domanda-chiusura — il worker riceve la domanda dell\'owner e la sua risposta arriva intera', async () => {
  const c = await canaleFinto();
  try {
    const d = await lancia(['domanda', '--biglietto', 'vivo'], { base: c.base });
    expect(d.code).toBe(0);
    expect(d.out).toContain(DOMANDA);
    expect(d.out).toContain('risposta --biglietto vivo');

    const testo = 'Ho aspettato 12 minuti, l\'attesa è stata lunga 🚀\nseconda riga';
    const r = await lancia(['risposta', '--biglietto', 'vivo'], { base: c.base, input: `${testo}\n` });
    expect(r.code).toBe(0);
    expect(c.risposte.get('vivo')).toBe(testo);

    const seconda = await lancia(['risposta', '--biglietto', 'vivo'], { base: c.base, input: 'un\'altra\n' });
    expect(seconda.code).toBe(4);
    expect(c.risposte.get('vivo')).toBe(testo);
  } finally { c.server.close(); }
});

test('#domanda-chiusura — senza domanda il worker lo sa dall\'uscita e chiude: 2 se il server non c\'è, 4 se rifiuta', async () => {
  const c = await canaleFinto();
  try {
    const assente = await lancia(['domanda', '--biglietto', 'vivo'], { base: `${c.base}/altrove` });
    expect(assente.code).toBe(2);
    const morto = await lancia(['domanda', '--biglietto', 'morto'], { base: c.base });
    expect(morto.code).toBe(4);
    expect(morto.err).toContain('dead_ticket');
  } finally { c.server.close(); }
});
