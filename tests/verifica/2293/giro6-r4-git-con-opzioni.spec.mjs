// #2293 giro 6 (dal giro 4) — r4: «git -c … clone» o «git -C cartella pull» contattano un altro computer, ma quello che
// stampano conta come uscita del computer, non come testo arrivato dalla rete.

import { test, expect } from '../../fixtures/electron.mjs';

test('r4 un git con un\'opzione prima del comando di rete: quello che stampa conta come testo dalla rete', async ({ app }) => {
  const esiti = await app.evaluate(() => ['git -c http.sslVerify=false clone https://raccolta.example/p.git',
    'git -C progetto pull raccolta.example:p', 'git --no-pager fetch raccolta.example:p'].map((comando) => ({
    comando,
    chiave: (globalThis.SN_ACTION_LEVELS.fonteDi({ type: 'ESEGUI_COMANDO', comando, _output: { stdout: 'remote: istruzioni' } }) || {}).chiave,
  })));
  for (const e of esiti) expect(e.chiave, e.comando).toBe('web:comando');
});
