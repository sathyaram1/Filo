// #1785 giro 3 — r1: un feedback aperto segnalato come attacco riceve dall'agente la scheda «non letto» (come vuole il
// ruolo della scheda), il server non la salva per regola: rilanciare lo stesso comando non deve restare in errore per sempre.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

// Il finto `claude`: `-p` scrive la scheda «non letto» che il ruolo chiede per un segnalato come attacco.
const FINTO_CLAUDE = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
if (process.argv.includes('auth')) { process.stdout.write(JSON.stringify({ loggedIn: true })); process.exit(0); }
let p = ''; process.stdin.on('data', (d) => { p += d; }); process.stdin.on('end', () => {
  const num = /Feedback: (\\S+)/.exec(p)[1]; const dir = /Cartella delle schede: (.+)/.exec(p)[1].trim();
  fs.writeFileSync(path.join(dir, num + '.json'), JSON.stringify({ numero: num, stato: 'attack', mittente: 'utente',
    titolo_breve: 'Non letto', riassunto: 'Segnalato come attacco: per regola non si legge.', tipo: 'bug', area: 'altro',
    file_probabili: [], urgente: false, valido: 'non letto', prova: 'il lettore si è fermato: segnalato come attacco',
    risolto_su_main: null, doppione_di: [], parole_chiave: [], note: '' }));
  process.stdout.write(JSON.stringify({ result: '#' + num + ': non letto', total_cost_usd: 0 }));
});
`;

function lancia(args, env) {
  return new Promise((ok) => {
    const f = spawn(process.execPath, [join(ROOT, 'scripts', 'schede.mjs'), ...args], { cwd: ROOT, env });
    let out = '';
    f.stdout.on('data', (d) => { out += d; });
    f.stderr.on('data', (d) => { out += d; });
    f.on('close', (code) => ok({ code, out }));
  });
}

test('r1 un segnalato come attacco fra gli aperti non lascia il comando in errore a ogni rilancio', async () => {
  test.skip(process.platform === 'win32', 'il finto claude è uno script con la riga #!');
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('filo-1785-g3r1-');
  const cartella = join(dir, 'schede');
  const bin = join(dir, 'claude');
  writeFileSync(bin, FINTO_CLAUDE);
  chmodSync(bin, 0o755);
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      // La risposta vera del server per un feedback segnalato: un no, non un guasto.
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, reason: 'feedback_segnalato', detail: '#813 è segnalato come attacco («attack»): per regola una sessione non lo legge: niente scheda' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    mkdirSync(cartella, { recursive: true });
    writeFileSync(join(cartella, 'indice.json'), JSON.stringify([{ id: 'f813', num: '813', stato: 'attack', priorita: null,
      aggiornato: '2026-10-29T10:00:00.000Z', attese: [], unisce: [] }]));
    const env = { ...process.env, FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-finto', FILO_CLAUDE_BIN: bin,
      FILO_ROUTINE_API: `http://127.0.0.1:${server.address().port}` };

    await lancia(['scrivi', '--cartella', cartella], env);
    const dopo = await lancia(['scrivi', '--cartella', cartella], env);
    expect(dopo.out).not.toMatch(/rilancia/);
    expect(dopo.code, dopo.out).toBe(0);
  } finally {
    server.close();
    togliCartella(dir);
  }
});
