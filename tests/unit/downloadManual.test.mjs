// #436 — Gli scaricamenti "a mano" ("Salva immagine/video come…", che devono
// scaricare i byte da sé per presentare il Referer della pagina) si iscrivono
// allo STESSO registro dei download nativi. Logica pura: niente Electron, il
// broadcast verso le finestre fallisce da solo ed è già ingoiato.
//
// Le invarianti che contano per l'utente:
//  - il trasferimento compare in elenco appena parte, col peso dichiarato dal
//    server (⇒ la barra può mostrare una percentuale, non una rotella);
//  - l'avanzamento aggiorna i byte ricevuti;
//  - "Annulla" si vede subito e si può interrogare da chi muove i byte, così il
//    trasferimento si ferma davvero invece di continuare in sottofondo;
//  - la voce chiusa porta il percorso e il nome del file salvato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DL = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));

const find = (id) => DL.list().find((r) => r.id === id);

test('lo scaricamento a mano compare in elenco con peso e byte ricevuti', () => {
  const h = DL.beginManual({ url: 'https://esempio.test/filmato.mp4', filename: 'filmato.mp4', totalBytes: 5000 });
  try {
    const started = find(h.id);
    assert.ok(started, 'la voce non è comparsa in elenco');
    assert.equal(started.state, 'progressing');
    assert.equal(started.filename, 'filmato.mp4');
    assert.equal(started.totalBytes, 5000, 'senza il totale la barra resterebbe indeterminata');
    assert.equal(started.receivedBytes, 0);

    h.progress(2500, 5000);
    assert.equal(find(h.id).receivedBytes, 2500);

    h.done('/tmp/scelto/altro-nome.mp4');
    const end = find(h.id);
    assert.equal(end.state, 'completed');
    assert.equal(end.savePath, '/tmp/scelto/altro-nome.mp4');
    assert.equal(end.filename, 'altro-nome.mp4', 'il nome deve seguire dove il file è stato davvero salvato');
    assert.equal(end.receivedBytes, 5000, 'una voce conclusa non può restare ferma a metà percentuale');
  } finally {
    DL.remove(h.id);
  }
});

test('non offre la pausa: la richiesta http non si può sospendere', () => {
  const h = DL.beginManual({ url: 'https://esempio.test/a.png', filename: 'a.png', totalBytes: 10 });
  try {
    assert.equal(find(h.id).canPause, false, 'un pulsante Pausa qui non farebbe niente');
  } finally {
    DL.remove(h.id);
  }
  // I download nativi invece la pausa ce l'hanno: la distinzione non deve
  // essere accidentale.
  assert.equal(DL._publicRecord({ id: 'x', state: 'progressing' }).canPause, true);
});

test('"Annulla" dalla barra si vede subito e ferma chi sta muovendo i byte', () => {
  const h = DL.beginManual({ url: 'https://esempio.test/lungo.mp4', filename: 'lungo.mp4', totalBytes: 9999 });
  try {
    assert.equal(h.cancelled(), false);
    DL.cancel(h.id);
    assert.equal(h.cancelled(), true, 'chi scarica non saprebbe di doversi fermare');
    assert.equal(find(h.id).state, 'cancelled');

    // Dopo l'annullamento nulla può più riportarla "in corso" o "completata":
    // altrimenti un trasferimento già chiuso riaprirebbe la sua voce.
    h.progress(5000, 9999);
    h.done('/tmp/lungo.mp4');
    const after = find(h.id);
    assert.equal(after.state, 'cancelled');
    assert.equal(after.savePath, '');
  } finally {
    DL.remove(h.id);
  }
});

test('un trasferimento caduto risulta interrotto, non completato', () => {
  const h = DL.beginManual({ url: 'https://esempio.test/rotto.mp4', filename: 'rotto.mp4', totalBytes: 100 });
  try {
    h.progress(40, 100);
    h.fail();
    assert.equal(find(h.id).state, 'interrupted');
  } finally {
    DL.remove(h.id);
  }
});

test('il nome che arriva dal server non può uscire dalla cartella scelta', () => {
  const h = DL.beginManual({ url: 'https://esempio.test/x', filename: '../../../../evaso.mp4' });
  try {
    const name = find(h.id).filename;
    assert.ok(!name.includes('/') && !name.includes('\\'), `separatori rimasti in "${name}"`);
  } finally {
    DL.remove(h.id);
  }
});

