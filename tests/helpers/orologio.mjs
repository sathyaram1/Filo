// L'orologio finto di node:test (`mock.timers`, con setTimeout e Date) e le attese che gli servono: una prova che conta
// il tempo in tick dà lo stesso esito su una macchina ferma e su una carica. Non finge setImmediate: è quello che svuota.
// Regola e racconto: patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md (#1063).

import { mock } from 'node:test';

/** Lascia correre le catene di promesse e le richiamate già pronte, senza far passare tempo sull'orologio finto. */
export async function svuota(giri = 20) {
  for (let i = 0; i < giri; i += 1) await new Promise((r) => setImmediate(r));
}

/** Fa passare `ms` sull'orologio finto: prima e dopo lascia correre quello che è pronto. */
export async function scorri(ms, { timers = mock.timers } = {}) {
  await svuota();
  if (ms > 0) timers.tick(ms);
  await svuota();
}

/** Lo stato di una promessa letto quando serve, senza aspettarla: `fatto`, `valore`, `errore`. */
export function inAttesa(promessa) {
  const stato = { fatto: false, valore: undefined, errore: undefined };
  Promise.resolve(promessa).then(
    (v) => { stato.fatto = true; stato.valore = v; },
    (e) => { stato.fatto = true; stato.errore = e; },
  );
  return stato;
}

/**
 * Fa passare il tempo a passi di `passo` finché la promessa si chiude, al massimo `oltre` ms: oltre è un rosso col
 * conto del tempo, non una prova appesa.
 */
export async function finoA(promessa, { passo = 50, oltre = 60_000, timers = mock.timers } = {}) {
  const stato = inAttesa(promessa);
  let passato = 0;
  await svuota();
  while (!stato.fatto && passato < oltre) {
    await scorri(passo, { timers });
    passato += passo;
  }
  if (!stato.fatto) throw new Error(`dopo ${passato} ms sull'orologio finto la promessa non si è ancora chiusa`);
  if (stato.errore !== undefined) throw stato.errore;
  return stato.valore;
}
