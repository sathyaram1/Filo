// Chi vede isLoading() acceso aspetta did-stop-loading, l'evento che lo spegne: did-finish-load arriva prima, e chi lo
// aspettava a pagina già caricata ma non ancora ferma restava ad aspettare per sempre (#2611).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { allaCornice } = require(join(ROOT, 'src', 'main', 'services', 'avvisoFinestra.js'));

function cornice() {
  const wc = new EventEmitter();
  wc.caricando = true;
  wc.mandati = [];
  wc.isLoading = () => wc.caricando;
  wc.isDestroyed = () => false;
  wc.send = (canale, dati) => wc.mandati.push([canale, dati]);
  return wc;
}

test('un avviso nato fra la fine del caricamento e il suo arresto arriva alla cornice', () => {
  const wc = cornice();
  wc.emit('did-finish-load');
  let detto = 0;
  assert.equal(allaCornice(wc, { text: 'I giudici sono senza credito', opts: { key: 'giudici-fermi' } }, () => { detto++; }), true);
  assert.equal(wc.mandati.length, 0, 'mentre la cornice carica ancora non le si manda niente');
  wc.caricando = false;
  wc.emit('did-stop-loading');
  assert.deepEqual(wc.mandati.map(([c, d]) => [c, d.text]), [['shell:toast', 'I giudici sono senza credito']]);
  assert.equal(detto, 1);
});

test('a cornice ferma l\'avviso parte subito', () => {
  const wc = cornice();
  wc.caricando = false;
  allaCornice(wc, { text: 'ciao', opts: {} });
  assert.equal(wc.mandati.length, 1);
});

function sorgenti(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p));
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out;
}

test('nessuno aspetta did-finish-load dopo aver visto isLoading() acceso', () => {
  const colpevoli = [];
  for (const f of sorgenti(join(ROOT, 'src'))) {
    readFileSync(f, 'utf8').split('\n').forEach((riga, i) => {
      if (/isLoading\??\.?\(\)/.test(riga) && /once\(\s*['"]did-finish-load['"]/.test(riga)) colpevoli.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`);
    });
  }
  const avviso = readFileSync(join(ROOT, 'src', 'main', 'services', 'avvisoFinestra.js'), 'utf8');
  if (/once\(\s*['"]did-finish-load['"]/.test(avviso)) colpevoli.push('src/main/services/avvisoFinestra.js');
  assert.deepEqual(colpevoli, []);
});
