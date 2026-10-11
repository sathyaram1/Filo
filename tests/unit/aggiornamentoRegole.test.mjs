// Quando Filo installa un aggiornamento scaricato (#1039): su Windows mai di nascosto alla chiusura, ma
// all'apertura con la barra visibile; un'installazione fallita non lascia l'utente senza Filo e non si
// ritenta all'infinito. Logica pura: niente Electron, disco o rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = require(join(ROOT, 'src', 'main', 'aggiornamentoRegole.js'));

const SCARICATO = { versione: '0.2.234', file: 'C:/cache/pending/Filo-Setup.exe', sha512: 'abc==' };
const pronto = (extra = {}) => ({ ...R.ricordaScaricato(null, SCARICATO), ...extra });
const avvio = (extra = {}) => R.decidiAllAvvio({
  piattaforma: 'win32', versioneInUso: '0.2.233', modo: 'avvio', pronto: pronto(), installatoreValido: true, ...extra,
});

test('le versioni si confrontano per numeri, non come testo', () => {
  assert.equal(R.confrontaVersioni('0.2.234', '0.2.233'), 1);
  assert.equal(R.confrontaVersioni('0.2.99', '0.2.100'), -1, '«99» viene dopo «100» solo come testo');
  assert.equal(R.confrontaVersioni('v1.0.0', '1.0.0'), 0);
  assert.equal(R.confrontaVersioni('0.3.0', '0.2.999'), 1);
  for (const storta of ['', null, undefined, 'abc', '1.2', '<b>1.2.3</b>']) {
    assert.equal(R.confrontaVersioni(storta, '0.2.233'), null, `«${storta}» passava per una versione`);
  }
});

test('su Windows alla chiusura normale non si installa niente, all\'apertura sì', () => {
  const p = R.piano('win32', 'avvio');
  assert.equal(p.allaChiusura, false, 'alla chiusura l\'installatore toglie Filo.exe senza che si veda');
  assert.equal(p.allAvvio, true);
  assert.equal(p.pulsante, 'installatore');
});

test('chi lo sceglie torna all\'installazione silenziosa alla chiusura, e allora all\'avvio non si installa', () => {
  const p = R.piano('win32', 'chiusura');
  assert.equal(p.allaChiusura, true);
  assert.equal(p.allAvvio, false);
  assert.equal(avvio({ modo: 'chiusura' }).azione, 'apri');
});

test('il ramo di piattaforma è scritto intero: Mac e Linux hanno chiusura, avvio e pulsante decisi', () => {
  for (const sis of ['darwin', 'linux']) {
    for (const modo of R.MODI) {
      const p = R.piano(sis, modo);
      assert.equal(typeof p.allaChiusura, 'boolean');
      assert.equal(p.allAvvio, false, `su ${sis} all'avvio non si lancia nessun installatore`);
      assert.equal(R.decidiAllAvvio({ piattaforma: sis, versioneInUso: '0.2.233', modo, pronto: pronto() }).azione, 'apri');
    }
  }
  assert.equal(R.haPulsante('darwin'), false, 'su Mac l\'installazione oggi non riesce: il pulsante mentirebbe');
  assert.equal(R.haPulsante('linux'), false, 'un AppImage che non si può riscrivere non si aggiorna');
  assert.equal(R.haPulsante('linux', { appImageScrivibile: true }), true);
  assert.equal(R.haPulsante('win32'), true);
  assert.equal(R.haPulsante('freebsd'), false);
});

test('il modo si legge dalle impostazioni, e un valore storto vale quello predefinito', () => {
  assert.equal(R.modoScelto({}), 'avvio');
  assert.equal(R.modoScelto(null), 'avvio');
  assert.equal(R.modoScelto({ aggiornamenti: { installa: 'chiusura' } }), 'chiusura');
  assert.equal(R.modoScelto({ aggiornamenti: { installa: '<script>' } }), 'avvio');
});

test('all\'apertura una versione pronta più nuova di quella in uso si installa, e il tentativo si conta', () => {
  const d = avvio();
  assert.equal(d.azione, 'installa');
  assert.equal(d.pronto.tentativi, 1, 'senza il conto un\'installazione che fallisce si ripeterebbe a ogni avvio');
  assert.equal(d.avvisa, false);
});

test('con «Installa gli aggiornamenti da solo» spento all\'apertura si installa solo la versione chiesta con «Installa»', () => {
  const d = avvio({ automatici: false });
  assert.equal(d.azione, 'apri', 'spento, la versione scaricata si è installata senza che l\'utente la chiedesse');
  assert.equal(d.pronto.versione, '0.2.234', 'il ricordo va tenuto: «Installa» la ritrova');
  assert.equal(avvio({ automatici: false, chiesta: '0.2.233' }).azione, 'apri');
  assert.equal(avvio({ automatici: false, chiesta: '0.2.234' }).azione, 'installa');
  const testo = R.fraseScaricato({ versione: '0.2.234', piattaforma: 'win32', modo: 'avvio', pronto: pronto(), daSolo: false });
  assert.doesNotMatch(testo, /prossima volta|quando chiudi/, 'promette un\'installazione da sola che non avverrà');
});

test('senza un installatore valido Filo si apre normalmente e dimentica la versione', () => {
  const d = avvio({ installatoreValido: false });
  assert.equal(d.azione, 'apri');
  assert.equal(d.pronto, null);
});

