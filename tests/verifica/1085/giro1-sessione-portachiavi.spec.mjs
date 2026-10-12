// #1085 giro 1 — un auth.bin che non si decifra per un portachiavi passeggero torna da solo quando il
// portachiavi torna, come l'identità dell'installazione: altrimenti il caso reversibile resta definitivo.
// Electron finto (safeStorage con una chiave che si cambia), disco vero.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const userData = cartellaTemporanea('filo-verifica-1085-');

const portachiavi = { chiave: 'A' };
const electronFinto = {
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`${portachiavi.chiave}|${s}`, 'utf8'),
    decryptString: (b) => {
      const t = Buffer.from(b).toString('utf8');
      if (!t.startsWith(`${portachiavi.chiave}|`)) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return t.slice(2);
    },
  },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronFinto;
  return caricaOriginale.call(this, request, parent, isMain);
};

const AUTH = join(__dirname, '..', '..', '..', 'src', 'main', 'auth');
const store = require(join(AUTH, 'token-store.js'));
const google = require(join(AUTH, 'google-auth.js'));

test('un avvio col portachiavi sbagliato non fa uscire per sempre: tornato il portachiavi, la sessione Google riparte', () => {
  writeFileSync(join(userData, 'auth.bin'), electronFinto.safeStorage.encryptString(JSON.stringify({ refreshToken: 'rt-google', email: 'chi@prova.test', name: 'Chi', picture: '' })));

  // Avvio con il portachiavi sbagliato: fuori, ma il file resta da parte.
  portachiavi.chiave = 'B';
  google.restore();
  expect(google.isSignedIn()).toBe(false);
  expect(existsSync(join(userData, 'auth.bin'))).toBe(false);

  // Avvio dopo, col portachiavi di sempre: come per l'identità, deve riprendere da solo.
  portachiavi.chiave = 'A';
  google.restore();
  expect(google.isSignedIn()).toBe(true);
  expect(store.load()?.refreshToken).toBe('rt-google');
});
