// Giro 1 della verifica #2255: il computer stesso scritto senza «http://» o con l'IPv4 abbreviato deve valere come
// localhost per il link e per il comando, come la forma piena. Non apre Filo: giudica le regole delle due strade.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'urlNav.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;

// La risposta della tabella a livello predefinito, a compito pulito e dopo una lettura.
function risposte(action, richiesta) {
  const i = AL.ingressi(action, { richiesta });
  const d = (stato) => A.decideDettaglio({ livello: 'default', stato, costo: i.costo, chiesta: i.chiesta, difesa: i.difesa,
    parola: i.parola, dentroPerimetro: i.dentroPerimetro, campo: i.campo }).risposta;
  return { segreto: i.segreto, pulito: d('pulito'), contaminato: d('contaminato') };
}
const comando = (c) => risposte({ type: 'ESEGUI_COMANDO', comando: c }, c);
const link = (u) => risposte({ type: 'NAVIGA', url: u }, `apri ${u}`);

test('r1 il link a localhost senza http://, che Filo apre su localhost, non porta fuori la password', () => {
  // Filo completa «localhost:8080/…» in «http://localhost:8080/…»: la pagina che si apre è del computer.
  expect(globalThis.SN_URL_NAV.normalizeUrl('localhost:8080/login?password=Gatto2024!')).toBe('http://localhost:8080/login?password=Gatto2024!');
  expect(link('localhost:8080/login?password=Gatto2024!')).toEqual(link('http://localhost:8080/login?password=Gatto2024!'));
});

test('r1 il comando verso localhost senza http:// risponde come quello con http://', () => {
  expect(comando('curl -u admin:Gatto2024! localhost:8080')).toEqual(comando('curl -u admin:Gatto2024! http://localhost:8080/'));
  expect(comando('curl localhost:8080/login?password=Gatto2024!')).toEqual(comando('curl http://localhost:8080/login?password=Gatto2024!'));
});

test('r1 il comando verso 127.1 risponde come il link allo stesso indirizzo e come 127.0.0.1', () => {
  const u = 'http://127.1:8080/?password=Gatto2024!';
  expect(comando(`curl ${u}`)).toEqual(comando('curl http://127.0.0.1:8080/?password=Gatto2024!'));
  expect(link(u).segreto).toBe(comando(`curl ${u}`).segreto);
});
