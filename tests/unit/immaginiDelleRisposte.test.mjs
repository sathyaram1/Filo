// Le immagini della chat (#2272) le scarica e le copia il main: alla pagina arrivano solo copie locali, i file che non
// sono immagini restano fuori, una richiesta con un dato riservato non parte, e senza un modello che disegna si dice.
// Rete e modelli sono finti, il disco è vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const userData = cartellaTemporanea('filo-immagini-chat-');
process.env.FILO_USER_DATA = userData;
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userData }, nativeImage: null };
  return caricaOriginale.call(this, request, parent, isMain);
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'pavimento.js'));
require(join(ROOT, 'src', 'main', 'services', 'webSearch.js'));
const Chat = require(join(ROOT, 'src', 'main', 'services', 'immaginiChat.js'));
const Copie = require(join(ROOT, 'src', 'main', 'services', 'copieIcone.js'));

const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`pixel-${n}`)]);
const HTML = Buffer.from('<!doctype html><title>non è un\'immagine</title>');

function reteFinta(byUrl) {
  const chieste = [];
  Chat._dip.scarica = async (url) => {
    chieste.push(url);
    const b = byUrl[url];
    if (!b) return new Response('', { status: 404 });
    return new Response(b, { status: 200 });
  };
  return chieste;
}

test('le immagini trovate tornano come copie locali, nell\'ordine del motore, e quelle che non sono immagini restano fuori', async () => {
  Chat._dip.tavily = async () => [{ immagine: 'https://foto.example/a.jpg', titolo: 'Antilope al tramonto', sito: 'foto.example' }];
  Chat._dip.commons = async () => [
    { immagine: 'https://upload.wikimedia.org/b.png', titolo: 'Impala', sito: 'commons.wikimedia.org', pagina: 'https://commons.wikimedia.org/wiki/File:Impala.png', larghezza: 800, altezza: 600 },
    { immagine: 'https://upload.wikimedia.org/finta.png', titolo: 'Pagina', sito: 'commons.wikimedia.org' },
  ];
  const chieste = reteFinta({
    'https://foto.example/a.jpg': PNG(1),
    'https://upload.wikimedia.org/b.png': PNG(2),
    'https://upload.wikimedia.org/finta.png': HTML,
  });
  const r = await Chat.cerca('antilope', { tavilyKey: 'k' });
  assert.equal(r.ok, true);
  assert.equal(chieste.length, 3);
  assert.deepEqual(r.immagini.map((i) => i.titolo), ['Antilope al tramonto', 'Impala']);
  for (const i of r.immagini) {
    assert.match(i.src, /^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
    assert.ok(existsSync(join(Copie.cartella(), Copie.nomeDa(i.src))), 'la copia è sul disco');
    assert.match(i.id, /^i\d+$/);
  }
  assert.equal(r.immagini[1].pagina, 'https://commons.wikimedia.org/wiki/File:Impala.png');
  assert.notEqual(r.immagini[0].id, r.immagini[1].id);
});

test('senza chiave di ricerca resta Wikimedia Commons; senza risultati lo dice', async () => {
  let tavilyChiesto = false;
  Chat._dip.tavily = async () => { tavilyChiesto = true; return []; };
  Chat._dip.commons = async () => [];
  reteFinta({});
  const r = await Chat.cerca('qualcosa che non esiste', {});
  assert.equal(tavilyChiesto, false);
  assert.equal(r.ok, false);
  assert.equal(r.immagini.length, 0);
  assert.match(r.reason, /nessuna immagine/);
});

test('una ricerca con una password non parte', async () => {
  let partita = false;
  Chat._dip.commons = async () => { partita = true; return []; };
  const r = await Chat.cerca('foto di password: Sup3r$egreta!2024', {});
  assert.equal(partita, false);
  assert.equal(r.pavimento, true);
});

test('senza un modello che disegna non si chiama nessuno, e la risposta lo dice', async () => {
  let chiamato = false;
  const gate = { complete: async () => { chiamato = true; return {}; } };
  const r = await Chat.genera('un gatto astronauta', { settings: { models: {}, modelRegistry: {} }, gate });
  assert.equal(chiamato, false);
  assert.equal(r.ok, false);
  assert.equal(r.senzaModello, true);
});

test('un\'immagine creata torna come copia segnata «generata», e la chiamata chiede immagini al modello', async () => {
  const C = globalThis.SN_CONST;
  const visti = [];
  const gate = {
    complete: async (opts) => {
      visti.push(opts);
      return { text: 'Ecco', images: [`data:image/png;base64,${PNG(9).toString('base64')}`, 'data:text/html;base64,PGI+'], costEur: 0.03 };
    },
  };
  const settings = {
    models: { [C.ACTIONS.IMAGE_GEN]: 'pittore' },
    modelRegistry: { pittore: { provider: 'openrouter', model: 'prova/pittore', weights: 'open', outputs: ['image', 'text'] } },
    apiKeys: { openrouter: 'k' },
  };
  const r = await Chat.genera('un gatto astronauta', { settings, gate });
  assert.equal(r.ok, true);
  assert.deepEqual(visti[0].modalities, ['image', 'text']);
  assert.equal(visti[0].action, C.ACTIONS.IMAGE_GEN);
  assert.equal(r.immagini.length, 1, 'il pezzo che non è un\'immagine resta fuori');
  assert.equal(r.immagini[0].generata, true);
  assert.match(r.immagini[0].id, /^g\d+$/);
  assert.match(r.immagini[0].src, /^filo:\/\/icone\//);
});
