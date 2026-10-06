// #595 — il feedback dell'owner parte dall'app col suo token e la prova del
// mittente; quello di chiunque altro parte anonimo come prima. Il token si
// chiede alla spedizione e non finisce mai nel file della coda.
// Finti: la sessione admin (un token vero in uno spec non esiste) e la rete.

import { test, expect } from './fixtures/electron.mjs';

const SITO = { tab: { id: 1, url: 'https://esempio.it/pagina' }, url: 'https://esempio.it/pagina' };
const TOKEN = 'tok-owner-di-prova';

async function banco(app, { admin }) {
  await app.evaluate(async (_e, { admin, TOKEN }) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const ga = req('./auth/google-auth');
    globalThis.__banco = { inviati: [], tokenChiesti: 0, rete: false };
    ga.isAdmin = () => admin;
    ga.getIdToken = async () => { globalThis.__banco.tokenChiesti += 1; return TOKEN; };
    globalThis.SN_FEEDBACK.submit = async (payload, opts) => {
      globalThis.__banco.inviati.push({ clientId: payload.clientId, opts: opts || null });
      if (!globalThis.__banco.rete) throw new Error('timeout — rete assente (spec)');
      return { id: 'doc-spec', seq: 1, failed: [], ...(opts && opts.idToken ? { senderProof: 'admin' } : {}) };
    };
  }, { admin, TOKEN });
}

async function invia(app, submissionId) {
  return app.evaluate(async (_e, { submissionId, mittente }) => {
    const MSG = globalThis.SN_MSG.MSG;
    return globalThis.SN_HANDLE_MESSAGE({
      type: MSG.SUBMIT_FEEDBACK,
      payload: { submissionId, clientId: 'abc123', text: 'Il pulsante non risponde', images: [] },
    }, mittente);
  }, { submissionId, mittente: SITO });
}

const banco$ = (app) => app.evaluate(() => globalThis.__banco);

test('l’owner spedisce col token fresco e la coda su disco non lo contiene mai', async ({ app, shell }) => {
  void shell;
  await banco(app, { admin: true });
  const r = await invia(app, 'spec-owner-1');
  expect(r.ok, JSON.stringify(r)).toBe(true);

  // Primo tentativo senza rete: la voce resta in coda, persistita.
  await expect.poll(async () => (await banco$(app)).inviati.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const suDisco = await app.evaluate(async () => {
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    await new Promise((r) => setTimeout(r, 400)); // il debounce dello storage
    const coda = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.FEEDBACK_OUTBOX, []);
    const file = path.join(process.env.FILO_USER_DATA, 'storage.json');
    return { coda: JSON.stringify(coda), file: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
  });
  expect(suDisco.coda).toContain('spec-owner-1');
  expect(suDisco.coda).not.toContain('tok-owner');
  expect(suDisco.file).not.toContain('tok-owner');

  // Torna la rete: il ritentativo chiede un token nuovo e parte autenticato.
  await app.evaluate(() => { globalThis.__banco.rete = true; });
  await expect.poll(async () => (await banco$(app)).inviati.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const b = await banco$(app);
  const ultimo = b.inviati[b.inviati.length - 1];
  expect(ultimo.clientId).toBe('owner:abc123');
  // #912: con la prova o niente, mai il ripiego anonimo.
  expect(ultimo.opts).toEqual({ idToken: TOKEN, soloAdmin: true });
  expect(b.tokenChiesti).toBeGreaterThanOrEqual(2);
});

test('chi non è l’owner spedisce anonimo come prima, senza che si chieda un token', async ({ app, shell }) => {
  void shell;
  await banco(app, { admin: false });
  await app.evaluate(() => { globalThis.__banco.rete = true; });
  const r = await invia(app, 'spec-utente-1');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await expect.poll(async () => (await banco$(app)).inviati.length, { timeout: 20_000 }).toBe(1);
  const b = await banco$(app);
  expect(b.inviati[0].clientId).toBe('abc123');
  expect(b.inviati[0].opts).toBeNull();
  expect(b.tokenChiesti).toBe(0);
});

// #912: senza accesso valido la voce dell'owner non parte da anonima: aspetta, la cornice lo dice, e parte con la prova
// appena il token torna.
test('l’owner senza accesso aspetta invece di partire da utente, e parte con la prova quando l’accesso torna', async ({ app, avvisi }) => {
  await banco(app, { admin: true });
  await app.evaluate(() => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const ga = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'))('./auth/google-auth');
    globalThis.__banco.rete = true;
    globalThis.__banco.token = '';
    ga.getIdToken = async () => { globalThis.__banco.tokenChiesti += 1; return globalThis.__banco.token; };
  });
  const r = await invia(app, 'spec-owner-attesa');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await expect.poll(async () => (await banco$(app)).tokenChiesti, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'aspetta il tuo accesso' }).first()).toBeVisible({ timeout: 15_000 });
  expect((await banco$(app)).inviati).toEqual([]);

  await app.evaluate((_e, t) => { globalThis.__banco.token = t; }, TOKEN);
  await expect.poll(async () => (await banco$(app)).inviati.length, { timeout: 60_000 }).toBe(1);
  const b = await banco$(app);
  expect(b.inviati[0].clientId).toBe('owner:abc123');
  expect(b.inviati[0].opts).toEqual({ idToken: TOKEN, soloAdmin: true });
});
