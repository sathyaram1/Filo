// VERIFICA LOCALE, giro 2: un rilievo messo da parte va a chi può lavorarlo.
// Ciò che tocca il server, le regole del database o Firebase si fa solo in locale;
// un difetto dell'app che nomina il server va alle routine. Niente Electron: logica pura.
import { test, expect } from '@playwright/test';
import { derivatiDaAprire } from '../../../scripts/lib/orchestratore.mjs';

const pratica = { num: 99901, slug: 'prova-dove', derivatiAperti: [] };
const dove = (text) => {
  const aperti = derivatiDaAprire(pratica, [{ level: 1, sede: 'e', text }], 'auto');
  return aperti.length === 1 ? aperti[0].dove : `aperti ${aperti.length}`;
};

const SOLO_LOCALE = [
  'La regola di Firestore sul campo crediti lascia scrivere chiunque',
  'Chiunque può leggere da Firestore i feedback degli altri utenti',
  'Su Firebase i dati di un utente restano dopo la cancellazione dell’account',
  'I server di Filo non controllano la firma della critica',
];
const PER_LE_ROUTINE = [
  'Il messaggio di errore quando il server non risponde è in inglese',
  'La pagina Gestione mostra «errore del server» quando cade la rete e non riprova da sola',
  'In Gestione la colonna con lo stato delle Cloud Functions esce dallo schermo a finestra stretta',
];

test('r1 un rilievo sul server o sul database scritto a parole va al lavoro locale', () => {
  for (const t of SOLO_LOCALE) expect.soft(dove(t), t).toBe('locale');
});

test('r1 un difetto dell’interfaccia che nomina il server va alle routine', () => {
  for (const t of PER_LE_ROUTINE) expect.soft(dove(t), t).toBe('non-locale');
});
