// Verifica #1734 giro 1: il clone che il giro delle routine prepara (dispatch, solo collegamenti) non eredita un
// Electron diverso da quello che il lock fissa, quando il principale ha ricevuto il lock nuovo senza reinstallare.
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { allineaPacchetti } from '../../../scripts/lib/clone-worker.mjs';

const LOCK = JSON.stringify({
  name: 'x', lockfileVersion: 3,
  packages: { '': { name: 'x' }, 'node_modules/electron': { version: '2.0.0' }, 'node_modules/a': { version: '1.0.0' } },
});

function alberi(installato) {
  const b = cartellaTemporanea('v1734-');
  const p = join(b, 'principale');
  const c = join(b, 'clone');
  for (const d of [p, c]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'package-lock.json'), LOCK); }
  for (const [nome, v] of [['electron', installato], ['a', '1.0.0']]) {
    mkdirSync(join(p, 'node_modules', nome), { recursive: true });
    writeFileSync(join(p, 'node_modules', nome, 'package.json'), JSON.stringify({ name: nome, version: v }));
  }
  writeFileSync(join(p, 'node_modules', '.package-lock.json'), LOCK);
  return { p, c };
}

test('r1 col lock uguale e un Electron vecchio nel principale, il clone preparato dal giro non collega quell\'Electron', () => {
  const { p, c } = alberi('1.0.0');
  let installazione = false;
  const npmCi = () => {
    installazione = true;
    mkdirSync(join(c, 'node_modules', 'electron'), { recursive: true });
    writeFileSync(join(c, 'node_modules', 'electron', 'package.json'), JSON.stringify({ name: 'electron', version: '2.0.0' }));
    return { ok: true, codice: 0, out: '' };
  };
  // Le stesse opzioni con cui il giro prepara il clone del worker e la sua intestazione.
  const r = allineaPacchetti(c, p, { soloCollegati: true, npmCi, avvisa: () => {} });
  expect(r.ok).toBe(true);
  expect(installazione, JSON.stringify(r)).toBe(true);
  expect(r.pacchetti).not.toBe('collegati');
  expect(JSON.parse(readFileSync(join(c, 'node_modules', 'electron', 'package.json'), 'utf8')).version).toBe('2.0.0');
});

test('r1 con le versioni uguali il clone del giro resta collegato, senza installare', () => {
  const { p, c } = alberi('2.0.0');
  let installazione = false;
  const r = allineaPacchetti(c, p, { soloCollegati: true, npmCi: () => { installazione = true; return { ok: true, codice: 0, out: '' }; }, avvisa: () => {} });
  expect(r.pacchetti).toBe('collegati');
  expect(installazione).toBe(false);
});
