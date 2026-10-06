// Prova del giro 1 (verifica locale, orchestratore): un rilievo che si lavora solo in locale (codice del server, regole del
// database) finisce in un feedback per le sessioni locali anche scritto come vuole la critica, a parole e senza nomi di file;
// uno dell'interfaccia che nomina un pulsante di deploy resta alle routine.

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const importa = (p) => import(pathToFileURL(resolve(ROOT, p)).href);

const SOLO_LOCALE = [
  'Il server accetta la critica di un verificatore senza controllare da quale ramo arriva',
  'Le regole di Firestore lasciano scrivere il campo nuovo a qualunque utente',
  'La funzione del server che apre i feedback non controlla la priorità',
  'Le regole di sicurezza del database non ammettono il campo nuovo: il salvataggio fallisce',
];
const PER_LE_ROUTINE = [
  'Nella pagina Gestione il pulsante per il deploy è tagliato in tema scuro',
  'Nel menu del tasto destro la voce Copia non copia niente',
];

test('r1 un rilievo sul server o sulle regole del database va a un feedback locale, uno sull’interfaccia alle routine', async () => {
  const { derivatiDaAprire, nuovaPratica } = await importa('scripts/lib/orchestratore.mjs');
  const p = nuovaPratica({ num: 4321, richiesta: 'x' });
  const derived = [...SOLO_LOCALE, ...PER_LE_ROUTINE].map((text) => ({ level: 1, sede: 'e', text }));
  const aperti = derivatiDaAprire(p, derived, 'auto');
  const dove = {};
  for (const d of aperti) for (const f of derived) if (d.testo.includes(f.text)) dove[f.text] = d.dove;
  const sbagliati = [
    ...SOLO_LOCALE.filter((t) => dove[t] !== 'locale').map((t) => `alle routine, ma si fa solo in locale: ${t}`),
    ...PER_LE_ROUTINE.filter((t) => dove[t] !== 'non-locale').map((t) => `in locale, ma è dell’interfaccia: ${t}`),
  ];
  expect(sbagliati).toEqual([]);
});
