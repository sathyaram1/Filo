// Sentinella: le correzioni di Chromium arrivano nelle patch di Electron, e il lockfile le ferma finché qualcuno non lo
// alza. scripts/motore-ultima-patch.mjs lo dice con un feedback; qui si prova cosa conta come «indietro» e quando
// l'allarme parte. Regole: patterns/il-motore-si-tiene-fra-le-ultime-tre-major-di-electron.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  versioneDelLockfile, leggiPubblicate, confronta, chiaveDelMotore, allarme, argomentiNpm, controlla,
} from '../../scripts/motore-ultima-patch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBBLICATE = ['44.7.0', '44.7.2', '44.8.0-beta.1', '45.0.0'];
const lockCon = (version) => ({ packages: { 'node_modules/electron': { version } } });

test('44.7.0 con 44.7.2 uscita è indietro; anteprime e altre major non contano', () => {
  assert.deepEqual(confronta('44.7.0', PUBBLICATE), { major: 44, attuale: '44.7.0', ultima: '44.7.2', indietro: true });
});

test('sull\'ultima stabile della major è in pari, anche con una beta più alta e una major nuova uscite', () => {
  assert.equal(confronta('44.7.2', PUBBLICATE).indietro, false);
  assert.equal(confronta('44.7.2', PUBBLICATE).ultima, '44.7.2');
});

test('le versioni si confrontano coi numeri, non come testo: 44.10.0 viene dopo 44.9.3', () => {
  const esito = confronta('44.9.3', ['44.9.3', '44.10.0', '44.2.11']);
  assert.equal(esito.ultima, '44.10.0');
  assert.equal(esito.indietro, true);
});

test('la risposta di npm: una stringa se la major ha una versione sola, un elenco se ne ha di più', () => {
  assert.deepEqual(leggiPubblicate('"44.0.0"\n'), ['44.0.0']);
  assert.deepEqual(leggiPubblicate(JSON.stringify(PUBBLICATE)), PUBBLICATE);
});

test('risposta vuota, non JSON o d\'altra forma: nessun confronto', () => {
  for (const r of ['', '   ', 'npm ERR! network', '{"error":{"code":"E404"}}', 'null', '[]', undefined]) {
    assert.equal(confronta('44.7.0', leggiPubblicate(r)), null, `risposta «${r}»`);
  }
  assert.equal(confronta('44.7.0', ['45.0.0', '44.8.0-beta.1']), null, 'nessuna stabile della 44');
  assert.equal(confronta('non una versione', PUBBLICATE), null);
});

test('il lockfile: la versione di Electron, o null se non c\'è', () => {
  assert.equal(versioneDelLockfile(lockCon('44.7.0')), '44.7.0');
  for (const lock of [null, {}, { packages: {} }, lockCon(''), lockCon(44)]) assert.equal(versioneDelLockfile(lock), null);
  assert.ok(versioneDelLockfile(JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))),
    'il lockfile vero deve dire allo script quale Electron installa');
});

test('a npm si chiedono le versioni della sola major, in JSON', () => {
  assert.deepEqual(argomentiNpm(44), ['view', 'electron@44', 'version', '--json']);
});

test('indietro: l\'allarme parte una volta, con la chiave della major e le due versioni nel testo', async () => {
  const lette = [];
  const allarmi = [];
  const codice = await controlla({
    lock: lockCon('44.7.0'),
    leggi: async (major) => { lette.push(major); return JSON.stringify(PUBBLICATE); },
    avvisa: async (...a) => { allarmi.push(a); return true; },
    log: () => {},
  });
  assert.equal(codice, 0);
  assert.deepEqual(lette, [44]);
  assert.equal(allarmi.length, 1);
  const [titolo, testo, chiavi] = allarmi[0];
  assert.deepEqual(chiavi, ['motore:electron-44']);
  for (const v of ['44.7.0', '44.7.2']) {
    assert.ok(titolo.includes(v), `il titolo dice la ${v}`);
    assert.ok(testo.includes(v), `il testo dice la ${v}`);
  }
  assert.ok(testo.includes('npm install --save-dev electron@44.7.2'), 'il testo dice il comando');
  assert.ok(testo.includes('patterns/il-motore-si-tiene-fra-le-ultime-tre-major-di-electron.md'), 'e dove sta il resto');
});

test('in pari, rete giù o risposta illeggibile: niente allarme e uscita 0, con un avviso nel registro', async () => {
  const casi = [
    ['in pari', async () => JSON.stringify(PUBBLICATE), '44.7.2', /in pari/],
    ['rete giù', async () => { throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org'); }, '44.7.0', /::warning::.*ENOTFOUND/],
    ['vuota', async () => '', '44.7.0', /::warning::.*non si legge/],
    ['non JSON', async () => 'npm ERR! 503', '44.7.0', /::warning::.*non si legge/],
  ];
  for (const [nome, leggi, versione, atteso] of casi) {
    const righe = [];
    let allarmi = 0;
    const codice = await controlla({ lock: lockCon(versione), leggi, avvisa: async () => { allarmi += 1; return true; }, log: (r) => righe.push(r) });
    assert.equal(codice, 0, nome);
    assert.equal(allarmi, 0, `${nome}: nessun allarme`);
    assert.match(righe.join('\n'), atteso, nome);
  }
});

test('indietro e allarme non arrivato: il passo lo mostra uscendo 1', async () => {
  const codice = await controlla({ lock: lockCon('44.7.0'), leggi: async () => JSON.stringify(PUBBLICATE), avvisa: async () => false, log: () => {} });
  assert.equal(codice, 1);
});

test('la chiave cambia con la major: un allarme aperto sulla 44 non assorbe quello della 45', () => {
  assert.equal(chiaveDelMotore(44), 'motore:electron-44');
  assert.notEqual(chiaveDelMotore(45), chiaveDelMotore(44));
  assert.deepEqual(allarme({ major: 45, attuale: '45.0.0', ultima: '45.0.1' }).chiavi, ['motore:electron-45']);
});

test('lo script usa solo moduli di Node: gira in un lavoro senza npm ci', () => {
  for (const f of ['motore-ultima-patch.mjs', 'build-alarm.mjs']) {
    const src = readFileSync(join(ROOT, 'scripts', f), 'utf8');
    for (const [, da] of src.matchAll(/^import [^;]*? from '([^']+)'/gm)) {
      assert.ok(/^node:|^\.\//.test(da), `${f} importa «${da}»: nel lavoro della pubblicazione node_modules non c'è`);
    }
  }
});
