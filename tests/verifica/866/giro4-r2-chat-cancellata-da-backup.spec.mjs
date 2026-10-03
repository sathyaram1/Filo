// Verifica #866 giro 4, rilievo 2: una chat cancellata non torna da un backup di prima, come non tornano le pagine cancellate.
// Niente Electron: il filo scrive in una cartella temporanea, e «riaprire Filo» è un'istanza nuova sulla stessa cartella.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { STORAGE_KEYS: { FILO_CHATS: 'filo_chats' } };
const magazzino = {};
globalThis.chrome = { storage: { local: {
  async get(k) { return { [k]: magazzino[k] }; },
  async set(o) { Object.assign(magazzino, o); },
  async remove(k) { for (const x of [].concat(k)) delete magazzino[x]; },
} } };
require('../../../src/shared/chatArchive.js');
require('../../../src/shared/filoEventi.js');
const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
const Chats = globalThis.SN_FILO_CHATS;

test('una chat cancellata non torna importando un backup fatto prima, nemmeno dopo aver riaperto Filo', async () => {
  const cartella = cartellaTemporanea('filo-866-g4-backup-');
  try {
    let f = creaFilo({ cartella });
    globalThis.SN_IL_FILO = f;
    await Chats.append('chat-delicata', [{ role: 'user', text: 'una cosa privata' }, { role: 'filo', text: 'capito' }]);
    const backup = await f.esporta();
    await Chats.remove('chat-delicata');

    await f.importa(backup);
    expect((await f.chats()).map((c) => c.id), 'stessa sessione').toEqual([]);

    f = creaFilo({ cartella });
    globalThis.SN_IL_FILO = f;
    await f.importa(backup);
    expect((await f.chats()).map((c) => c.id), 'dopo aver riaperto Filo la chat cancellata è tornata').toEqual([]);
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
});
