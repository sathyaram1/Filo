// Verifica #1785.2 giro 2, r1: scrivi decide cosa mandare dall'indice dell'ultimo elenca, non da quello che il feedback ha
// adesso. Logica pura, senza Electron: il comando intero contro un canale delle routine finto che tiene lo stato dei feedback.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const buona = (num, extra = {}) => ({
  numero: String(num), stato: 'todo', mittente: 'utente', titolo_breve: 'Menu che non si apre',
  riassunto: 'Il menu del tasto destro non si apre sulle immagini.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'Letto il gestore: il caso manca.',
  risolto_su_main: null, doppione_di: [], parole_chiave: ['menu'], note: '', ...extra,
});

/** Il server finto: `fb` è num → { updatedAt, scheda? }; ogni scheda salvata prende l'ora sua e aggiorna il feedback. */
async function serverFinto(fb) {
  const scritte = [];
  let tick = 0;
  const server = createServer((req, res) => {
    let c = '';
    req.on('data', (d) => { c += d; });
    req.on('end', () => {
      const b = JSON.parse(c || '{}');
      let body = { ok: false, reason: 'bad_request' };
      if (b.op === 'leggi') {
        body = { ok: true, resto: [], voci: Object.entries(fb).map(([num, f]) => ({ num, id: `f${num}`,
          riga: { _id: `f${num}`, seq: Number(num), subSeq: 0, status: 'todo', priority: null, updatedAt: f.updatedAt, waitsFor: [], unisce: [], ...(f.scheda ? { schedaAt: f.updatedAt } : {}) },
          ...(f.scheda ? { scheda: f.scheda } : {}) })) };
      } else if (b.op === 'scheda') {
        tick += 1;
        const at = `2026-11-05T15:00:${String(tick).padStart(2, '0')}.000Z`;
        scritte.push(b.numero);
        const scheda = { ...b.scheda, _fonte: { id: `f${b.numero}`, stato: 'todo', aggiornato: at, at, modello: b.modello },
          ...(b.rilettura ? { _riletta: { at, modello: b.modello } } : {}), _fiducia: 'fidato' };
        fb[b.numero] = { updatedAt: at, scheda };
        body = { ok: true, num: b.numero, aggiornato: at, scheda };
      }
      res.statusCode = body.ok ? 200 : 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, scritte, chiudi: () => new Promise((r) => server.close(r)) };
}

function lancia(args, env) {
  return new Promise((ok) => {
    const f = spawn(process.execPath, [join(ROOT, 'scripts', 'schede.mjs'), ...args], { cwd: ROOT, env });
    let out = '';
    f.stdout.on('data', (d) => { out += d; });
    f.stderr.on('data', (d) => { out += d; });
    f.on('close', (code) => ok({ code, out }));
  });
}

function scena() {
  const dir = cartellaTemporanea('verifica-1785-2-');
  const cartella = join(dir, 'schede');
  mkdirSync(cartella, { recursive: true });
  // Un agente che non deve servire: se parte, fallisce.
  const bin = join(dir, 'claude');
  writeFileSync(bin, '#!/usr/bin/env node\nif (process.argv[2] === "auth") { process.stdout.write("{\\"loggedIn\\":true}"); process.exit(0); }\nprocess.exit(1);\n');
  chmodSync(bin, 0o755);
  return { dir, cartella, bin };
}

const env = (url, bin) => ({ ...process.env, FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-finto', FILO_ROUTINE_API: url, FILO_CLAUDE_BIN: bin });

test('r1 un indice scritto prima di questo lavoro non rimanda al feedback le schede che il feedback ha già', async () => {
  test.skip(process.platform === 'win32', 'il finto claude è uno script con la riga #!');
  const S1 = '2026-11-01T09:00:00.000Z';
  // La scheda riletta da Opus che il feedback ha, copiata nella cartella dall'elenca di prima, con l'indice di allora.
  const nelFeedback = { ...buona(7, { riletta: 'confermata' }), _fonte: { id: 'f7', stato: 'todo', aggiornato: S1, at: S1, modello: 'haiku' },
    _riletta: { at: S1, modello: 'opus' }, _fiducia: 'non_fidato' };
  const fb = { 7: { updatedAt: S1, scheda: nelFeedback } };
  const srv = await serverFinto(fb);
  const { dir, cartella, bin } = scena();
  try {
    writeFileSync(join(cartella, 'indice.json'), JSON.stringify([{ id: 'f7', num: '7', stato: 'todo', priorita: null, aggiornato: S1, attese: [], unisce: [] }]));
    writeFileSync(join(cartella, '7.json'), JSON.stringify(nelFeedback));
    const r = await lancia(['scrivi', '--cartella', cartella], env(srv.url, bin));
    expect(srv.scritte, `il feedback ha già questa scheda: non va riscritta a nome di chi lancia il comando\n${r.out}`).toEqual([]);
    expect(fb[7].scheda._fiducia).toBe('non_fidato');
  } finally {
    await srv.chiudi();
    togliCartella(dir);
  }
});

test('r1 una scheda della cartella non sovrascrive quella più nuova che il feedback ha avuto dopo l’ultimo elenca', async () => {
  test.skip(process.platform === 'win32', 'il finto claude è uno script con la riga #!');
  const A = '2026-11-05T09:00:00.000Z';
  const B = '2026-11-05T11:00:00.000Z';
  // Alle 10 la scheda scritta qui non è arrivata al server; alle 11 il manutentore in cloud ha scritto e fatto rileggere la sua.
  const dellaNuvola = { ...buona(9, { riletta: 'corretta l’area' }), _fonte: { id: 'f9', stato: 'todo', aggiornato: B, at: B, modello: 'haiku' },
    _riletta: { at: B, modello: 'opus' }, _fiducia: 'fidato' };
  const fb = { 9: { updatedAt: B, scheda: dellaNuvola } };
  const srv = await serverFinto(fb);
  const { dir, cartella, bin } = scena();
  try {
    writeFileSync(join(cartella, 'indice.json'), JSON.stringify([{ id: 'f9', num: '9', stato: 'todo', priorita: null, aggiornato: A, attese: [], unisce: [], nelFeedback: '' }]));
    writeFileSync(join(cartella, '9.json'), JSON.stringify({ ...buona(9), _fonte: { id: 'f9', stato: 'todo', aggiornato: A, at: '2026-11-05T10:00:00.000Z', modello: 'haiku' } }));
    const r = await lancia(['scrivi', '--cartella', cartella], env(srv.url, bin));
    expect(fb[9].scheda._riletta, `la rilettura di Opus salvata alle 11 resta nel feedback\n${r.out}`).toEqual({ at: B, modello: 'opus' });
  } finally {
    await srv.chiudi();
    togliCartella(dir);
  }
});
