// Verifica #583, giro 8 — la scheda pubblica porta l'identificativo di account
// di chi ha votato e di chi ha chiesto la riapertura.
//
// COSA FOTOGRAFA
//   L'audit voleva togliere a un estraneo il modo di ricostruire chi sta
//   provando Filo e su cosa. Il lavoro lo fa bene per chi SEGNALA: l'impronta
//   sulla scheda è di QUELLA scheda, così nessuno può raggruppare i fix per
//   segnalatore (era un rilievo del primo giro, ed è stato chiuso).
//
//   Accanto, sulla stessa scheda e nella stessa collezione che chiunque legge
//   senza credenziali, restano due mappe con dentro l'identificativo VERO
//   dell'account Google: `votes` e `reopenRequests`. Quell'identificativo è lo
//   stesso su tutte le schede, quindi chi legge la bacheca raggruppa: «questo
//   account ha votato su questi quaranta fix, e ha chiesto di riaprire questi
//   tre». È esattamente il raggruppamento che per chi segnala è stato chiuso.
//
// PERCHÉ NON È UN DIFETTO E BASTA
//   La chiave di quelle mappe DEVE essere l'identificativo dell'account: è
//   così che le regole controllano che uno scriva solo il proprio voto
//   (`request.auth.uid`), e le regole non sanno calcolare un'impronta. Togliere
//   l'identificativo vuol dire spostare i voti altrove e far contare i totali a
//   qualcun altro — un cambio vero, con un costo. È una scelta, e la scelta non
//   è di un automatismo.
//
//   Questa prova è VERDE: fotografa com'è oggi, non pretende che cambi.

import { test, expect } from './../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function blocco(testo, percorso) {
  const apre = testo.indexOf(`match ${percorso} {`);
  if (apre < 0) return null;
  const i = testo.indexOf('{', apre + `match ${percorso}`.length);
  let livello = 0;
  for (let j = i; j < testo.length; j += 1) {
    if (testo[j] === '{') livello += 1;
    else if (testo[j] === '}') {
      livello -= 1;
      if (livello === 0) return testo.slice(i + 1, j);
    }
  }
  return null;
}

test('la scheda che chiunque legge porta l\'account di chi ha votato', async ({ app, shell }) => {
  void shell;

  // 1. La collezione delle schede si legge senza nessuna credenziale: è la sua
  //    ragione d'essere (la bacheca gira anche da sloggati).
  const regole = blocco(readFileSync(join(ROOT, 'firestore.rules'), 'utf8'), '/feedback-public/{doc}');
  expect(regole, 'blocco /feedback-public non letto').toBeTruthy();
  expect(/allow\s+read\s*:\s*if\s+true/.test(regole)).toBe(true);

  // 2. E le due mappe degli utenti sono fra i campi ammessi su quella scheda.
  expect(/'votes'/.test(regole) && /'reopenRequests'/.test(regole)).toBe(true);

  const out = await app.evaluate(async () => {
    const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;
    const uid = 'PJx7mQaK2ZfL0dVb9nRcT4sWgE13'; // la forma di un identificativo Google
    const fb = {
      _id: 'fb-1', name: 'Un fix', status: 'done', statusPublic: 'closed',
      createdAt: '2026-06-01T00:00:00Z', resolvedAt: '2026-06-02T00:00:00Z',
      resolvedInVersion: '0.2.70', clientIdHash: 'a'.repeat(32), priority: 2,
      votes: { [uid]: { vote: 'broken', at: '2026-06-03T00:00:00Z', credibilitySnapshot: 1 } },
      reopenRequests: { [uid]: { at: '2026-06-03T00:00:00Z' } },
    };
    const card = V.cardFor(fb);
    const carry = V.carryUserFields(fb, null);
    const scheda = { ...card, ...carry };
    return {
      uid,
      // L'impronta di chi ha SEGNALATO: legata a questa scheda, non
      // all'installazione. Su una scheda diversa viene diversa — è il rilievo
      // chiuso al primo giro, e regge.
      improntaQui: card.clientIdTag,
      improntaAltrove: V.cardFor({ ...fb, _id: 'fb-2' }).clientIdTag,
      // Le chiavi delle due mappe degli utenti, così come finiscono sulla
      // scheda che chiunque legge.
      chiaviVoti: Object.keys(scheda.votes || {}),
      chiaviRiaperture: Object.keys(scheda.reopenRequests || {}),
    };
  });

  // Chi segnala non si raggruppa: due schede, due impronte diverse.
  expect(out.improntaQui).not.toBe(out.improntaAltrove);

  // Chi vota sì: la chiave è l'account vero, uguale su ogni scheda.
  expect(out.chiaviVoti).toEqual([out.uid]);
  expect(out.chiaviRiaperture).toEqual([out.uid]);
});
