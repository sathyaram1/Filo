// Barra di stato (scripts/statusline.mjs): stdin finto, casa finta in una cartella temporanea, rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/statusline.mjs', import.meta.url));
const { barra, invia, letturaDa, quotaFile, invioFile, INVIO_OGNI_MS } = await import('../../scripts/statusline.mjs');

const NOW = Date.parse('2026-10-09T12:00:00Z');
const STDIN = {
  session_id: 'sess-a', transcript_path: '/x/sess-a.jsonl',
  rate_limits: { five_hour: { used_percentage: 34.4, resets_at: 1760020000 }, seven_day: { used_percentage: 61, resets_at: 1760374800 } },
};

test('letturaDa: i due limiti con i rinnovi; senza la settimana nessuna lettura', () => {
  assert.deepEqual(letturaDa(STDIN, NOW), { pct7d: 61, reset7dAtS: 1760374800, letturaAtMs: NOW, pct5h: 34.4, reset5hAtS: 1760020000 });
  assert.equal(letturaDa({ session_id: 's' }, NOW), null);
  assert.equal(letturaDa({ rate_limits: { five_hour: { used_percentage: 3, resets_at: 1 } } }, NOW), null);
  assert.deepEqual(letturaDa({ rate_limits: { seven_day: { used_percentage: 5, resets_at: 9 } } }, NOW), { pct7d: 5, reset7dAtS: 9, letturaAtMs: NOW });
});

test('barra: scrive la lettura per sessione, stampa la riga, lancia l invio al massimo ogni cinque minuti', () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    const righe = [];
    let lanci = 0;
    const opts = { home, nowMs: NOW, lancia: () => { lanci += 1; }, scrivi: (s) => righe.push(s) };
    barra(JSON.stringify(STDIN), opts);
    assert.deepEqual(righe, ['5h 34% · 7g 61%\n']);
    const f = JSON.parse(readFileSync(quotaFile(home), 'utf8'));
    assert.equal(f.sessioni['sess-a'].lettura.pct7d, 61);
    assert.equal(f.ultima.sessionId, 'sess-a');
    assert.equal(lanci, 1);
    barra(JSON.stringify(STDIN), Object.assign({}, opts, { nowMs: NOW + 60 * 1000 }));
    assert.equal(lanci, 1, 'un minuto dopo non si rimanda');
    barra(JSON.stringify(STDIN), Object.assign({}, opts, { nowMs: NOW + INVIO_OGNI_MS + 1 }));
    assert.equal(lanci, 2);
    // Nessun file temporaneo lasciato in giro: la scrittura è un rename.
    assert.deepEqual(readdirSync(join(home, '.claude')).filter((n) => n.endsWith('.tmp')), []);
  } finally { togliCartella(home); }
});

test('barra: coi numeri uguali la lettura tiene l ora della prima volta che la sessione li ha visti', () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    const opts = { home, nowMs: NOW, lancia: () => {}, scrivi: () => {} };
    barra(JSON.stringify(STDIN), opts);
    // Due ore dopo Claude Code rimostra i numeri dell'ultima risposta: non è una lettura nuova.
    barra(JSON.stringify(STDIN), Object.assign({}, opts, { nowMs: NOW + 2 * 3600e3 }));
    let f = JSON.parse(readFileSync(quotaFile(home), 'utf8'));
    assert.equal(f.sessioni['sess-a'].lettura.letturaAtMs, NOW);
    assert.equal(f.ultima.letturaAtMs, NOW);
    assert.equal(f.sessioni['sess-a'].vistaAtMs, NOW + 2 * 3600e3, 'la barra è girata, e il battito lo vede');
    // Numeri cambiati: lettura nuova, con la sua ora.
    const cambiati = JSON.parse(JSON.stringify(STDIN));
    cambiati.rate_limits.seven_day.used_percentage = 62;
    barra(JSON.stringify(cambiati), Object.assign({}, opts, { nowMs: NOW + 3 * 3600e3 }));
    f = JSON.parse(readFileSync(quotaFile(home), 'utf8'));
    assert.equal(f.ultima.letturaAtMs, NOW + 3 * 3600e3);
    assert.equal(f.ultima.pct7d, 62);
    // Un'altra sessione con gli stessi numeri ha la sua ora.
    barra(JSON.stringify(Object.assign({}, cambiati, { session_id: 'sess-c' })), Object.assign({}, opts, { nowMs: NOW + 4 * 3600e3 }));
    f = JSON.parse(readFileSync(quotaFile(home), 'utf8'));
    assert.equal(f.sessioni['sess-c'].lettura.letturaAtMs, NOW + 4 * 3600e3);
  } finally { togliCartella(home); }
});

