// #1240: un solo «fetch failed» del runner Linux verso il server delle chiavi ha fermato il bake, e la versione è uscita senza Linux.
// Qui la regola: la rete e il server sovraccarico si ritentano con attese di minuti, un rifiuto e un documento senza chiavi no.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  chiaviDalServer, esitoDaRitentare, descriviEsitoServer, titoloAllarmeBake, ATTESE_S, TETTO_RICHIESTA_MS,
} from '../../scripts/bake-default-config.mjs';

const CHIAVI = { ok: true, apiKeys: { tavily: 't' }, safeBrowsingKey: 'g' };

// Ogni richiesta prende la risposta successiva della fila: 'chiudi' taglia la connessione (il «fetch failed» del runner),
// 'muto' non risponde mai, un numero è uno stato HTTP, un oggetto è il JSON con 200.
async function serverAFila(fila) {
  let n = 0;
  const appese = [];
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const passo = fila[Math.min(n++, fila.length - 1)];
      if (passo === 'chiudi') { req.socket.destroy(); return; }
      if (passo === 'muto') { appese.push(res); return; }
      const stato = typeof passo === 'number' ? passo : 200;
      res.writeHead(stato, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(typeof passo === 'number' ? { ok: false } : passo));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return {
    canale: `http://127.0.0.1:${srv.address().port}`,
    richieste: () => n,
    chiudi: () => new Promise((ok) => { for (const r of appese) r.destroy(); srv.closeAllConnections(); srv.close(ok); }),
  };
}

async function chiedi(fila, opzioni = {}) {
  const srv = await serverAFila(fila);
  const righe = [];
  const attese = [];
  try {
    const r = await chiaviDalServer('giusta', {
      canale: srv.canale, attese: [1, 2, 3], aspetta: async (ms) => { attese.push(ms); }, log: (x) => righe.push(x), ...opzioni,
    });
    return { ...r, richieste: srv.richieste(), attese, registro: righe.join('\n') };
  } finally {
    await srv.chiudi();
  }
}

test('una connessione tagliata dal runner non costa le chiavi: al secondo tentativo arrivano', async () => {
  const r = await chiedi(['chiudi', CHIAVI]);
  assert.equal(r.esito.stato, 'ok', r.registro);
  assert.equal(r.apiKeys.tavily, 't');
  assert.equal(r.richieste, 2);
  assert.deepEqual(r.attese, [1000]);
  assert.match(r.registro, /tentativo 2 di 4/);
});

test('un server sovraccarico o giù per un momento si aspetta', async () => {
  for (const stato of [503, 500, 429]) {
    const r = await chiedi([stato, stato, CHIAVI]);
    assert.equal(r.esito.stato, 'ok', `HTTP ${stato}: ${r.registro}`);
    assert.equal(r.richieste, 3);
  }
});

test('una richiesta appesa ha un tetto, poi si riprova', async () => {
  const r = await chiedi(['muto', CHIAVI], { tetto: 200 });
  assert.equal(r.esito.stato, 'ok', r.registro);
  assert.match(r.registro, /nessuna risposta in \d+ s/);
});

test('rifiuto, parola d’ordine sbagliata e documento senza chiavi non si ritentano: aspettare non li cura', async () => {
  for (const passo of [{ ok: false, reason: 'bad_passphrase' }, 401, 404, { ok: true, apiKeys: {} }]) {
    const r = await chiedi([passo, CHIAVI]);
    assert.notEqual(r.esito.stato, 'ok', JSON.stringify(passo));
    assert.equal(r.richieste, 1, `${JSON.stringify(passo)} non va ritentato`);
    assert.deepEqual(r.attese, []);
  }
});

test('se la rete non torna, il guasto dice quanti tentativi e cosa è successo davvero', async () => {
  const r = await chiedi(['chiudi']);
  assert.equal(r.esito.stato, 'rete');
  assert.equal(r.richieste, 4);
  assert.deepEqual(r.attese, [1000, 2000, 3000]);
  const frase = descriviEsitoServer(r.esito);
  assert.match(frase, /a tutti i 4 tentativi/);
  assert.match(frase, /fetch failed: \S/, `«fetch failed» da solo non dice cosa è successo: ${frase}`);
});

test('le attese coprono un disservizio di un minuto e ogni richiesta ha il suo tetto', () => {
  assert.ok(ATTESE_S.reduce((a, b) => a + b, 0) >= 60, 'un singhiozzo di un minuto non deve fermare una piattaforma');
  assert.ok(ATTESE_S.every((s, i) => i === 0 || s >= ATTESE_S[i - 1]), 'le attese crescono');
  assert.ok(TETTO_RICHIESTA_MS >= 30_000, 'un avvio a freddo del server non è un guasto');
  assert.equal(esitoDaRitentare({ stato: 'rete' }), true);
  assert.equal(esitoDaRitentare({ stato: 'http', status: 502 }), true);
  assert.equal(esitoDaRitentare({ stato: 'http', status: 403 }), false);
  assert.equal(esitoDaRitentare({ stato: 'rifiutato' }), false);
  assert.equal(esitoDaRitentare(undefined), false);
});

test('col server muto il titolo dell’allarme non dice che la chiave manca dal server', () => {
  const muto = titoloAllarmeBake('tavily', { stato: 'rete', tentativi: 5 });
  assert.match(muto, /server delle chiavi non ha risposto/);
  assert.doesNotMatch(muto, /manca la chiave di default/);
  assert.match(titoloAllarmeBake('tavily', { stato: 'ok' }), /manca la chiave di default tavily/);
  assert.match(titoloAllarmeBake('', { stato: 'senza-chiavi' }), /nessuna chiave di default/);
});
