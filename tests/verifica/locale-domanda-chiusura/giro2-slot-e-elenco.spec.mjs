// Prove del giro 2 (verifica locale): domande per slot cambiate dall'owner, e l'elenco delle risposte che lui legge.
// Il canale finto usa il modulo vero del server (ramo privato claude/domanda-chiusura) con un archivio in memoria;
// se quel ramo non c'è sulla macchina la prova si salta, perché senza il server vero non prova niente.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { formattaRisposte, formattaDomande, messaggioErrore } from '../../../scripts/routine-domanda.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANALE = resolve(ROOT, 'scripts', 'routine-channel.mjs');
const FUNZIONI = join(homedir(), 'Desktop', 'Filo', 'filo-security-domanda', 'functions');
const MODULO = join(FUNZIONI, 'src', 'routine', 'closing.js');

function caricaServer() {
  const req = createRequire(join(FUNZIONI, 'index.js'));
  const secrets = req('./src/routine/secrets');
  const mem = { slots: {}, closings: new Map(), tickets: new Map(), keys: new Map(), seq: 0 };
  const store = {
    findKeyByFingerprint: async (fp) => mem.keys.get(fp) || null,
    checkSlugRate: async () => true,
    recordRejection: () => {},
    readQuestionSlots: async () => JSON.parse(JSON.stringify(mem.slots)),
    writeQuestionSlot: async (slot, text, nowMs) => { if (text === null) delete mem.slots[slot]; else mem.slots[slot] = { text, setAtMs: nowMs }; },
    createClosing: async (entry, id) => {
      const k = id || `c${++mem.seq}`;
      if (id && mem.closings.has(k)) return { id: k, entry: mem.closings.get(k) };
      mem.closings.set(k, { ...entry });
      return { id: k, entry };
    },
    answerClosing: async (id, slug, answer, nowMs) => {
      const cur = mem.closings.get(id);
      if (!cur || cur.slug !== slug) return 'missing';
      if (cur.answered === true) return cur.answer === answer ? 'ok' : 'answered';
      Object.assign(cur, { answer, answeredAtMs: nowMs, answered: true });
      return 'ok';
    },
    askTicketClosing: async (fp, question, nowMs) => {
      const t = mem.tickets.get(fp);
      if (t.closing && t.closing.askedAtMs) return t.closing.question;
      t.closing = { question, askedAtMs: nowMs };
      return question;
    },
    answerTicketClosing: async (fp, answer, nowMs) => {
      const t = mem.tickets.get(fp);
      if (!t.closing || !t.closing.askedAtMs) return 'missing';
      if (t.closing.answer != null) return t.closing.answer === answer ? 'ok' : 'answered';
      t.closing = { ...t.closing, answer, answeredAtMs: nowMs };
      return 'ok';
    },
    listClosings: async (take) => [...mem.closings.entries()].map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => b.askedAtMs - a.askedAtMs).slice(0, take),
    listTicketClosings: async (take) => [...mem.tickets.values()].filter((t) => t.closing && t.closing.askedAtMs)
      .sort((a, b) => b.closing.askedAtMs - a.closing.askedAtMs).slice(0, take).map((t) => JSON.parse(JSON.stringify(t))),
  };
  const storePath = req.resolve('./src/routine/store');
  req.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: store };
  delete req.cache[req.resolve('./src/routine/closing')];
  const closing = req('./src/routine/closing');
  return { closing, mem, secrets };
}

const STATO = { answer_too_big: 413, bad_request: 400, answer_missing: 400, bad_closing: 404, already_answered: 409, rate_limited: 429 };

function avvia({ closing, mem }, clock) {
  const loadLiveTicket = async (tk) => {
    const t = mem.tickets.get(tk);
    if (!t) return { ok: false, reason: 'bad_ticket' };
    if (t.releasedAtMs) return { ok: false, reason: 'dead_ticket', fp: tk, ticket: t };
    return { ok: true, fp: tk, ticket: t };
  };
  const server = http.createServer((req, res) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', async () => {
      if (req.url !== '/routineClosing') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<html>no</html>'); return; }
      const out = await closing.handle(JSON.parse(s || '{}'), { loadLiveTicket, nowMs: clock.now });
      res.writeHead(out && out.ok === false ? (STATO[out.reason] || 401) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, base: `http://127.0.0.1:${server.address().port}` })));
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

test.skip(!existsSync(MODULO), 'manca il ramo privato del server su questa macchina');

