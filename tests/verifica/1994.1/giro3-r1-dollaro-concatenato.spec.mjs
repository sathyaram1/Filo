// #1994.1 giro 3 — `$_` attaccato a sé stesso raddoppia (o moltiplica) il valore a ogni comando: una riga di duecento
// caratteri non deve tenere fermo il conto per secondi. Si misura in unità di riferimento, non in millisecondi.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { costoInUnita } from '../../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

test('r1 una catena corta che attacca $_ a sé stesso si valuta in fretta', () => {
  test.setTimeout(120_000);
  for (const shell of ['bash', 'sh']) {
    const ctx = { cwd: '/home/u/proj', home: '/home/u', shell };
    // 193 caratteri: sul ramo del giro 3 costavano otto secondi, nel processo principale.
    const c = costoInUnita(() => {
      C.classify(`echo abcd; ${'git log $_$_$_$_$_$_$_$_; '.repeat(7)}`, ctx);
    }, { tetto: 60, giri: 1 });
    expect(c.entro, `${shell}: ${c.come}`).toBe(true);
    // Le catene corte si misurano ancora col loro valore.
    expect(C.classify('echo a; git log $_$_', ctx), shell).toBe(1);
    expect(C.classify('echo --output=x; git log $_$_', ctx), shell).toBe(3);
  }
});
