// VERIFICA LOCALE, giro 3, rilievo 1: se il giudizio non risponde, un rilievo sul server non va alle routine.
// Logica pura: smistatore finto che fallisce come al limite d'uso, si guarda dove finisce il feedback.
import { test, expect } from '@playwright/test';
import { apriDerivatiDi } from '../../../scripts/lib/orchestratore.mjs';

const SERVER = [
  'La chiamata che assegna i crediti di benvenuto si può ripetere due volte di fila e il saldo raddoppia',
  'Un utente anonimo può creare documenti nella raccolta degli inviti, perché la scrittura non chiede di essere autenticati',
  'Un’approvazione di fusione scaduta da più di sette giorni viene ancora accettata dal cancello',
];

function banco(derived, smista) {
  const aperti = [];
  const dep = {
    percorsi: { wt: () => 'wt-finto' },
    verifica: () => ({ entry: { derived } }),
    async esegui(_cmd, args) {
      aperti.push({ titolo: args[1], dove: args[3] });
      return { code: 0, out: `aperto #${8000 + aperti.length}` };
    },
    smista,
  };
  return { dep, p: { num: 99931, slug: 'prova-fallito', derivatiAperti: [] }, aperti };
}

test('r1 col limite d’uso sullo smistamento i rilievi sul server non partono per le routine', async () => {
  const b = banco(SERVER.map((text) => ({ level: 1, sede: 'e', text })), async () => { throw new Error('Claude AI usage limit reached'); });
  await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  expect(b.aperti.filter((a) => a.dove === '--non-locale')).toEqual([]);
});
