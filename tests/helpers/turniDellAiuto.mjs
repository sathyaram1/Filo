// I turni dell'Aiuto fra le chiamate che un modello finto tiene in globalThis.__visti. Lo stesso finto lo chiamano da sé
// anche il saluto della home e il correttore, coi tempi loro (#2654): un turno si riconosce dal protocollo dell'Aiuto
// nel sistema e dalla frase nell'ultimo messaggio dell'utente, mai dalla posizione nella fila.

import { expect } from '@playwright/test';

// I messaggi dell'n-esima chiamata dell'Aiuto (da 0) partita per `frase`, attesa finché arriva.
export async function turnoDellAiuto(app, frase, n = 0, { timeout = 20_000 } = {}) {
  const turni = () => app.evaluate((_electron, frase) => {
    const testo = (c) => (typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((p) => (p && p.type === 'text' ? String(p.text) : '')).join('\n') : '');
    return (globalThis.__visti || []).filter((ms) => {
      if (!ms.some((m) => m.role === 'system' && testo(m.content).includes('# Protocollo di risposta'))) return false;
      const utente = [...ms].reverse().find((m) => m.role === 'user');
      return !!utente && testo(utente.content).includes(frase);
    });
  }, frase);
  await expect.poll(async () => (await turni()).length, { timeout, message: `l'Aiuto non ha chiamato il modello per «${frase}»` })
    .toBeGreaterThan(n);
  return (await turni())[n];
}

// Le parti dell'ultimo messaggio dell'utente di un turno, anche quando il contenuto è una stringa sola.
export function partiDellUtente(turno) {
  const utente = [...turno].reverse().find((m) => m.role === 'user');
  return Array.isArray(utente?.content) ? utente.content : [{ type: 'text', text: String(utente?.content || '') }];
}

// L'immagine dell'n-esimo turno per `frase`, o null se è partito senza.
export async function fotoDelTurno(app, frase, n = 0) {
  const foto = partiDellUtente(await turnoDellAiuto(app, frase, n)).find((p) => p.type === 'image_url');
  return foto ? foto.image_url.url : null;
}
