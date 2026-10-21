// Unit test per la REIMPORTAZIONE dell'archivio dati (#234).
//
// "Esporta dati (.zip)" prometteva un backup e il trasferimento su un altro
// computer, ma senza un import quella promessa non era realizzabile. Qui
// verifichiamo il SUCCESSO del ripristino, non l'assenza di errore:
//   - il round-trip export→import restituisce gli stessi dati, immagini
//     comprese (i data-URL tornano data-URL, non percorsi "images/…");
//   - la fusione con i dati già presenti non cancella nulla di ciò che c'è;
//   - un file che non è un export di Filo viene RIFIUTATO con un codice
//     riconoscibile (non importato a metà).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  buildExportZip, readExportZip, mergeImportedData, unzip, zipStore,
} = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'exportData.js'));

// 1x1 PNG rosso
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const RED_PNG_URL = `data:image/png;base64,${RED_PNG_B64}`;

test('round-trip: quello che esporti è esattamente quello che reimporti', () => {
  const original = {
    settings: { theme: 'dark', apiKeys: { openrouter: 'sk-xyz' }, textScale: 1.2 },
    filo_memory: { PROFILO: 'Mario', PREFERENZE: 'caffè' },
    clipboardHistory: [
      { id: 'c1', type: 'text', text: 'ciao' },
      { id: 'c2', type: 'image', description: 'logo', dataUrl: RED_PNG_URL },
    ],
  };

  // Con le chiavi chieste da chi esporta (#905): senza, escono dall'archivio (esportaSenzaChiavi.test.mjs).
  const zip = buildExportZip(original, { chiavi: true });
  const back = readExportZip(zip);

  // I dati tornano identici: nessuna perdita, nessun percorso lasciato lì.
  assert.deepEqual(back.data, original);
  assert.equal(back.data.clipboardHistory[1].dataUrl, RED_PNG_URL);
  assert.equal(back.imageCount, 1);
  assert.equal(back.sectionCount, 3);
  assert.ok(back.exportedAt, 'il manifest deve dire quando è stato esportato');
});

test('round-trip: immagini multiple di formati diversi tornano tutte al posto giusto', () => {
  const jpeg = `data:image/jpeg;base64,${Buffer.from('finta-jpeg').toString('base64')}`;
  const original = {
    savedPages: [
      { id: 'p1', thumbnail: RED_PNG_URL },
      { id: 'p2', thumbnail: jpeg },
    ],
    nested: { deep: { list: [{ img: RED_PNG_URL }] } },
  };
  const back = readExportZip(buildExportZip(original));
  assert.deepEqual(back.data, original);
  assert.equal(back.imageCount, 3);
});

