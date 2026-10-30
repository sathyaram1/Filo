// #1785 giro 4 — r1: una scheda buona e fresca nella cartella che il feedback non ha (scritta prima di questo lavoro, o
// rimasta lì perché il comando si è fermato a metà salvataggio) deve arrivare nel feedback, non restare solo nella cartella.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const AGGIORNATO = '2026-10-29T10:00:00.000Z';

function lancia(args, env) {
  return new Promise((ok) => {
    const f = spawn(process.execPath, [join(ROOT, 'scripts', 'schede.mjs'), ...args], { cwd: ROOT, env });
    let out = '';
    f.stdout.on('data', (d) => { out += d; });
    f.stderr.on('data', (d) => { out += d; });
    f.on('close', (code) => ok({ code, out }));
  });
}

test('r1 una scheda fresca nella cartella che il feedback non ha arriva nel feedback', async () => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('filo-1785-g4r1-');
  const cartella = join(dir, 'schede');
  const salvate = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const b = JSON.parse(corpo || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (b.op === 'leggi') {
        // Il feedback aperto, senza scheda salvata.
        res.end(JSON.stringify({ ok: true, resto: [], voci: [{ num: '812', id: 'f812', riga: { _id: 'f812', seq: 812, subSeq: 0, status: 'todo',
          priority: null, updatedAt: AGGIORNATO, waitsFor: [], unisce: [] } }] }));
        return;
      }
      if (b.op === 'scheda') {
        salvate.push(b.numero);
        res.end(JSON.stringify({ ok: true, num: b.numero, id: 'f812', aggiornato: '2026-10-29T12:00:00.000Z',
          scheda: { ...b.scheda, _fonte: { id: 'f812', stato: 'todo', aggiornato: '2026-10-29T12:00:00.000Z', at: '2026-10-29T12:00:00.000Z', modello: 'haiku' }, _fiducia: 'fidato' } }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, reason: 'bad_request' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    mkdirSync(cartella, { recursive: true });
    // La scheda com'era nella cartella dell'owner prima di questo lavoro: buona, della stessa fonte, senza segni.
    writeFileSync(join(cartella, '812.json'), JSON.stringify({ numero: '812', stato: 'todo', mittente: 'utente',
      titolo_breve: 'Menu storto', riassunto: 'Il menu si apre a sinistra.', tipo: 'bug', area: 'browser-schede',
      file_probabili: [], urgente: false, valido: 'si', prova: 'letto', risolto_su_main: null, doppione_di: [], parole_chiave: [], note: '',
      _fonte: { id: 'f812', stato: 'todo', aggiornato: AGGIORNATO, at: '2026-10-27T10:00:00.000Z', modello: 'haiku' },
      _riletta: { at: '2026-10-27T11:00:00.000Z', modello: 'opus' } }));
    const env = { ...process.env, FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${server.address().port}` };

    const elenca = await lancia(['elenca', '--cartella', cartella], env);
    expect(elenca.code, elenca.out).toBe(0);
    const scrivi = await lancia(['scrivi', '--cartella', cartella], env);
    expect(salvate, scrivi.out).toEqual(['812']);
  } finally {
    server.close();
    togliCartella(dir);
  }
});