test('#domanda-chiusura — l\'owner cambia la domanda per slot e ogni sessione riceve la sua, stabile fino alla risposta', async () => {
  const srv = caricaServer();
  const clock = { now: Date.parse('2026-09-26T10:00:00Z') };
  const { server, base } = await avvia(srv, clock);
  const admin = (d) => srv.closing.admin(d, { nowMs: clock.now });
  try {
    srv.mem.tickets.set('Tver', { slug: 'filo', role: 'verifier', num: '#477', createdAtMs: clock.now });
    srv.mem.tickets.set('Tfix', { slug: 'filo', role: 'fixer', num: '#478', createdAtMs: clock.now });
    srv.mem.keys.set(srv.secrets.fingerprint('parola segreta'), { slug: 'filo', data: { scope: 'routine' } });

    await admin({ op: 'set', slot: 'verifier', text: 'quanto hai aspettato per i test?' });
    await admin({ op: 'set', slot: 'worker', text: 'Domanda per tutti i worker:\nc\'è un intoppo?' });
    expect(formattaDomande(await admin({ op: 'get' }))).toContain('quanto hai aspettato per i test?');

    const v = await lancia(['domanda', '--biglietto', 'Tver'], { base });
    expect(v.code).toBe(0);
    expect(v.out).toContain('quanto hai aspettato per i test?');
    const f = await lancia(['domanda', '--biglietto', 'Tfix'], { base });
    expect(f.out).toContain('Domanda per tutti i worker:\nc\'è un intoppo?');

    // La domanda cambiata dopo che il verificatore l'ha ricevuta non cambia la sua.
    await admin({ op: 'set', slot: 'verifier', text: 'altra domanda' });
    const v2 = await lancia(['domanda', '--biglietto', 'Tver'], { base });
    expect(v2.out).toContain('quanto hai aspettato per i test?');

    // Tolto lo slot generico, un worker nuovo riceve il ripiego aperto che ammette «niente».
    await admin({ op: 'clear', slot: 'worker' });
    srv.mem.tickets.set('Tfix2', { slug: 'filo', role: 'fixer', num: '#479', createdAtMs: clock.now });
    const f2 = await lancia(['domanda', '--biglietto', 'Tfix2'], { base });
    expect(f2.out).toContain('niente');
    expect(f2.out).toContain('non ha funzionato');

    // L'orchestratore: prima il ripiego, poi quella del suo slot.
    const o1 = await lancia(['domanda', 'parola segreta'], { base });
    expect(o1.code).toBe(0);
    expect(o1.out).toContain('niente');
    await admin({ op: 'set', slot: 'orchestrator', text: 'quanti worker hai lanciato?' });
    const o2 = await lancia(['domanda', 'parola segreta'], { base });
    expect(o2.out).toContain('quanti worker hai lanciato?');
    const id = /risposta "<parola-d-ordine>" (\S+)/.exec(o2.out)[1];
    const ro = await lancia(['risposta', 'parola segreta', id], { base, input: 'niente\n' });
    expect(ro.code).toBe(0);
  } finally { server.close(); }
});

test('#domanda-chiusura — nell\'elenco dell\'owner ogni risposta ha la sua testa giusta e la domanda che la sessione ha davvero ricevuto', async () => {
  const srv = caricaServer();
  const t0 = Date.parse('2026-09-26T10:00:00Z');
  const clock = { now: t0 };
  const { server, base } = await avvia(srv, clock);
  const admin = (d) => srv.closing.admin(d, { nowMs: clock.now });
  try {
    srv.mem.tickets.set('Tver', { slug: 'filo', role: 'verifier', num: '#477', createdAtMs: t0 });
    srv.mem.tickets.set('Tfix', { slug: 'filo', role: 'fixer', num: '', createdAtMs: t0 });
    await admin({ op: 'set', slot: 'verifier', text: 'quanto hai aspettato per i test?' });

    clock.now = t0 + 40 * 60000;
    await lancia(['domanda', '--biglietto', 'Tver'], { base });
    await admin({ op: 'set', slot: 'verifier', text: 'domanda cambiata dopo' });
    const r = await lancia(['risposta', '--biglietto', 'Tver'], { base, input: '12 minuti, l\'attesa più lunga 🚀\nseconda riga\n' });
    expect(r.code).toBe(0);
    srv.mem.tickets.get('Tver').releasedAtMs = t0 + 42 * 60000;

    clock.now = t0 + 50 * 60000;
    await lancia(['domanda', '--biglietto', 'Tfix'], { base });
    await lancia(['risposta', '--biglietto', 'Tfix'], { base, input: 'niente\n' });

    const testo = formattaRisposte(await admin({ op: 'answers', limit: 50 }), { quando: () => 'ORA' });
    expect(testo).toContain('verifier #477 · 42 min · filo');
    expect(testo).toContain('D: quanto hai aspettato per i test?');
    expect(testo).toContain('R: 12 minuti, l\'attesa più lunga 🚀\n     seconda riga');
    expect(testo).toContain('fixer · non rilasciato · filo');
    expect(testo).not.toContain('##');
    expect(testo).not.toMatch(/-\d+ min/);
  } finally { server.close(); }
});

test('#domanda-chiusura — l\'owner che sbaglia slot o scrive troppo viene fermato coi nomi giusti e coi numeri', async () => {
  const srv = caricaServer();
  const comeCallable = (out) => ({ error: { message: out.detail || out.reason, status: 'INVALID_ARGUMENT', details: { reason: out.reason } } });
  const slot = await srv.closing.admin({ op: 'set', slot: 'verificatore', text: 'x' });
  const m1 = messaggioErrore(400, comeCallable(slot));
  expect(m1).toContain('verifier');
  expect(m1).toContain('orchestrator');
  const lunga = await srv.closing.admin({ op: 'set', slot: 'worker', text: 'a'.repeat(4001) });
  expect(messaggioErrore(400, comeCallable(lunga))).toContain('4001');
  expect(srv.mem.slots.worker).toBeUndefined();
});
