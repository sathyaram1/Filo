// Il Red Team in pausa (#896): chi lo vede lo decide il main, ed è «in pausa» finché l'interruttore non dice
// esplicitamente il contrario. Rossa senza il fix: il cancello non esisteva e il Red Team era di tutti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const Gate = require(join(ROOT, 'src', 'main', 'services', 'redteamGate.js'));

// Un Firestore finto per config/redteam: `doc` è il documento (null = 404), `giu` la rete assente.
function conFirestore(stato, fn) {
  const origFetch = global.fetch;
  const origAdmin = auth.isAdmin;
  const origToken = auth.getIdToken;
  const letture = [];
  const scritture = [];
  auth.isAdmin = () => !!stato.owner;
  auth.getIdToken = async () => 'token-owner';
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (stato.giu) throw new TypeError('fetch failed');
    if (opts.method === 'PATCH') {
      scritture.push({ url: u, body: JSON.parse(opts.body) });
      stato.doc = { openToAll: JSON.parse(opts.body).fields.openToAll.booleanValue };
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    letture.push(u);
    if (!stato.doc) return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    return {
      ok: true, status: 200,
      async json() { return { fields: { openToAll: { booleanValue: stato.doc.openToAll } } }; },
      async text() { return ''; },
    };
  };
  let t = 1_000_000;
  Gate._setAdesso(() => t);
  const avanza = (ms) => { t += ms; };
  return Promise.resolve()
    .then(() => fn({ letture, scritture, avanza }))
    .finally(() => {
      global.fetch = origFetch;
      auth.isAdmin = origAdmin;
      auth.getIdToken = origToken;
      Gate._setAdesso(null);
    });
}

test('#896 — mai letto, documento assente o interruttore spento: in pausa per chi non è owner', async () => {
  await conFirestore({ doc: null }, async ({ avanza }) => {
    avanza(Gate.SCADENZA_MS * 2);
    assert.equal((await Gate.rileggiOra()).visible, false, 'documento assente = in pausa');
  });
  await conFirestore({ doc: { openToAll: false } }, async ({ avanza }) => {
    avanza(Gate.SCADENZA_MS * 2);
    assert.equal((await Gate.rileggiOra()).visible, false);
  });
});

test('#896 — l’owner lo vede sempre; acceso l’interruttore lo vedono tutti', async () => {
  await conFirestore({ doc: { openToAll: false }, owner: true }, async () => {
    const s = await Gate.rileggiOra();
    assert.equal(s.visible, true);
    assert.equal(s.owner, true);
    assert.equal(s.openToAll, false);
  });
  await conFirestore({ doc: { openToAll: true } }, async () => {
    const s = await Gate.rileggiOra();
    assert.equal(s.visible, true);
    assert.equal(s.openToAll, true);
  });
});

test('#896 — la riaccensione arriva senza riavvio: scaduta la copia, la domanda successiva rilegge', async () => {
  const stato = { doc: { openToAll: false } };
  await conFirestore(stato, async ({ letture, avanza }) => {
    await Gate.rileggiOra();
    assert.equal(Gate.visibile(), false);
    const cambi = [];
    const via = Gate.suCambio((s) => cambi.push(s.visible));
    try {
      stato.doc = { openToAll: true }; // l'owner lo riapre da un'altra installazione
      const n = letture.length;
      Gate.aggiorna();
      assert.equal(letture.length, n, 'dentro la scadenza non si rilegge');
      avanza(Gate.SCADENZA_MS + 1);
      Gate.aggiorna();
      await Gate.assicura();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(Gate.visibile(), true);
      assert.deepEqual(cambi, [true], 'chi ascolta (la home aperta) lo sa subito');
    } finally { via(); }
  });
});

test('#896 — rete giù: resta l’ultima risposta del server, non si apre da sé', async () => {
  const stato = { doc: { openToAll: false } };
  await conFirestore(stato, async ({ avanza }) => {
    await Gate.rileggiOra();
    stato.giu = true;
    avanza(Gate.SCADENZA_MS + 1);
    assert.equal((await Gate.rileggiOra()).visible, false);
  });
});

test('#896 — il gesto dell’owner scrive openToAll e updatedAt, e vale subito qui', async () => {
  const stato = { doc: { openToAll: false }, owner: true };
  await conFirestore(stato, async ({ scritture }) => {
    const s = await Gate.impostaApertoATutti(true);
    assert.equal(s.openToAll, true);
    assert.equal(scritture.length, 1);
    assert.match(scritture[0].url, /config\/redteam\?/);
    assert.match(scritture[0].url, /updateMask\.fieldPaths=openToAll/);
    assert.match(scritture[0].url, /updateMask\.fieldPaths=updatedAt/);
    assert.deepEqual(Object.keys(scritture[0].body.fields).sort(), ['openToAll', 'updatedAt']);
    assert.ok(scritture[0].body.fields.updatedAt.timestampValue, 'updatedAt è un timestamp, come vogliono le regole');
    stato.owner = false;
    assert.equal(Gate.visibile(), true, 'aperto a tutti: lo vede anche chi non è owner');
    await Gate.impostaApertoATutti(false).then(() => assert.fail('chi non è owner non scrive'), () => {});
  });
});

test('#896 — la frase della pausa è una sola, dovunque si mostri', () => {
  const frase = Gate.FRASE_PAUSA;
  assert.equal(frase, 'Il Red Team è in pausa: tornerà dopo il rilascio', 'la stessa frase del server');
  for (const file of [
    ['src', 'pages', 'redteam', 'pausa.html'],
    ['src', 'pages', 'redteam', 'redteam.js'],
    ['src', 'content', 'redteamAttack.js'],
  ]) {
    assert.ok(readFileSync(join(ROOT, ...file), 'utf8').includes(frase), `${file.join('/')} non dice la frase della pausa`);
  }
});

test('#896 — la home e il tasto destro chiedono al main prima di mostrare il Red Team', () => {
  const dash = readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard.js'), 'utf8');
  assert.match(dash, /redteamVisibile && \{ command: 'redteam'/);
  const content = readFileSync(join(ROOT, 'src', 'content', 'content.js'), 'utf8');
  assert.match(content, /if \(redteamVisibile\) items\.push\(buildRedteamAttackItem\(\)\)/);
});
