// #953 giro 3: la segnalazione che Filo propone da solo quando ammette di non saper fare una cosa (non chiesta dal
// modello) e quella automatica dello stesso turno: dalla chat pulita dell'owner partono con la sua prova.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

const TOKEN = 'tok-owner-953-g3';

async function accesso(app, admin) {
  await app.evaluate((_e, { admin, token }) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => admin;
    ga.isSignedIn = () => admin;
    ga.getUid = async () => 'uid-owner';
    ga.getIdToken = async () => (admin ? token : '');
    globalThis.__inviati = [];
    let n = 7000;
    globalThis.SN_FEEDBACK.submit = async (payload, opts) => {
      globalThis.__inviati.push({ clientId: payload.clientId, idToken: !!(opts && opts.idToken) });
      return { id: `doc-${n}`, seq: n++, failed: [] };
    };
  }, { admin, token: TOKEN });
}

const inviati = (app) => app.evaluate(() => globalThis.__inviati);

test('la proposta di Filo dopo un «non so fare», confermata dall’owner in chat pulita, parte col suo nome', async ({ app }) => {
  await accesso(app, true);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Mi dispiace, non so fare screenshot dello schermo intero.' }]);
  await chiedi(page, 'fammi uno screenshot dello schermo intero');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
  await clickConfirm(page, 'ok');
  await expect.poll(() => inviati(app), { timeout: 15000 }).toContainEqual({ clientId: 'owner:filo:chat', idToken: true });
  const tutti = await inviati(app);
  for (const v of tutti) expect(v.idToken, JSON.stringify(tutti)).toBe(true);
});

test('stessa proposta per un utente qualunque: anonima e di Filo', async ({ app }) => {
  await accesso(app, false);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Mi dispiace, non so fare screenshot dello schermo intero.' }]);
  await chiedi(page, 'fammi uno screenshot dello schermo intero');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
  await clickConfirm(page, 'ok');
  await expect.poll(() => inviati(app), { timeout: 15000 }).toContainEqual({ clientId: 'filo:chat', idToken: false });
  const tutti = await inviati(app);
  for (const v of tutti) expect(v.idToken, JSON.stringify(tutti)).toBe(false);
});
