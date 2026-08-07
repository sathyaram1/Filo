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

  const zip = buildExportZip(original);
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
  const entries = [...unzip(buildExportZip(original)).entries()];

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
  const { data } = readExportZip(buildExportZip(source));
  const { merged } = mergeImportedData({}, data);
  assert.deepEqual(merged, source);
});