test('una versione già installata, o più vecchia, non fa partire niente e si dimentica', () => {
  assert.deepEqual(avvio({ versioneInUso: '0.2.234' }), { azione: 'apri', pronto: null, avvisa: false });
  assert.deepEqual(avvio({ versioneInUso: '0.2.240' }), { azione: 'apri', pronto: null, avvisa: false });
  assert.equal(avvio({ pronto: null }).azione, 'apri');
  assert.equal(avvio({ pronto: { versione: 'storta', file: 'x', sha512: 'y' } }).pronto, null);
  assert.equal(avvio({ versioneInUso: 'sviluppo' }).azione, 'apri', 'una versione illeggibile non lancia installatori');
});

test('un\'installazione fallita: Filo si apre normalmente, ritenta una volta sola, al secondo fallimento avvisa', () => {
  // 1º avvio: si installa. L'installatore fallisce: si riparte con la versione vecchia.
  let d = avvio();
  assert.equal(d.azione, 'installa');
  // 2º avvio: il fallimento si constata e Filo si apre, mai due installatori di fila.
  d = avvio({ pronto: d.pronto });
  assert.equal(d.azione, 'apri', 'dopo un fallimento l\'utente resterebbe senza Filo');
  assert.equal(d.avvisa, false, 'il primo fallimento non è ancora un avviso');
  // 3º avvio: secondo tentativo, visibile come il primo.
  d = avvio({ pronto: d.pronto });
  assert.equal(d.azione, 'installa');
  assert.equal(d.pronto.tentativi, 2);
  // 4º avvio: fallito di nuovo → si apre e l'utente lo legge fra le notifiche.
  d = avvio({ pronto: d.pronto });
  assert.equal(d.azione, 'apri');
  assert.equal(d.avvisa, true, 'al secondo fallimento l\'utente deve saperlo');
  // Da qui in poi niente più tentativi da soli, e niente avvisi ripetuti.
  for (let i = 0; i < 5; i++) {
    d = avvio({ pronto: d.pronto });
    assert.equal(d.azione, 'apri', 'si ritentava in silenzio a ogni avvio');
    assert.equal(d.avvisa, false);
  }
  assert.equal(d.pronto.versione, '0.2.234', 'la versione pronta resta, per il pulsante');
});

test('il pulsante conta come un tentativo: se fallisce, all\'apertura dopo lo si constata', () => {
  let p = R.contaTentativo(pronto());
  let d = avvio({ pronto: p });
  assert.equal(d.azione, 'apri');
  p = R.contaTentativo(d.pronto);
  d = avvio({ pronto: p });
  assert.equal(d.avvisa, true);
  assert.equal(R.contaTentativo(null), null);
});

test('la stessa versione riscaricata tiene il conto; una versione nuova riparte da zero', () => {
  const vecchio = { ...pronto(), tentativi: 2, falliti: 2 };
  const stessa = R.ricordaScaricato(vecchio, { ...SCARICATO, file: 'C:/altra/Filo-Setup.exe' });
  assert.equal(stessa.tentativi, 2, 'riscaricare la stessa versione azzerava i fallimenti: tentativi all\'infinito');
  assert.equal(stessa.file, 'C:/altra/Filo-Setup.exe');
  const nuova = R.ricordaScaricato(vecchio, { ...SCARICATO, versione: '0.2.235', sha512: 'def==' });
  assert.equal(nuova.tentativi, 0);
  assert.equal(nuova.falliti, 0);
  assert.equal(R.ricordaScaricato(vecchio, { versione: '0.2.235' }).versione, '0.2.234', 'un evento incompleto cancellava il ricordo');
  assert.equal(R.ricordaScaricato(null, { ...SCARICATO, amministratore: true }).amministratore, true);
});

test('un ricordo manomesso non produce conti assurdi', () => {
  const d = avvio({ pronto: { ...SCARICATO, tentativi: -4, falliti: 'tanti' } });
  assert.equal(d.azione, 'installa');
  assert.equal(d.pronto.tentativi, 1);
  const tanti = avvio({ pronto: { ...SCARICATO, tentativi: 1e9, falliti: 1e9 } });
  assert.equal(tanti.azione, 'apri');
});

test('l\'avviso discreto dice quando si installa, e non promette quello che non succede', () => {
  const win = R.fraseScaricato({ versione: '0.2.234', piattaforma: 'win32', modo: 'avvio', pronto: pronto() });
  assert.match(win, /0\.2\.234/);
  assert.match(win, /prossima volta che apri/);
  assert.match(R.fraseScaricato({ versione: '0.2.234', piattaforma: 'win32', modo: 'chiusura' }), /quando chiudi/);
  const esauriti = R.fraseScaricato({ versione: '0.2.234', piattaforma: 'win32', modo: 'avvio', pronto: { ...pronto(), tentativi: 2, falliti: 2 } });
  assert.doesNotMatch(esauriti, /prossima volta/, 'prometteva un\'installazione all\'avvio che non partirà più');
  assert.equal(R.fraseScaricato({ versione: '0.2.234', piattaforma: 'darwin' }), null, 'su Mac resta l\'avviso che c\'è già');
  assert.equal(R.fraseScaricato({ versione: '0.2.234', piattaforma: 'linux' }), null);
  assert.match(R.fraseScaricato({ versione: '0.2.234', piattaforma: 'linux', appImageScrivibile: true }), /quando chiudi/);
  assert.equal(R.fraseScaricato({ versione: '<img src=x>', piattaforma: 'win32' }), null);
});

test('la scelta apertura/chiusura vale solo dove cambia qualcosa: altrove si dice perché', () => {
  assert.equal(R.sceltaNonVale('win32'), null);
  assert.match(R.sceltaNonVale('linux'), /solo su Windows: su Linux .*si installa quando lo chiudi/);
  assert.match(R.sceltaNonVale('darwin'), /solo su Windows: su Mac .*non si installa da sola/);
  assert.match(R.sceltaNonVale('freebsd'), /solo su Windows: qui/);
});
