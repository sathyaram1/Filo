// #784 giro 3, rilievo 1: finché SECURITY.md §3 promette che le funzioni che
// gestiscono i feedback rispondono solo alle pagine di Filo, l'annullamento di
// una segnalazione automatica (cambia lo stato di un feedback) da un sito deve
// tornare «rifiutato per provenienza». Verde se cade la promessa o se regge.

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };
const SITO_CON_SCHEDA = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };

function sezione3() {
  const md = fs.readFileSync(path.join(process.cwd(), 'SECURITY.md'), 'utf8');
  const da = md.indexOf('\n## 3.');
  const a = md.indexOf('\n## 4.', da + 1);
  return da < 0 ? '' : md.slice(da, a < 0 ? undefined : a);
}

test('r1 la promessa del §3 sulle funzioni dei feedback regge anche per l\'annullamento di una segnalazione', async ({ app, shell }) => {
  void shell;
  const promette = /gestiscono i feedback[\s\S]{0,80}solo alle pagine/i.test(sezione3().replace(/\s+/g, ' '));
  test.skip(!promette, 'il §3 non promette più niente sulle funzioni che gestiscono i feedback');

  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const msg = { type: MSG.CANCEL_AUTO_FEEDBACK, id: 'fb-uno' };
    const conTetto = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ scaduto: true }), 20000))]);
    return {
      sito: await conTetto(globalThis.SN_HANDLE_MESSAGE(msg, mittenti.sito)),
      sitoConScheda: await conTetto(globalThis.SN_HANDLE_MESSAGE(msg, mittenti.sitoConScheda)),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    const r = out[provenienza];
    expect(r, `${provenienza}: nessuna risposta`).toBeTruthy();
    expect(r.ok, `${provenienza}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(
      String(r.code || ''),
      `${provenienza}: rifiutato per il motivo sbagliato (${JSON.stringify(r)}) — con la sessione del proprietario passerebbe, e il §3 dice il contrario`,
    ).toBe('forbidden');
  }
});
