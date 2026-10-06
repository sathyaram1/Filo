// VERIFICA LOCALE, giro 3: un rilievo messo da parte va dove lo manda il giudizio, non le parole che usa.
// Porta del giro 2 ri-provata: lo smistatore è finto, si guarda dove finisce il feedback aperto. Logica pura.
import { test, expect } from '@playwright/test';
import { apriDerivatiDi } from '../../../scripts/lib/orchestratore.mjs';

// Frasi che il ripiego a parole sbaglia: se il feedback va dove dice il giudizio, a decidere è il giudizio.
const SERVER = 'Il contatore dei crediti si può azzerare da un client modificato perché la scrittura non è protetta';
const GIUDICE = 'Il giudice che dà il livello ai feedback riceve il testo senza cornice e si lascia istruire dal mittente';
const APP = 'Il riquadro dei crediti in Preferenze mostra il saldo letto da Firebase con due decimali di troppo';

function banco({ derived, smista }) {
  const aperti = [];
  const prompt = [];
  const dep = {
    percorsi: { wt: () => 'wt-finto' },
    verifica: () => ({ entry: { derived } }),
    async esegui(_cmd, args) {
      aperti.push({ titolo: args[1], dove: args[3] });
      return { code: 0, out: `aperto #${7000 + aperti.length}` };
    },
    smista: smista && (async (p) => { prompt.push(p); return smista(p); }),
  };
  const p = { num: 99903, slug: 'prova-giudizio', derivatiAperti: [] };
  return { dep, p, aperti, prompt };
}
const e = (text) => ({ level: 1, sede: 'e', text });
// Il titolo del feedback è la prima frase, accorciata con i puntini se lunga.
const di = (aperti, t) => aperti.find((a) => t.startsWith(a.titolo.replace(/…$/, '')));

test('il feedback va dove dice il giudizio, anche contro le parole', async () => {
  const b = banco({ derived: [e(SERVER), e(APP), e(GIUDICE)], smista: () => '["locale","non-locale","locale"]' });
  await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  expect(b.aperti).toHaveLength(3);
  expect(di(b.aperti, SERVER).dove).toBe('--locale');
  expect(di(b.aperti, GIUDICE).dove).toBe('--locale');
  expect(di(b.aperti, APP).dove).toBe('--non-locale');
  expect(b.prompt).toHaveLength(1);
  for (const t of [SERVER, APP, GIUDICE]) expect(b.prompt[0]).toContain(t);
  expect(b.p.avvisi || []).toEqual([]);
});

test('una risposta con testo intorno all’array vale lo stesso', async () => {
  const b = banco({ derived: [e(SERVER), e(APP)], smista: () => 'Ecco lo smistamento:\n```json\n["locale", "non-locale"]\n```' });
  await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  expect(b.aperti.map((a) => a.dove).sort()).toEqual(['--locale', '--non-locale']);
  expect(di(b.aperti, SERVER).dove).toBe('--locale');
});

test('se lo smistatore non risponde, i feedback si aprono lo stesso e l’avviso lo dice', async () => {
  const b = banco({ derived: [e(SERVER), e(APP)], smista: () => { throw new Error('Not logged in'); } });
  const falliti = await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  expect(falliti).toBe(0);
  expect(b.aperti).toHaveLength(2);
  expect((b.p.avvisi || []).join(' ')).toMatch(/smistati a parole/);
});

test('una risposta di lunghezza sbagliata non smista a caso', async () => {
  const b = banco({ derived: [e(SERVER), e(APP)], smista: () => '["locale"]' });
  await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  expect(b.aperti).toHaveLength(2);
  expect((b.p.avvisi || []).join(' ')).toMatch(/smistati a parole/);
});

test('al giro dopo si chiede solo dei rilievi nuovi', async () => {
  const b = banco({ derived: [e(SERVER)], smista: () => '["locale"]' });
  await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  b.dep.verifica = () => ({ entry: { derived: [e(SERVER), e(APP)] } });
  b.dep.smista = async (p) => { b.prompt.push(p); return '["non-locale"]'; };
  await apriDerivatiDi(b.dep, b.p, { derivati: 'auto' });
  expect(b.prompt).toHaveLength(2);
  expect(b.prompt[1]).toContain(APP);
  expect(b.prompt[1]).not.toContain(SERVER);
  expect(b.aperti).toHaveLength(2);
  expect(di(b.aperti, SERVER)).toBe(b.aperti[0]);
  expect(di(b.aperti, APP).dove).toBe('--non-locale');
});
