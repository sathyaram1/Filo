// Verifica #779 giro 1: rete che cade a metà, accendi-spegni in fretta, un componente che non parte e «Reinstalla»,
// due Preferenze aperte insieme. Il pacchetto è un driver finto servito in locale, come in tests/altre-app.spec.mjs.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as zlib from 'node:zlib';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

test.skip(process.platform === 'win32', 'il driver finto è uno script sh');

const SHOTS = 'tests/.shots';
const FINTO = resolve('tests/fixtures/cua-driver-finto.mjs');
const LAVORO = cartellaTemporanea('filo-verifica-779-');
const ELENCO = join(LAVORO, 'pacchetti.json');
const ROTTO = join(LAVORO, 'rotto');
process.env.FILO_ALTRE_APP_PACCHETTI = ELENCO;

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

// Il driver non parte finché esiste il file ROTTO: così lo si rompe e lo si aggiusta da fuori.
const FILE = tarDi([
  ['cua-driver', `#!/bin/sh\n[ -f "${ROTTO}" ] && exit 3\nexec "${process.execPath}" "${FINTO}" "$@"\n`],
  ['zavorra.bin', createHash('sha512').update('x').digest('hex').repeat(6000)],
]);
const SHA = createHash('sha256').update(FILE).digest('hex');
let server;
let tagliaAlProssimo = false;

function scriviElenco() {
  writeFileSync(ELENCO, JSON.stringify({
    VERSIONE: '0.0.1-prova',
    BASE: `http://127.0.0.1:${server.address().port}/`,
    PACCHETTI: { [`${process.platform}-${process.arch}`]: { file: 'finto.tar.gz', sha256: SHA, byte: FILE.length, formato: 'tar.gz', eseguibile: 'cua-driver' } },
  }));
}

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const taglia = tagliaAlProssimo;
    tagliaAlProssimo = false;
    res.writeHead(200, { 'Content-Length': FILE.length });
    const passo = Math.ceil(FILE.length / 40);
    for (let i = 0; i < FILE.length; i += passo) {
      if (res.destroyed) return;
      if (taglia && i > FILE.length / 2) { res.destroy(); return; }
      res.write(FILE.subarray(i, i + passo));
      await new Promise((r) => setTimeout(r, 40));
    }
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
test.afterAll(async () => {
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  togliCartella(LAVORO);
});

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const cartellaComponente = async (app) => join(await app.evaluate(() => process.env.FILO_USER_DATA), 'componenti', 'cua-driver');
const PRONTO = 'Il componente è installato e pronto.';

test('la rete che cade a metà dice perché e «Riprova» installa', async ({ shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco();
  tagliaAlProssimo = true;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#altreAppEnabled').check();
  await expect(pref.locator('#altreAppFrase')).toContainText('rete', { timeout: 20_000 });
  await expect(pref.locator('#altreAppRiprova')).toHaveText('Riprova');
  mkdirSync(SHOTS, { recursive: true });
  await pref.locator('#sec-altre-app').screenshot({ path: `${SHOTS}/v779-rete.png` });
  await pref.locator('#altreAppRiprova').click();
  await expect(pref.locator('#altreAppFrase')).toHaveText(PRONTO, { timeout: 20_000 });
});

test('accendi, spegni, accendi in fretta: alla fine è installato; spegni e riaccendi a metà finisce spento e pulito', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco();
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  const c = pref.locator('#altreAppEnabled');
  await c.check(); await c.uncheck(); await c.check();
  await expect(pref.locator('#altreAppFrase')).toHaveText(PRONTO, { timeout: 25_000 });
  expect((await impostazioni(app)).altreApp.enabled).toBe(true);
  const dir = await cartellaComponente(app);
  expect(existsSync(join(dir, '0.0.1-prova', 'cua-driver'))).toBe(true);
  await c.uncheck(); await c.check(); await c.uncheck();
  await expect.poll(async () => (await impostazioni(app)).altreApp?.enabled).toBe(false);
  await expect.poll(() => existsSync(dir), { timeout: 15_000 }).toBe(false);
  await expect(pref.locator('#altreAppStato')).toBeHidden();
});

test('un componente che non parte lo si legge in una frase, e «Reinstalla» lo rimette in piedi', async ({ shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco();
  writeFileSync(ROTTO, '1');
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const pref = await openTab('filo://preferences/preferences.html');
    await pref.locator('#altreAppEnabled').check();
    await expect(pref.locator('#altreAppFrase')).toHaveText('Il componente è installato ma non parte.', { timeout: 25_000 });
    await expect(pref.locator('#altreAppRiprova')).toHaveText('Reinstalla');
    await pref.locator('#sec-altre-app').screenshot({ path: `${SHOTS}/v779-non-parte.png` });
    rmSync(ROTTO, { force: true });
    await pref.locator('#altreAppRiprova').click();
    await expect(pref.locator('#altreAppFrase')).toHaveText(PRONTO, { timeout: 25_000 });
  } finally { rmSync(ROTTO, { force: true }); }
});

test('due Preferenze aperte: la seconda, aperta a metà, vede la stessa barra e lo stesso esito', async ({ shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco();
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const a = await openTab('filo://preferences/preferences.html');
  await a.locator('#altreAppEnabled').check();
  await expect.poll(async () => Number(await a.locator('#altreAppBarra').getAttribute('aria-valuenow')) || 0, { timeout: 10_000 }).toBeGreaterThan(5);
  const b = await openTab('filo://preferences/preferences.html?b=1');
  await expect(b.locator('#altreAppEnabled')).toBeChecked({ timeout: 8_000 });
  await expect(b.locator('#altreAppBarra')).toBeVisible();
  await expect(b.locator('#altreAppFrase')).toHaveText(PRONTO, { timeout: 20_000 });
  await expect(a.locator('#altreAppFrase')).toHaveText(PRONTO);
});
