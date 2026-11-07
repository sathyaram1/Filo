// #759.1: i «no» a «Resta connesso» restano dopo un riavvio, ma sul disco il sito non si legge (decisione D-8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const { crea } = require('../../src/main/services/noRestaConnesso.js');

function profilo() {
  const dir = cartellaTemporanea('filo-no-resta-');
  const apri = () => crea({ file: join(dir, 'resta-connesso-no.json'), fileSale: join(dir, 'resta-connesso-no.sale') });
  const tutto = () => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  return { dir, apri, tutto };
}

test('un «no» blocca la proposta per lo stesso sito anche dopo un riavvio, non per un altro', async () => {
  const p = profilo();
  await p.apri().segna('posta.example.it');
  const dopo = p.apri();
  assert.equal(await dopo.detto('posta.example.it'), true);
  assert.equal(await dopo.detto('POSTA.example.it'), true, 'le maiuscole non cambiano il sito');
  assert.equal(await dopo.detto('banca.example.it'), false);
});

test('sul disco non c\'è il nome del sito, né il dominio, né la sua forma base', async () => {
  const p = profilo();
  const t = p.apri();
  await t.segna('accounts.miabanca.example');
  await t.segna('google.com');
  const disco = p.tutto();
  for (const pezzo of ['miabanca', 'accounts', 'example', 'google', '.com']) {
    assert.ok(!disco.toLowerCase().includes(pezzo), `il disco contiene «${pezzo}»`);
  }
  assert.equal(readdirSync(p.dir).length, 2, 'il sale sta in un file suo');
});

test('due profili con sali diversi danno impronte diverse dello stesso sito', async () => {
  const a = profilo();
  const b = profilo();
  await a.apri().segna('posta.example.it');
  await b.apri().segna('posta.example.it');
  const impronte = (p) => JSON.parse(readFileSync(join(p.dir, 'resta-connesso-no.json'), 'utf8')).impronte;
  assert.equal(impronte(a).length, 1);
  assert.notDeepEqual(impronte(a), impronte(b));
  assert.notEqual(readFileSync(join(a.dir, 'resta-connesso-no.sale'), 'utf8'), readFileSync(join(b.dir, 'resta-connesso-no.sale'), 'utf8'));
});

test('il sì toglie il «no»; senza il suo sale un\'impronta non vale più', async () => {
  const p = profilo();
  const t = p.apri();
  await t.segna('posta.example.it');
  await t.segna('banca.example.it');
  await t.togli('posta.example.it');
  const dopo = p.apri();
  assert.equal(await dopo.detto('posta.example.it'), false);
  assert.equal(await dopo.detto('banca.example.it'), true);

  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(p.dir, 'resta-connesso-no.sale'), 'rovinato');
  assert.equal(await p.apri().detto('banca.example.it'), false);
});

test('la descrizione per la chat non nega più che il database del sito passi con «Resta connesso»', () => {
  require('../../src/shared/capabilities.js');
  const voce = globalThis.SN_CAPABILITIES.get('stay-signed-in');
  const testo = `${voce.desc} ${voce.doesNot}`;
  assert.ok(!/non i database del sito/i.test(testo), testo);
  assert.match(voce.desc, /database compreso/);
  assert.match(voce.desc, /riavvi/i, 'dice che il «no» resta anche dopo un riavvio');
});
