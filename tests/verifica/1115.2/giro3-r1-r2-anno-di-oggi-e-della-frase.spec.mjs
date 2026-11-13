// Verifica #1115.2 giro 3. Rilievo 1: l'anno di oggi scritto nella pagina («Diario 2026») quando la data vicina cade
// nell'altro anno (a novembre, «lunedì 2 marzo» è il 2 marzo prossimo). Rilievo 2: l'anno detto nella stessa frase della
// data («nel 2024, martedì 9 ottobre»): il controllo veloce tace e la data non va nemmeno al modello. Logica pura, a
// data fissa: in app la stessa cosa succede solo nei mesi a cavallo d'anno.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const f of ['src/shared/i18n.js', 'src/shared/contenutoEsterno.js', 'src/shared/constants.js', 'src/content/coerenza.js']) {
  require(`../../../${f}`);
}
const C = globalThis.SN_COERENZA;
const segni = (r) => r.filter((s) => !s.daGiudicare).map((s) => s.spiegazione);

for (const [nome, testo, oggi, intorno, anno] of [
  ['a novembre, «Diario 2026» nel titolo: lunedì 2 marzo 2026', 'lunedì 2 marzo, nevicava', new Date(2026, 10, 13), { titolo: 'Diario 2026' }, 2026],
  ['a metà dicembre, «Riepilogo attività 2026» sopra il campo: lunedì 12 gennaio 2026', 'lunedì 12 gennaio abbiamo cominciato', new Date(2026, 11, 15), { prima: 'Riepilogo attività 2026' }, 2026],
  ['a gennaio, «Calendario 2027» nel titolo: mercoledì 15 dicembre 2027', 'mercoledì 15 dicembre, cena', new Date(2027, 0, 10), { titolo: 'Calendario 2027' }, 2027],
]) {
  test(`r1 ${nome}: la data giusta in quell'anno non si segna, e il modello la riceve con quell'anno`, () => {
    const r = C.dateDi(testo, oggi, intorno);
    expect(segni(r)).toEqual([]);
    const anni = r.filter((s) => s.daGiudicare).flatMap((s) => s.daGiudicare.anni.map((a) => a.anno));
    expect(anni).toContain(anno);
  });
}

test('r2 l\'anno detto nella stessa frase della data: un giorno sbagliato lo giudica qualcuno', () => {
  const oggi = new Date(2026, 10, 13);
  // Il 9 ottobre 2024 era mercoledì, il 9 ottobre 2026 è venerdì: martedì non torna in nessuno dei due.
  const r = C.dateDi('il matrimonio di Marta, nel 2024, martedì 9 ottobre: pioveva', oggi, {});
  expect(r.length).toBeGreaterThan(0);
  // La data giusta di quell'anno resta senza segno.
  expect(segni(C.dateDi('il matrimonio di Marta, nel 2024, mercoledì 9 ottobre: pioveva', oggi, {}))).toEqual([]);
});
