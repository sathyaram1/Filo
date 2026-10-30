// #1785 giro 2 — r2: una scheda scritta dall'agente ma non salvata nel feedback (server giù, non ancora pubblicato) deve
// arrivare nel feedback rilanciando lo stesso comando, come promette il messaggio. Strada del biglietto, server finto.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

// Il finto `claude`: `auth status` dice che c'è l'accesso; `-p` scrive la scheda buona nella cartella del prompt.
const FINTO_CLAUDE = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
if (process.argv.includes('auth')) { process.stdout.write(JSON.stringify({ loggedIn: true })); process.exit(0); }
let p = ''; process.stdin.on('data', (d) => { p += d; }); process.stdin.on('end', () => {
  const num = /Feedback: (\\S+)/.exec(p)[1]; const dir = /Cartella delle schede: (.+)/.exec(p)[1].trim();
  fs.writeFileSync(path.join(dir, num + '.json'), JSON.stringify({ numero: num, stato: 'todo', mittente: 'utente',
    titolo_breve: 'Menu storto', riassunto: 'Il menu si apre a sinistra.', tipo: 'bug', area: 'browser-schede',
    file_probabili: [], urgente: false, valido: 'si', prova: 'letto', risolto_su_main: null, doppione_di: [], parole_chiave: [], note: '' }));
  process.stdout.write(JSON.stringify({ result: '#' + num + ': fatta', total_cost_usd: 0 }));
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

test('r2 rilanciato dopo un salvataggio fallito, la scheda arriva nel feedback', async () => {
  test.skip(process.platform === 'win32', 'il finto claude è uno script con la riga #!');
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('filo-1785-r2-');
  const cartella = join(dir, 'schede');
  const bin = join(dir, 'claude');
  writeFileSync(bin, FINTO_CLAUDE);
  chmodSync(bin, 0o755);
  let rispondi = 'no';
  const salvate = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const b = JSON.parse(corpo || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (b.op === 'scheda' && rispondi === 'si') {
        salvate.push(b.numero);
        res.end(JSON.stringify({ ok: true, num: b.numero, id: 'f812', aggiornato: '2026-10-29T12:00:00.000Z',
          scheda: { ...b.scheda, _fonte: { id: 'f812', stato: 'todo', aggiornato: '2026-10-29T12:00:00.000Z', at: '2026-10-29T12:00:00.000Z', modello: 'haiku' }, _fiducia: 'fidato' } }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, reason: 'bad_request', detail: 'il server non risponde ancora' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    mkdirSync(cartella, { recursive: true });
    writeFileSync(join(cartella, 'indice.json'), JSON.stringify([{ id: 'f812', num: '812', stato: 'todo', priorita: null,
      aggiornato: '2026-10-29T10:00:00.000Z', attese: [], unisce: [] }]));
    const env = { ...process.env, FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-finto', FILO_CLAUDE_BIN: bin,
      FILO_ROUTINE_API: `http://127.0.0.1:${server.address().port}` };

    const prima = await lancia(['scrivi', '--cartella', cartella], env);
    expect(prima.out).toMatch(/non salvate nel feedback \(rilancia lo stesso comando\)/);

    // Il server adesso risponde: lo stesso comando deve portare la scheda nel feedback.
    rispondi = 'si';
    const dopo = await lancia(['scrivi', '--cartella', cartella], env);
    expect(salvate, dopo.out).toEqual(['812']);
  } finally {
    server.close();
    togliCartella(dir);
  }
});