test('«Salva come…» dopo un rimando nomina anche chi ha servito il file (#588.3)', () => {
  require(join(ROOT, 'src', 'shared', 'eseguibili.js'));
  const h = DL.beginManual({ url: 'https://github.com/x/setup.exe', filename: 'setup.exe', servedFrom: 'https://objects.githubusercontent.com/r/setup.exe' });
  const g = DL.beginManual({ url: 'https://sito.test/a.exe', filename: 'a.exe', servedFrom: 'https://sito.test/a.exe' });
  try {
    assert.equal(find(h.id).site, 'github.com');
    assert.equal(find(h.id).servedBy, 'objects.githubusercontent.com');
    assert.equal(find(g.id).servedBy, '', 'senza rimando il nome è uno solo');
  } finally {
    DL.remove(h.id);
    DL.remove(g.id);
  }
});

// #1311 — «Salva immagine come» su un nome da programma passa dalla stessa domanda dei download da link.
const aspetta = () => new Promise((r) => setImmediate(r));

test('un programma salvato dal tasto destro aspetta il sì prima di proseguire, e il sì vale per la voce', async () => {
  require(join(ROOT, 'src', 'shared', 'eseguibili.js'));
  DL.configureFromSettings({});
  const h = DL.beginManual({ url: 'https://sito.test/foto', filename: 'setup.exe', servedFrom: 'https://sito.test/foto' });
  try {
    let esito = null;
    const p = h.permesso('setup.exe').then((v) => { esito = v; });
    assert.equal(find(h.id).state, 'pending');
    assert.equal(find(h.id).exe, true);
    assert.equal(find(h.id).site, 'sito.test');
    await aspetta();
    assert.equal(esito, null, 'senza risposta il file non deve proseguire');
    assert.equal(DL.confirmDownload(h.id, true).ok, true);
    await p;
    assert.equal(esito, true);
    assert.equal(find(h.id).state, 'progressing');
    assert.equal(await h.permesso('setup (2).exe'), true, 'cambiato il nome nel dialogo, il sì resta');
  } finally {
    DL.remove(h.id);
  }
});

test('«Non scaricare», togliere la voce o un trasferimento caduto dicono no a chi aspettava', async () => {
  require(join(ROOT, 'src', 'shared', 'eseguibili.js'));
  DL.configureFromSettings({});
  const no = DL.beginManual({ url: 'https://sito.test/a', filename: 'a.rdp' });
  const via = DL.beginManual({ url: 'https://sito.test/b', filename: 'b.exe' });
  const caduto = DL.beginManual({ url: 'https://sito.test/c', filename: 'c.msi' });
  try {
    const pNo = no.permesso('a.rdp');
    DL.confirmDownload(no.id, false);
    assert.equal(await pNo, false);
    assert.equal(find(no.id).state, 'cancelled');
    assert.equal(no.cancelled(), true, 'i byte devono fermarsi');

    const pVia = via.permesso('b.exe');
    DL.remove(via.id);
    assert.equal(await pVia, false);

    const pCaduto = caduto.permesso('c.msi');
    caduto.fail();
    assert.equal(await pCaduto, false);
    assert.equal(find(caduto.id).state, 'interrupted');
    assert.equal(await caduto.permesso('c.msi'), false, 'una voce chiusa non riapre la domanda');
  } finally {
    DL.remove(no.id);
    DL.remove(caduto.id);
  }
});

test('una foto non chiede; un nome da programma scelto nel dialogo sì; sito fidato e domanda spenta no', async () => {
  require(join(ROOT, 'src', 'shared', 'eseguibili.js'));
  DL.configureFromSettings({});
  const foto = DL.beginManual({ url: 'https://sito.test/gatto.png', filename: 'gatto.png' });
  const fidato = DL.beginManual({ url: 'https://dl.fidato.test/x', filename: 'setup.exe' });
  const spenta = DL.beginManual({ url: 'https://sito.test/y', filename: 'setup.exe' });
  try {
    assert.equal(await foto.permesso('gatto.png'), true);
    assert.equal(find(foto.id).state, 'progressing');
    let esito = null;
    const p = foto.permesso('gatto.exe').then((v) => { esito = v; });
    assert.equal(find(foto.id).state, 'pending');
    assert.equal(find(foto.id).filename, 'gatto.exe', 'la domanda nomina il file che arriverebbe');
    await aspetta();
    assert.equal(esito, null);
    DL.confirmDownload(foto.id, true);
    await p;
    assert.equal(esito, true);

    DL.configureFromSettings({ security: { downloads: { trustedSites: ['fidato.test'] } } });
    assert.equal(await fidato.permesso('setup.exe'), true);
    assert.equal(find(fidato.id).state, 'progressing');
    DL.configureFromSettings({ security: { downloads: { confirmExecutables: false } } });
    assert.equal(await spenta.permesso('setup.exe'), true);
  } finally {
    DL.configureFromSettings({});
    DL.remove(foto.id);
    DL.remove(fidato.id);
    DL.remove(spenta.id);
  }
});
