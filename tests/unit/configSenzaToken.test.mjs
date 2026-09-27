// Un rinnovo della sessione che inciampa non spegne la configurazione dell'owner (#679.2).
// Senza token la richiesta parte da anonimo e il server dice «non ti riguarda»:
// non è una risposta su questo account, e non si mette via. Senza il fix è ROSSO.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Support = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));

let orologio = 1_000_000;
beforeEach(() => {
  orologio = 1_000_000;
  Support.invalidaCache();
  Support._setAdesso(() => orologio);
  Defaults._setAdesso(() => orologio);
});

// Il server come le regole vere: i documenti dell'owner rispondono 403 a chi
// arriva senza token, `config/models` è pubblico. `rete.giu` fa cadere le GET,
// `rete.inciampo` fa fallire il rinnovo chiudendo la sessione, come fa
// google-auth quando il rinnovo non va.
function conServer(rete, fn) {
  const orig = {
    token: auth.getIdToken, admin: auth.isAdmin, profilo: auth.getProfile,
    dentro: auth.isSignedIn, fetch: global.fetch,
  };
  const sessione = { aperta: true };
  const letture = [];
  auth.isSignedIn = () => sessione.aperta;
  auth.isAdmin = () => sessione.aperta;
  auth.getProfile = () => (sessione.aperta ? { email: 'owner@esempio.it' } : null);
  auth.getIdToken = async () => {
    if (!sessione.aperta) return null;
    if (rete.inciampo) { sessione.aperta = false; throw new Error('refresh sessione fallito (503)'); }
    return 'token-vero';
  };
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const metodo = opts.method || 'GET';
    if (metodo === 'PATCH') return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    letture.push(u);
    if (rete.giu) throw new Error('rete');
    const conToken = Boolean(opts.headers && opts.headers.Authorization);
    const pubblico = u.includes('config/models?');
    if (!pubblico && !conToken) return { ok: false, status: 403, async json() { return {}; }, async text() { return 'denied'; } };
    let fields = {};
    if (u.includes('judgeSecrets')) fields = { openrouterKey: { stringValue: 'sk-giudici' } };
    else if (u.includes('supportModels')) fields = { sanitizer: { stringValue: rete.sanitizer || 'kimi' } };
    else if (u.includes('config/secrets')) fields = { apiKeys: { mapValue: { fields: { openrouter: { stringValue: 'sk-ruotata' } } } } };
    else if (pubblico) fields = { provider: { stringValue: rete.provider || 'openrouter' } };
    return { ok: true, status: 200, async json() { return { fields }; }, async text() { return ''; } };
  };
  const torna = () => { sessione.aperta = true; rete.inciampo = false; };
  return Promise.resolve()
    .then(() => fn({ letture, torna }))
    .finally(() => {
      auth.getIdToken = orig.token; auth.isAdmin = orig.admin; auth.getProfile = orig.profilo;
      auth.isSignedIn = orig.dentro; global.fetch = orig.fetch;
    });
}

test('modelli di supporto: l’inciampo non svuota la schermata e, tornata la sessione, non resta in circolo', async () => {
  const rete = {};
  await conServer(rete, async ({ torna }) => {
    const buona = await Support.get();
    assert.equal(buona.sanitizer, 'kimi', 'premessa');
    assert.equal(buona.openrouterKeyPresent, true, 'premessa');

    orologio += Support.CACHE_TTL_MS + 1;
    rete.inciampo = true;
    const durante = await Support.get();
    assert.equal(durante.sanitizer, 'kimi', 'i modelli scelti dall’owner non spariscono per un rinnovo andato storto');
    assert.equal(durante.openrouterKeyPresent, true, 'la chiave dei giudici non diventa «non impostata»');

    torna();
    orologio += 1000;
    rete.sanitizer = 'flash';
    assert.equal((await Support.get()).sanitizer, 'flash',
      'a sessione tornata si rilegge subito: il rifiuto dato a un anonimo non valeva cinque minuti');
  });
});

test('modelli di supporto: senza una copia buona il rifiuto all’anonimo non si mette via', async () => {
  const rete = { inciampo: true };
  await conServer(rete, async ({ torna, letture }) => {
    await Support.get();
    const prima = letture.length;
    torna();
    orologio += 1000;
    const dopo = await Support.get();
    assert.ok(letture.length > prima, 'tornata la sessione si richiede');
    assert.equal(dopo.sanitizer, 'kimi');
    assert.equal(dopo.openrouterKeyPresent, true);
  });
});

test('modelli di supporto: salvato e rete giù subito dopo, la schermata mostra il salvato', async () => {
  const rete = {};
  await conServer(rete, async () => {
    await Support.get();
    rete.giu = true;
    const dopo = await Support.update({ judge1: 'deepseek', openrouterKey: 'sk-nuova' }, 'token-vero');
    assert.equal(dopo.judge1, 'deepseek', 'il salvataggio è andato: si vede');
    assert.equal(dopo.sanitizer, 'kimi', 'e il resto non torna vuoto');
    assert.equal(dopo.openrouterKeyPresent, true, 'la chiave c’è');
    rete.giu = false;
    rete.sanitizer = 'flash';
    assert.equal((await Support.get()).sanitizer, 'flash', 'la copia dopo il salvataggio è scaduta: tornata la rete si rilegge');
  });
});

test('configurazione condivisa: l’inciampo non fa pagare la chiave del build al posto di quella ruotata', async () => {
  const rete = {};
  await conServer(rete, async ({ torna, letture }) => {
    await Defaults.refresh();
    assert.equal(Defaults.get().apiKeys.openrouter, 'sk-ruotata', 'premessa');

    rete.inciampo = true;
    await Defaults.refresh();
    torna();
    assert.equal(Defaults.get().apiKeys.openrouter, 'sk-ruotata',
      'tornato dentro, l’owner usa la sua chiave ruotata e non quella dell’installazione');

    const prima = letture.length;
    await Defaults.refreshIfStale();
    assert.ok(letture.some((u, i) => i >= prima && u.includes('config/secrets')),
      'la lettura non riuscita non rimanda la prossima di mezz’ora');
  });
});

test('configurazione condivisa: un «non ti riguarda» detto a un token vero spegne le chiavi lette', async () => {
  const rete = {};
  await conServer(rete, async () => {
    await Defaults.refresh();
    assert.equal(Defaults.get().apiKeys.openrouter, 'sk-ruotata', 'premessa');
    const f = global.fetch;
    global.fetch = async (url, opts) => (String(url).includes('config/secrets')
      ? { ok: false, status: 403, async json() { return {}; }, async text() { return ''; } }
      : f(url, opts));
    await Defaults.refresh();
    global.fetch = f;
    assert.notEqual(Defaults.get().apiKeys.openrouter, 'sk-ruotata');
  });
});

test('modelli predefiniti: salvato e rete giù subito dopo, la schermata non torna ai valori di prima', async () => {
  const rete = { provider: 'openrouter' };
  await conServer(rete, async () => {
    await Defaults.refresh();
    rete.giu = true;
    const dopo = await Defaults.update({ providerSort: 'price', models: { chat: 'kimi' } }, 'token-vero');
    assert.equal(dopo.providerSort, 'price');
    assert.equal(dopo.models.chat, 'kimi');
  });
});
