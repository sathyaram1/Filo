// Verifica #2468, giro 1: la scheda Compiti della Gestione si rilegge ogni minuto; dopo la prima lettura il main deve
// chiedere al server solo i cambiati (`dopo`) e dare alla pagina l'elenco intero lo stesso. Harness di tests/unit/compiti.test.mjs.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(process.cwd());

const compito = (id, extra = {}) => Object.assign({ id, numero: Number(id.slice(2)), tipo: 'manuale', stato: 'aperto', aperto: true, urgenza: 30, fiducia: 'fidato', titolo: id, istruzioni: '', biglietti: [] }, extra);

test('r1 la seconda lettura della scheda Compiti chiede al server solo i cambiati, e la pagina vede ancora tutti i compiti', async () => {
  const ricevute = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      ricevute.push(data);
      const delta = Number(data.dopo) > 0;
      const result = delta
        ? { ok: true, delta: true, aperti: [], storico: [], adesso: 2000, ambiti: [] }
        : { ok: true, aperti: [compito('C-1'), compito('C-2')], storico: [compito('C-9', { aperto: false, stato: 'fatto', chiusoIl: 500 })], altri: false, adesso: 1000, ambiti: [] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;
  try {
    const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
    require.cache[authPath] = {
      id: authPath, filename: authPath, loaded: true,
      exports: {
        isSignedIn: () => true, isAdmin: () => true, getIdToken: async () => 'token-di-prova',
        getProfile: () => ({ email: 'owner@esempio' }), getUid: async () => 'uid-owner', getAccessToken: async () => '',
        onChange: () => () => {},
      },
    };
    require(join(ROOT, 'src', 'shared', 'ambiti.js'));
    require(join(ROOT, 'src', 'shared', 'ricorrenti.js'));
    require(join(ROOT, 'src', 'shared', 'compiti.js'));
    require(join(ROOT, 'src', 'shared', 'constants.js'));
    require(join(ROOT, 'src', 'shared', 'messages.js'));
    const MSG = globalThis.SN_MSG.MSG;
    const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
    const handlers = new Map();
    register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastLiveUpdate() {}, broadcastToFiloPages() {} });
    const elenco = handlers.get(MSG.COMPITI_ELENCO);
    // Il messaggio che la scheda manda a ogni giro del minuto.
    const chiama = () => elenco({ type: MSG.COMPITI_ELENCO, storico: 100 }, { isShell: true }, 'filo://manage/manage.html');

    const prima = await chiama();
    expect(prima.aperti.map((c) => c.id)).toEqual(['C-1', 'C-2']);
    const seconda = await chiama();
    expect(ricevute.length).toBe(2);
    expect(Number(ricevute[1].dopo) > 0, `seconda richiesta a ownerCompiti: ${JSON.stringify(ricevute[1])}`).toBe(true);
    expect(seconda.aperti.map((c) => c.id)).toEqual(['C-1', 'C-2']);
    expect(seconda.storico.map((c) => c.id)).toEqual(['C-9']);
  } finally {
    delete process.env.FILO_FUNCTIONS_BASE;
    await new Promise((r) => server.close(r));
  }
});
