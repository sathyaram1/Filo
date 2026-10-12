// Il profilo «già accolto» con cui parte ogni avvio di Filo nelle prove: senza, appena Filo sa rispondere la home
// aperta comincia l'intervista di benvenuto e la chat della prova ci scrive dentro (#663.6). Chi apre Filo per conto
// suo passa da qui; la regola la tiene tests/unit/proveChatAccoglienza.test.mjs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROFILO_ACCOLTO = { filo_onboarding: { done: true } };

// Solo su una cartella nuova: un secondo avvio sulla stessa cartella è una riapertura e trova i dati di prima.
export function seminaProfiloAccolto(userData) {
  const file = join(userData, 'storage.json');
  if (existsSync(file)) return;
  mkdirSync(userData, { recursive: true });
  writeFileSync(file, JSON.stringify(PROFILO_ACCOLTO));
}
