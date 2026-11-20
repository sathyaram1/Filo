// #1909.5 giro 1, rilievo 1: rsync --delete dietro un programma che ne lancia un altro (nice -n 19, ionice -c 3,
// sudo -u, timeout, caffeinate) cancella senza cestino come da solo, e deve volere la parola «conferma».
import { test, expect } from '../../fixtures/electron.mjs';

const execAction = (app, action) =>
  app.evaluate((_electron, action) => globalThis.SN_EXECUTE_FILO_ACTION(action), action);

test('r1 rsync --delete dietro nice, ionice, sudo -u, timeout o caffeinate vuole la parola come da solo', async ({ app }) => {
  const comandi = [
    'rsync -a --delete vuota/ ~/Documenti/',
    'nice -n 19 rsync -a --delete vuota/ ~/Documenti/',
    'ionice -c 3 rsync -a --delete vuota/ ~/Documenti/',
    'sudo -u mario rsync -a --delete vuota/ ~/Documenti/',
    'timeout 600 rsync -a --delete vuota/ ~/Documenti/',
    'caffeinate -i rsync -a --delete vuota/ ~/Documenti/',
  ];
  const senzaParola = [];
  for (const comando of comandi) {
    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando, spiegazione: 'Allineo le cartelle' });
    expect(r.executed, `${comando}: non parte senza conferma`).toBeFalsy();
    if (!String(r.describe || '').includes('cancella per sempre, senza passare dal cestino')) senzaParola.push(comando);
  }
  expect(senzaParola, 'comandi che cancellano per sempre e chiedono solo un OK').toEqual([]);
});
