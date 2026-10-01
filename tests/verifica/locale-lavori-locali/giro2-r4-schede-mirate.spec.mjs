// Verifica locale «lavori locali», giro 2, rilievo 4: la lettura mirata di più feedback o schede (ricompense, Gestione
// che si aggiorna, schede fuori pagina) risponde. Legge la bacheca pubblica VERA, che non vuole credenziali. Non apre Filo.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('le schede chieste per numero tornano: la lettura mirata della bacheca risponde', async () => {
  await imp('src/shared/feedbackThread.js');
  await imp('src/shared/feedbackPublicKey.js');
  await imp('src/shared/feedbackCrypto.js');
  await imp('src/shared/feedbackClientIdHash.js');
  await imp('src/shared/feedback.js');
  const FB = globalThis.SN_FEEDBACK;
  const { FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  const r = await fetch(`${FIRESTORE_BASE}/feedback-public?pageSize=2&mask.fieldPaths=seq`);
  test.skip(!r.ok, 'bacheca pubblica non raggiungibile');
  const ids = ((await r.json()).documents || []).map((d) => d.name.split('/').pop());
  expect(ids.length).toBeGreaterThan(0);
  const schede = await FB.getManyPublic(ids, { timeoutMs: 20000 });
  expect(schede.map((s) => s._id).sort()).toEqual([...ids].sort());
});
