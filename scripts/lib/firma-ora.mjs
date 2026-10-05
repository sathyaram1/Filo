// L'ora dell'ultima modifica che ogni scrittura di un feedback da script firma (#676), e la sua scrittura.
// Le regole si pubblicano solo da main, dopo la fusione: finché non ammettono `updatedAt` il 403 si riprova senza,
// come fa l'app. Sentinella: tests/unit/scriptFirmaOraRegoleVecchie.test.mjs.

export const firmaOra = () => ({ timestampValue: new Date().toISOString() });

const MASCHERA = 'updateMask.fieldPaths';

/** Una PATCH su un feedback. Se le regole rifiutano la firma, la stessa scrittura riparte senza: il resto conta di più. */
export async function patchFirmato(url, init = {}) {
  const res = await fetch(url, init);
  if (res.status !== 403) return res;
  const u = new URL(String(url));
  const campi = u.searchParams.getAll(MASCHERA);
  let body;
  try { body = JSON.parse(String(init.body || '{}')); } catch { return res; }
  if (!campi.includes('updatedAt') || !body?.fields || !('updatedAt' in body.fields)) return res;
  delete body.fields.updatedAt;
  u.searchParams.delete(MASCHERA);
  for (const c of campi) if (c !== 'updatedAt') u.searchParams.append(MASCHERA, c);
  return fetch(u.toString(), { ...init, body: JSON.stringify(body) });
}
