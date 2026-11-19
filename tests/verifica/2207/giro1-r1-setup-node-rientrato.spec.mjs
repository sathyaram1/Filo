// Verifica #2207 giro 1: un workflow coi passi rientrati di quattro spazi (YAML valido) che scrive a mano Node 20
// deve far rossa la sentinella, non sparire dalla lettura.
import { test, expect } from '@playwright/test';
import { nodeDeiWorkflow } from '../../helpers/nodeDeiWorkflow.mjs';

test('r1 un setup-node coi passi a quattro spazi e il numero scritto a mano si vede', () => {
  const wf = 'on: push\njobs:\n  uno:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - name: Setup Node\n      uses: actions/setup-node@v4\n      with:\n        node-version: 20\n';
  const trovati = nodeDeiWorkflow(wf);
  expect(trovati.length).toBe(1);
  expect(trovati[0].fonte.file).toBeUndefined();
});