test('lo zip esportato si legge anche se ri-compresso con DEFLATE dentro una cartella', () => {
  // L'utente può scompattare l'archivio, guardarci dentro e ri-comprimerlo con
  // un qualsiasi gestore di archivi: il risultato ha metodo DEFLATE e i file
  // dentro una cartella. Deve funzionare lo stesso.
  const original = { filo_memory: { PROFILO: 'Anna' }, clip: [{ d: RED_PNG_URL }] };
  const entries = [...unzip(buildExportZip(original)).voci.entries()];

  // Ricostruiamo uno zip DEFLATE con prefisso di cartella, a mano.
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from('filo-export-2026-06-22/' + name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crcBuf = zipStore([{ name: 'x', buffer: data }]).readUInt32LE(14);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);          // DEFLATE
    local.writeUInt32LE(crcBuf, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crcBuf, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  const rezipped = Buffer.concat([...chunks, centralBuf, end]);

  const back = readExportZip(rezipped);
  assert.deepEqual(back.data, original);
  assert.equal(back.imageCount, 1);
});

test('un file che non è un archivio di Filo viene rifiutato, non importato a metà', () => {
  assert.throws(() => readExportZip(Buffer.from('non sono uno zip')), /not_a_zip/);
  // Zip valido ma senza data.json (es. una cartella di foto qualsiasi).
  const foreign = zipStore([{ name: 'foto.png', buffer: Buffer.from(RED_PNG_B64, 'base64') }]);
  assert.throws(() => readExportZip(foreign), /no_data_json/);
  // data.json illeggibile.
  const broken = zipStore([{ name: 'data.json', buffer: Buffer.from('{ rotto', 'utf8') }]);
  assert.throws(() => readExportZip(broken), /bad_data_json/);
});

test('la fusione aggiunge le sezioni mancanti senza toccare le altre', () => {
  const current = { filo_memory: { PROFILO: 'Mario' } };
  const imported = { savedPages: [{ id: 'p1' }], costs: { total: 3 } };
  const { merged, stats } = mergeImportedData(current, imported);

  assert.deepEqual(merged.filo_memory, { PROFILO: 'Mario' }, 'i dati locali restano');
  assert.deepEqual(merged.savedPages, [{ id: 'p1' }]);
  assert.deepEqual(merged.costs, { total: 3 });
  assert.equal(stats.added, 2);
  assert.equal(stats.updated, 0);
});

test('la fusione UNISCE le liste senza duplicati e senza perdere quelle locali', () => {
  const current = { savedPages: [{ id: 'a', t: 'locale' }, { id: 'b', t: 'anche locale' }] };
  const imported = { savedPages: [{ id: 'b', t: 'anche locale' }, { id: 'c', t: 'dal backup' }] };
  const { merged } = mergeImportedData(current, imported);

  assert.equal(merged.savedPages.length, 3, 'b non deve comparire due volte');
  assert.deepEqual(merged.savedPages.map((x) => x.id), ['a', 'b', 'c']);
});

test('la fusione dedup anche le voci senza id, per contenuto', () => {
  const current = { clipboardHistory: [{ type: 'text', text: 'ciao' }] };
  const imported = {
    clipboardHistory: [{ type: 'text', text: 'ciao' }, { type: 'text', text: 'nuovo' }],
  };
  const { merged } = mergeImportedData(current, imported);
  assert.equal(merged.clipboardHistory.length, 2);
});

test('cronologia appunti: la stessa cosa copiata in due momenti torna una voce sola', () => {
  const current = { clipboardHistory: [{ type: 'text', text: 'password-segreta', ts: 200 }] };
  const imported = {
    clipboardHistory: [
      { type: 'text', text: 'password-segreta ', ts: 100 },
      { type: 'text', text: 'nota', ts: 90 },
    ],
  };
  const { merged } = mergeImportedData(current, imported);
  assert.deepEqual(merged.clipboardHistory.map((x) => x.text), ['password-segreta', 'nota']);
  assert.equal(merged.clipboardHistory[0].ts, 200, 'resta la voce locale');
});

test('sui valori in conflitto vince il backup, ma le chiavi solo-locali restano', () => {
  const current = { settings: { theme: 'light', textScale: 1.4, soloLocale: true } };
  const imported = { settings: { theme: 'dark', apiKeys: { openrouter: 'sk-1' } } };
  const { merged, stats } = mergeImportedData(current, imported);

  assert.equal(merged.settings.theme, 'dark', 'il ripristino deve riportare il tema del backup');
  assert.deepEqual(merged.settings.apiKeys, { openrouter: 'sk-1' });
  assert.equal(merged.settings.textScale, 1.4, 'ciò che il backup non conosce non si perde');
  assert.equal(merged.settings.soloLocale, true);
  assert.equal(stats.updated, 1);
});

test('reimportare due volte lo stesso backup non duplica nulla (idempotente)', () => {
  const backup = {
    savedPages: [{ id: 'p1' }, { id: 'p2' }],
    clipboardHistory: [{ type: 'text', text: 'x' }],
    settings: { theme: 'dark' },
  };
  const once = mergeImportedData({}, backup).merged;
  const twice = mergeImportedData(once, backup).merged;
  assert.deepEqual(twice, once);
});

test('export → import su un profilo vuoto ricostruisce lo stato identico', () => {
  // Il caso "trasferisci i dati su un altro computer": là non c'è niente.
  const source = {
    settings: { theme: 'dark', apiKeys: { openrouter: 'sk-1' } },
    filo_memory: { PROFILO: 'Mario' },
    clipboardHistory: [{ id: 'c1', type: 'image', dataUrl: RED_PNG_URL }],
  };
  const { data } = readExportZip(buildExportZip(source, { chiavi: true }));
  const { merged } = mergeImportedData({}, data);
  assert.deepEqual(merged, source);
});

// #1088 — un archivio ricompresso o con byte rovinati non si importa con «fatto» lasciando «images/img-N.png»
// al posto delle foto: la voce che non si legge si dice, e il suo segnaposto diventa null.
test('una voce a metodo 12 (bzip2) non si legge: si dice, e al posto dell\'immagine resta null', async () => {
  const { conMetodo } = await import('../helpers/zipRovinato.mjs');
  const original = {
    clipboardHistory: [
      { id: 'c1', type: 'image', dataUrl: RED_PNG_URL },
      { id: 'c2', type: 'image', dataUrl: RED_PNG_URL },
    ],
    // Un testo dell'utente che per caso somiglia a un segnaposto resta testo.
    appunti: ['images/img-9.png', 'images/foto.png'],
  };
  const rovinato = conMetodo(buildExportZip(original), 'images/img-2.png', 12);

  const { saltate } = unzip(rovinato);
  assert.deepEqual(saltate, [{ nome: 'images/img-2.png', motivo: 'metodo 12' }]);

  const back = readExportZip(rovinato);
  assert.equal(back.imageCount, 1);
  assert.equal(back.immaginiPerse, 1);
  assert.equal(back.data.clipboardHistory[0].dataUrl, RED_PNG_URL);
  assert.equal(back.data.clipboardHistory[1].dataUrl, null, 'mai il percorso «images/…» al posto della foto');
  assert.deepEqual(back.data.appunti, ['images/img-9.png', 'images/foto.png']);
});

test('un byte cambiato dentro una voce STORE si scopre col CRC', async () => {
  const { conByteCambiato } = await import('../helpers/zipRovinato.mjs');
  const rovinato = conByteCambiato(buildExportZip({ clip: [{ d: RED_PNG_URL }] }), 'images/img-1.png');
  assert.deepEqual(unzip(rovinato).saltate, [{ nome: 'images/img-1.png', motivo: 'crc' }]);
  const back = readExportZip(rovinato);
  assert.equal(back.immaginiPerse, 1);
  assert.equal(back.data.clip[0].d, null);
});

test('data.json che non si legge è un archivio rovinato, non «non è di Filo»; il filo perso si dice', async () => {
  const { conMetodo, conByteCambiato } = await import('../helpers/zipRovinato.mjs');
  const zip = buildExportZip({ settings: { theme: 'dark' } }, { filo: '{"tipo":"chat"}\n' });
  assert.throws(() => readExportZip(conByteCambiato(zip, 'data.json')), /zip_damaged/);

  const senzaFilo = readExportZip(conByteCambiato(zip, 'filo/eventi.jsonl'));
  assert.equal(senzaFilo.filoPerso, true);
  assert.equal(senzaFilo.filo, null);
  assert.equal(readExportZip(zip).filoPerso, false);
});

test('un archivio sano ricompresso con bzip2, LZMA o una password non si chiama rovinato', async () => {
  const { tutteCon } = await import('../helpers/zipRovinato.mjs');
  const zip = buildExportZip({ settings: { theme: 'dark' } }, { filo: '{"tipo":"chat"}\n' });
  assert.throws(() => readExportZip(tutteCon(zip, { metodo: 12 })), /zip_method/);
  assert.throws(() => readExportZip(tutteCon(zip, { metodo: 14 })), /zip_method/);
  assert.throws(() => readExportZip(tutteCon(zip, { cifrata: true })), /zip_encrypted/);
});

test('con l\'indice in fondo rotto le voci che non si raggiungono si contano: niente salta in silenzio', async () => {
  const { conIndiceRotto } = await import('../helpers/zipRovinato.mjs');
  const zip = buildExportZip({ settings: { theme: 'dark' }, clip: [{ d: RED_PNG_URL }] }, { filo: '{"tipo":"chat"}\n' });

  // La riga rovinata si conta; quella dopo di lei si legge lo stesso (#1256).
  const filoRotto = conIndiceRotto(zip, 'filo/eventi.jsonl');
  assert.equal(unzip(filoRotto).mancanti, 1, 'solo il filo');
  const back = readExportZip(filoRotto);
  assert.equal(back.filo, null);
  assert.equal(back.filoPerso, true);
  assert.equal(back.vociPerse, 1);
  assert.equal(back.immaginiPerse, 0);
  assert.equal(back.data.clip[0].d, RED_PNG_URL, 'l\'immagine dopo la riga rovinata arriva');
  assert.equal(unzip(zip).mancanti, 0);

  assert.throws(() => readExportZip(conIndiceRotto(zip, 'data.json')), /zip_damaged/, 'rovinato, non «non è di Filo»');

  // Un archivio di prima, che nel manifesto non dichiara il filo: con voci sparite si dice che può mancare.
  const vecchio = zipStore([
    { name: 'data.json', buffer: Buffer.from(JSON.stringify({ settings: {} }), 'utf8') },
    { name: 'manifest.json', buffer: Buffer.from(JSON.stringify({ app: 'Filo', imageCount: 0 }), 'utf8') },
    { name: 'filo/eventi.jsonl', buffer: Buffer.from('{"tipo":"chat"}\n', 'utf8') },
  ]);
  assert.equal(readExportZip(conIndiceRotto(vecchio, 'filo/eventi.jsonl')).filoPerso, true);
  assert.equal(readExportZip(vecchio).filoPerso, false);

  // L'indice rotto proprio sul manifesto: le voci dopo si leggono, e l'immagine arriva.
  const senzaManifesto = readExportZip(conIndiceRotto(zip, 'manifest.json'));
  assert.equal(senzaManifesto.data.clip[0].d, RED_PNG_URL);
  assert.equal(senzaManifesto.immaginiPerse, 0);
  assert.equal(senzaManifesto.vociPerse, 1);
  // Rotta l'immagine, senza manifesto né numero affidabile: il segnaposto non resta testo.
  const soloDati = zipStore([{ name: 'data.json', buffer: Buffer.from(JSON.stringify({ clip: [{ d: 'images/img-1.png' }] }), 'utf8') },
    { name: 'images/img-1.png', buffer: Buffer.from(RED_PNG_B64, 'base64') }]);
  const senzaImmagine = readExportZip(conIndiceRotto(soloDati, 'images/img-1.png'));
  assert.equal(senzaImmagine.data.clip[0].d, null);
  assert.equal(senzaImmagine.immaginiPerse, 1);

  // Un solo campo dell'indice rovinato, con la voce intatta: l'indice e la voce non concordano, ed è un danno.
  const { conCampoDellIndice } = await import('../helpers/zipRovinato.mjs');
  for (const campo of ['nome', 'metodo', 'cifrata']) {
    assert.throws(() => readExportZip(conCampoDellIndice(zip, 'data.json', campo)), /zip_damaged/, `${campo} della voce dei dati`);
    const img = readExportZip(conCampoDellIndice(zip, 'images/img-1.png', campo));
    assert.equal(img.data.clip[0].d, null, `${campo} dell'immagine`);
    assert.equal(img.immaginiPerse, 1);
    assert.equal(readExportZip(conCampoDellIndice(zip, 'filo/eventi.jsonl', campo)).filoPerso, true, `${campo} del filo`);
  }

  // Senza filo nell'export, il manifesto lo dice e un indice rotto altrove non inventa chat perse.
  const senza = buildExportZip({ clip: [{ d: RED_PNG_URL }] });
  assert.equal(readExportZip(conIndiceRotto(senza, 'images/img-1.png')).filoPerso, false);
});

// #1256 — l'indice si legge per tutta la lunghezza che dichiara: un numero di voci rovinato non fa sparire immagini
// e chat, e una firma rovinata del record finale non fa di un archivio intatto «non è di Filo».
test('record finale rovinato: col numero di voci sbagliato o senza firma arrivano lo stesso immagini e chat', async () => {
  const { conRecordFinale } = await import('../helpers/zipRovinato.mjs');
  const backup = { savedPages: [{ id: 'p1', thumb: RED_PNG_URL }, { id: 'p2', thumb: RED_PNG_URL }] };
  const zip = buildExportZip(backup, { filo: '{"tipo":"chat"}\n' });
  assert.equal(unzip(zip).voci.size, 5, 'dati, manifesto, filo e due anteprime');

  for (const [campo, valore] of [['numero', 1], ['numero', 0], ['numero', 9], ['firma'], ['dimensione', 60], ['dimensione', 1], ['inizio', 7]]) {
    const back = readExportZip(conRecordFinale(zip, campo, valore));
    const caso = `${campo} ${valore ?? ''}`;
    assert.deepEqual(back.data, backup, `${caso}: le anteprime tornano immagini, non «images/img-1.png»`);
    assert.equal(back.imageCount, 2, caso);
    assert.ok(back.filo && back.filo.length, `${caso}: le chat arrivano`);
    assert.equal(back.filoPerso, false, caso);
    assert.equal(back.vociPerse, 0, `${caso}: niente di perso da dire`);
  }
});

test('record finale rovinato e una riga dell\'indice rotta: quello che non si raggiunge si conta', async () => {
  const { conRecordFinale, conIndiceRotto } = await import('../helpers/zipRovinato.mjs');
  const zip = buildExportZip({ clip: [{ d: RED_PNG_URL }, { d: RED_PNG_URL }] }, { filo: '{"tipo":"chat"}\n' });
  const rotto = conRecordFinale(conIndiceRotto(zip, 'images/img-1.png'), 'numero', 1);
  const back = readExportZip(rotto);
  assert.equal(back.vociPerse, 1);
  assert.equal(back.immaginiPerse, 1);
  assert.deepEqual(back.data.clip.map((c) => c.d), [null, RED_PNG_URL]);
  assert.ok(back.filo);

  // Senza record finale né indice che torni non è un archivio.
  assert.throws(() => readExportZip(Buffer.from('non è uno zip, è solo un testo lungo abbastanza per provarci')), /not_a_zip/);
});

test('fra l\'indice e il record finale altri record (zip64 di un gestore di archivi): niente si dice perso', () => {
  const zip = buildExportZip({ clip: [{ d: RED_PNG_URL }] }, { filo: '{"tipo":"chat"}\n' });
  const fine = zip.length - 22;
  const zip64 = Buffer.alloc(76);
  zip64.writeUInt32LE(0x06064b50, 0);
  zip64.writeUInt32LE(0x07064b50, 56);
  const back = readExportZip(Buffer.concat([zip.slice(0, fine), zip64, zip.slice(fine)]));
  assert.equal(back.vociPerse, 0);
  assert.equal(back.data.clip[0].d, RED_PNG_URL);
  assert.ok(back.filo);
});
