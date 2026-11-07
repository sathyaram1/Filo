// Verifica #2225 giro 3: un rosso solo di Windows va corretto da chi riallinea, che gira su Linux e non lo vede fallire.
// L'esito unito che arriva al server deve portare cosa ha detto il test su Windows, non solo il suo nome.
import { test, expect } from '@playwright/test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 il rosso di Windows arriva al server con il suo errore, non col solo nome del test', async () => {
  const { campoEsito, unisciParti } = await import(pathToFileURL(join(ROOT, 'scripts', 'unit-fusione-azione.mjs')).href);
  const ramo = 'a'.repeat(40);
  const main = 'b'.repeat(40);
  const errore = "Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'd:'";
  const provaWindows = {
    esito: 'rosso_sulla_fusione',
    mainSha: main,
    rossi: ['tests/unit/aiutoAttesa.test.mjs › importa il modulo'],
    coda: `not ok 1 - importa il modulo\n  ${errore}`,
  };
  const campoWindows = campoEsito({ ramo, main, prova: provaWindows });
  const campoLinux = { ramo, main, esito: 'verde', mainSha: main };
  const out = unisciParti({
    ramo, main,
    parti: [
      { nome: 'linux', risultato: 'success', campo: JSON.stringify(campoLinux) },
      { nome: 'windows', risultato: 'success', campo: JSON.stringify(campoWindows) },
    ],
  });
  expect(out.esito).toBe('rosso_sulla_fusione');
  expect(out.rossi).toEqual(['tests/unit/aiutoAttesa.test.mjs › importa il modulo [Windows]']);
  expect(JSON.stringify(out)).toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
});