test('barra: senza limiti la sessione si registra (barra presente) ma la lettura buona non si perde', () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    const opts = { home, nowMs: NOW, lancia: () => {}, scrivi: () => {} };
    barra(JSON.stringify(STDIN), opts);
    const righe = [];
    barra(JSON.stringify({ session_id: 'sess-b' }), Object.assign({}, opts, { scrivi: (s) => righe.push(s) }));
    assert.deepEqual(righe, ['5h – · 7g –\n']);
    const f = JSON.parse(readFileSync(quotaFile(home), 'utf8'));
    assert.ok(f.sessioni['sess-b'], 'la barra ha girato in sess-b');
    assert.equal(f.sessioni['sess-b'].lettura, undefined);
    assert.equal(f.ultima.pct7d, 61, 'l ultima lettura vera resta');
  } finally { togliCartella(home); }
});

test('barra: stdin rotto o file illeggibile non lanciano mai', () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    const righe = [];
    barra('{ non json', { home, nowMs: NOW, lancia: () => { throw new Error('mai'); }, scrivi: (s) => righe.push(s) });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(quotaFile(home), 'spazzatura');
    barra(JSON.stringify(STDIN), { home, nowMs: NOW, lancia: () => { throw new Error('rete giù'); }, scrivi: (s) => righe.push(s) });
    assert.deepEqual(righe, ['5h – · 7g –\n', '5h 34% · 7g 61%\n']);
  } finally { togliCartella(home); }
});

test('invia: la lettura va a ownerCrediti op:lettura col token; l esito resta scritto, anche «non ancora pubblicata»', async () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    barra(JSON.stringify(STDIN), { home, nowMs: NOW, lancia: () => {}, scrivi: () => {} });
    let richiesta = null;
    const ok = await invia({ home, nowMs: NOW, token: 'tok', fetchImpl: async (url, init) => { richiesta = { url, init }; return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) }; } });
    assert.equal(ok.ok, true);
    assert.match(richiesta.url, /\/ownerCrediti$/);
    assert.equal(richiesta.init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(richiesta.init.body).data, { op: 'lettura', pct7d: 61, reset7dAtS: 1760374800, letturaAtMs: NOW, pct5h: 34.4, reset5hAtS: 1760020000 });
    const non = await invia({ home, nowMs: NOW + 1, token: 'tok', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    assert.match(non.errore, /non ancora pubblicata/);
    assert.match(JSON.parse(readFileSync(invioFile(home), 'utf8')).errore, /non ancora pubblicata/);
    const senza = await invia({ home, nowMs: NOW + 2, token: null, fetchImpl: async () => { throw new Error('mai'); } });
    assert.equal(senza.ok, false);
  } finally { togliCartella(home); }
});

test('barra: finché l ultimo invio non è arrivato la riga lo dice; senza numeri da inviare no', async () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    const righe = [];
    const giro = (stdin, ms) => barra(JSON.stringify(stdin), { home, nowMs: ms, lancia: () => {}, scrivi: (s) => righe.push(s) });
    const rifiuto = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'il rinnovo non è di nessun account' } }) });
    giro(STDIN, NOW);
    assert.equal(righe.at(-1), '5h 34% · 7g 61%\n');
    await invia({ home, nowMs: NOW + 1, token: 'tok', fetchImpl: rifiuto });
    giro(STDIN, NOW + 2);
    assert.equal(righe.at(-1), '5h 34% · 7g 61% · non inviata\n');
    await invia({ home, nowMs: NOW + 3, token: 'tok', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ result: { ok: true, account: 'B' } }) }) });
    giro(STDIN, NOW + 4);
    assert.equal(righe.at(-1), '5h 34% · 7g 61%\n');
    await invia({ home, nowMs: NOW + 5, token: 'tok', fetchImpl: rifiuto });
    giro({ session_id: 'sess-b' }, NOW + 6);
    assert.equal(righe.at(-1), '5h – · 7g –\n');
  } finally { togliCartella(home); }
});

test('lo script vero: stdin finto, una riga, il file nella casa indicata', async () => {
  const home = cartellaTemporanea('filo-barra-');
  try {
    // Invio già fatto da poco: lo script non lancia figli verso la rete.
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(invioFile(home), JSON.stringify({ atMs: Date.now() }));
    const out = await new Promise((r) => {
      const p = execFile(process.execPath, [SCRIPT], { env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home }) }, (err, so) => r({ err, so }));
      p.stdin.end(JSON.stringify(STDIN));
    });
    assert.equal(out.err, null);
    assert.equal(out.so, '5h 34% · 7g 61%\n');
    assert.ok(existsSync(quotaFile(home)));
  } finally { togliCartella(home); }
});
