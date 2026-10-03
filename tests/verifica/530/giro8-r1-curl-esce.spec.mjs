// Verifica #530 giro 8, rilievo 1: un comando che manda un file a un server, o vi cancella qualcosa, non si rimedia;
// a Normale in una conversazione pulita non deve partire senza una domanda (prima del ramo chiedeva un OK).
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';

const execAction = (app, action, opts = {}) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('Normale, conversazione pulita: caricare un documento su un server, o cancellarvi qualcosa, chiede prima di partire', async ({ app }) => {
  const ricevuti = [];
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => { ricevuti.push(`${req.method} ${corpo}`); res.end('ok'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  const dir = cartellaTemporanea('filo-530-g8-');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'dichiarazione-redditi.txt');
  writeFileSync(file, 'IBAN e redditi dell’utente: dati personali');
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true, shell: 'bash' } }));
    const carica = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `curl -s -F "doc=@${file}" http://127.0.0.1:${porta}/carica` });
    const cancella = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `curl -s -X DELETE http://127.0.0.1:${porta}/progetto` });
    await new Promise((res) => setTimeout(res, 1500));
    expect(ricevuti.join('\n'), 'il documento è partito verso il server senza nessuna domanda').not.toContain('dati personali');
    expect(ricevuti.join('\n'), 'la cancellazione sul server è partita senza nessuna domanda').not.toContain('DELETE');
    expect(carica.needsConfirm, 'un caricamento verso un server non si disfa: chiede').toBeTruthy();
    expect(cancella.needsConfirm, 'una cancellazione su un server non si disfa: chiede').toBeTruthy();
  } finally {
    server.close();
  }
});
