// Verifica #779 giro 1, rilievo 2: il driver vero tiene configurazione, identificativo e storico nella sua «casa»
// (~/.cua-driver) se nessuno gliela indica: spegnere deve toglierli, quindi deve stare
// nella cartella del componente. Il driver finto scrive in FINTO_REGISTRO l'ambiente con cui parte.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import * as zlib from 'node:zlib';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

test.skip(process.platform === 'win32', 'il driver finto è uno script sh');

const FINTO = resolve('tests/fixtures/cua-driver-finto.mjs');
const LAVORO = cartellaTemporanea('filo-verifica-779-casa-');
const ELENCO = join(LAVORO, 'pacchetti.json');
const REGISTRO = join(LAVORO, 'registro.jsonl');
process.env.FILO_ALTRE_APP_PACCHETTI = ELENCO;
process.env.FINTO_REGISTRO = REGISTRO;

function tarDi(voci) {
  const blocchi = [];
  for (const [nome, contenuto] of voci) {
    const dati = Buffer.from(contenuto);
    const h = Buffer.alloc(512);
    h.write(nome, 0); h.write('0000755', 100); h.write('0000000', 108); h.write('0000000', 116);
    h.write(dati.length.toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.write('0', 156);
    h.write('ustar\u0000', 257, 'latin1'); h.write('00', 263); h.fill(32, 148, 156);
    let s = 0; for (const b of h) s += b;
    h.write(`${s.toString(8).padStart(6, '0')}\u0000 `, 148, 'latin1');
    blocchi.push(h, dati, Buffer.alloc((512 - (dati.length % 512)) % 512));
  }
  blocchi.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocchi), { level: 0 });
}
const FILE = tarDi([['cua-driver', `#!/bin/sh\nexec "${process.execPath}" "${FINTO}" "$@"\n`]]);
const SHA = createHash('sha256').update(FILE).digest('hex');
let server;

test.beforeAll(async () => {
  server = createServer((req, res) => { res.writeHead(200, { 'Content-Length': FILE.length }); res.end(FILE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  writeFileSync(ELENCO, JSON.stringify({
    VERSIONE: '0.0.1-prova',
    BASE: `http://127.0.0.1:${server.address().port}/`,
    PACCHETTI: { [`${process.platform}-${process.arch}`]: { file: 'finto.tar.gz', sha256: SHA, byte: FILE.length, formato: 'tar.gz', eseguibile: 'cua-driver' } },
  }));
});
test.afterAll(async () => {
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  togliCartella(LAVORO);
});

const dentro = (radice, p) => { const r = relative(radice, p); return !!p && !r.startsWith('..') && !isAbsolute(r); };

test('r2 il driver parte con la sua casa dentro la cartella del componente, che lo spegnimento toglie', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#altreAppEnabled').check();
  await expect(pref.locator('#altreAppFrase')).toHaveText('Il componente è installato e pronto.', { timeout: 20_000 });
  await expect.poll(() => existsSync(REGISTRO)).toBe(true);
  const avvio = readFileSync(REGISTRO, 'utf8').trim().split('\n').map((r) => JSON.parse(r)).find((v) => v.avvio);
  const componente = join(await app.evaluate(() => process.env.FILO_USER_DATA), 'componenti', 'cua-driver');
  const env = avvio.env;
  // La casa del driver: CUA_DRIVER_HOME se c'è, altrimenti la cartella dell'utente.
  const casa = env.CUA_DRIVER_HOME || env.HOME || env.USERPROFILE;
  expect(dentro(componente, casa), `casa del driver: ${casa}`).toBe(true);
});
