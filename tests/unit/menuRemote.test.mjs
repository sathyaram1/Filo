// Unit test per src/content/menuRemote.js — #445.
//
// Il menu di un riquadro incorporato può essere disegnato dalla PAGINA che lo
// ospita. Fra i due frame passa una DESCRIZIONE del menu, e questa descrizione
// è il punto in cui si decide cosa può attraversare quel confine. Qui si
// verifica proprio quello: che sia solo testo e riferimenti, che le funzioni
// restino dalla parte del riquadro, e che un'icona inventata da fuori non
// diventi markup dentro la pagina.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const SRC = join(__dirname, '..', '..', 'src');
require(join(SRC, 'shared', 'messages.js'));
require(join(SRC, 'shared', 'icons.js'));
require(join(SRC, 'content', 'menuRemote.js'));

const Remote = globalThis.SN_MENU_REMOTE;

function newReg() {
  return { handlers: new Map(), inline: new Map(), correction: new Map() };
}

test('il modulo si registra con la sua API', () => {
  assert.ok(Remote);
  assert.equal(typeof Remote.project, 'function');
  assert.equal(typeof Remote.canProject, 'function');
});

test('la descrizione del menu è dati: nessuna funzione la attraversa', () => {
  const reg = newReg();
  const spec = Remote._serialize([
    { type: 'row', navState: { canBack: true, canFwd: false } },
    { type: 'separator' },
    { type: 'item', label: 'Copia', shortcut: 'Ctrl+C', onClick: () => {} },
  ], reg);
  // Un giro completo per JSON: se ci fosse una funzione, sparirebbe in silenzio.
  assert.deepEqual(JSON.parse(JSON.stringify(spec)), spec);
  assert.equal(spec[2].label, 'Copia');
  assert.equal(typeof spec[2].click, 'string');
});

test('la funzione da eseguire resta nel riquadro: di là va solo il suo riferimento', () => {
  const reg = newReg();
  let eseguita = 0;
  const spec = Remote._serialize([{ type: 'item', label: 'Copia', onClick: () => { eseguita++; } }], reg);
  assert.equal(eseguita, 0);
  reg.handlers.get(spec[0].click)();
  assert.equal(eseguita, 1);
});

test('la riga di icone non viaggia: la pagina se la ricostruisce da sé', () => {
  const reg = newReg();
  const spec = Remote._serialize([
    { type: 'row', navState: { canBack: false, canFwd: true }, items: [{ id: 'share', onClick: () => {} }] },
  ], reg);
  assert.equal(spec[0].t, 'row');
  assert.equal(spec[0].items, undefined);
  assert.deepEqual(spec[0].navState, { canBack: false, canFwd: true });
});

test('la cronologia incolla viaggia ridotta ai campi che il menu mostra', () => {
  const reg = newReg();
  const spec = Remote._serialize([{
    type: 'paste',
    label: 'Incolla',
    history: [{ type: 'text', text: 'ciao', ts: 123, segreto: 'non deve passare' }],
    onPickHistory: () => {},
  }], reg);
  assert.deepEqual(spec[0].history, [{ type: 'text', text: 'ciao', description: '' }]);
});

test('la voce scelta nella cronologia torna indietro per posizione, sull\'appunto giusto', () => {
  const reg = newReg();
  const presi = [];
  const spec = Remote._serialize([{
    type: 'paste',
    label: 'Incolla',
    history: [{ type: 'text', text: 'primo' }, { type: 'text', text: 'secondo' }],
    onPickHistory: (e) => presi.push(e.text),
  }], reg);
  reg.handlers.get(spec[0].pick)(1);
  assert.deepEqual(presi, ['secondo']);
});

test('rimuovere un appunto tiene allineate le due liste (niente incolla sbagliato dopo)', () => {
  const reg = newReg();
  const presi = [];
  const rimossi = [];
  const history = [{ type: 'text', text: 'primo' }, { type: 'text', text: 'secondo' }];
  const spec = Remote._serialize([{
    type: 'paste', label: 'Incolla', history,
    onPickHistory: (e) => presi.push(e.text),
    onRemoveHistory: (e) => rimossi.push(e.text),
  }], reg);
  reg.handlers.get(spec[0].remove)(0);       // via il primo, da tutte e due le parti
  reg.handlers.get(spec[0].pick)(0);         // ora la posizione 0 è "secondo"
  assert.deepEqual(rimossi, ['primo']);
  assert.deepEqual(presi, ['secondo']);
});

test('un\'icona vera del registro di Filo passa; una inventata da fuori no', () => {
  const vera = globalThis.SN_ICONS.share(16);
  assert.equal(Remote._allowedIcon(vera), vera);
  assert.equal(Remote._allowedIcon('<svg onload="alert(1)"><path d="M0 0"/></svg>'), undefined);
  assert.equal(Remote._allowedIcon('<svg><script>x()</script></svg>'), undefined);
  // I glifi (le freccette del menu) sono testo, non markup: passano.
  assert.equal(Remote._allowedIcon('▸'), '▸');
});

test('le sezioni dinamiche mandano il loro stato, non contenuto già disegnato', () => {
  const reg = newReg();
  const spec = Remote._serialize([{
    type: 'inline', variant: 'explain', content: 'Cerco…', arrow: true,
    onArrow: () => {}, onMount: () => {},
  }], reg);
  assert.equal(spec[0].t, 'inline');
  assert.equal(spec[0].variant, 'explain');
  assert.equal(spec[0].content, 'Cerco…');
  assert.equal(typeof spec[0].path, 'string');
  // Il montaggio NON è partito durante la descrizione: la chiamata al modello
  // deve partire solo quando la pagina conferma di aver disegnato il menu.
  assert.equal(reg.inline.size, 1);
});

test('senza sapere dove si trova il riquadro non si delega niente alla pagina', () => {
  // La misura ("dove sono nella finestra") arriva dal main al click destro.
  // Finché non c'è, il menu resta dove è sempre stato: meglio stretto che in
  // un punto sbagliato della pagina.
  assert.equal(Remote.canProject(), false);
});
