// Le vie per cui una pagina fa nascere o raggiunge la finestra di un riquadro, e la regola sul riquadro in arrivo che
// non si tocca: un elenco solo per i due sorgenti che la pagina riceve (riquadri-vuoti.js, fingerprint-guard.js).
// Una via nuova si aggiunge qui e vale per entrambi; sentinella in tests/unit/fingerprintRiquadri.test.mjs.

const CON_NODI = ['Element', 'Document', 'DocumentFragment', 'CharacterData', 'DocumentType', 'ShadowRoot'];
// [costruttore, metodo, tipo]. 'nodi': i nodi negli argomenti entrano (o rientrano, e ricaricano) nel documento;
// 'gamma': lo stesso da un Range; 'sposta': moveBefore, che sposta tenendo il documento del riquadro.
// Un metodo che un prototipo non ha come suo si salta: lo eredita da uno già avvolto.
const VIE_NODI = [
  ['Node', 'appendChild', 'nodi'], ['Node', 'insertBefore', 'nodi'], ['Node', 'replaceChild', 'nodi'],
  ...CON_NODI.flatMap((c) => ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith',
    'insertAdjacentElement'].map((m) => [c, m, 'nodi']).concat([[c, 'moveBefore', 'sposta']])),
  ['Range', 'insertNode', 'gamma'], ['Range', 'surroundContents', 'gamma'],
];
// [costruttore, nome, argomento col testo HTML (-1: la riscrittura del documento, sempre), dove nascono i riquadri].
// innerHTML e outerHTML sono proprietà: si avvolge il setter. Dove: 'se' dentro chi la riceve, 'genitore' nel suo
// genitore, 'genitoreOSe' nel genitore se c'è (insertAdjacentHTML), altrimenti dentro.
const VIE_TESTO = [
  ...CON_NODI.filter((c) => c !== 'Document').flatMap((c) => [[c, 'innerHTML', 0, 'se'], [c, 'outerHTML', 0, 'genitore']]),
  ...CON_NODI.flatMap((c) => [[c, 'insertAdjacentHTML', 1, 'genitoreOSe'], [c, 'setHTMLUnsafe', 0, 'se'], [c, 'setHTML', 0, 'se']]),
  ['Document', 'write', -1, 'se'], ['Document', 'writeln', -1, 'se'], ['Document', 'open', -1, 'se'],
  ['Document', 'execCommand', 2, 'se'],
];
// Le vie della riscrittura da capo: toglie gli ascolti del documento e, se è quello della finestra, della finestra.
const RISCRIVONO = ['open', 'write', 'writeln'];
// Gli elementi che danno la finestra del riquadro, e i getter o metodi che la danno.
const CORNICI = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'];
const GETTER_FINESTRA = ['contentWindow', 'contentDocument'];
const CON_SVG = ['HTMLIFrameElement', 'HTMLObjectElement', 'HTMLEmbedElement'];

// Un riquadro che caricherà un documento della stessa origine del suo (srcdoc, o un indirizzo che vi si risolve):
// toccato prima del load quel documento eredita la finestra e non riceve il preload, quindi Filo lì dentro sparisce.
// Le copie native si prendono qui, prima della pagina. Un indirizzo che non si legge non porta da nessuna parte: il
// riquadro resta la finestra vuota della pagina, e si tocca.
function sorgenteInArrivo() {
  return `(function () {
    var R = Reflect.apply, gd = Object.getOwnPropertyDescriptor, nuovo = Reflect.construct;
    var nomeDi = gd(Element.prototype, 'localName').get, haAttr = Element.prototype.hasAttribute;
    var attr = Element.prototype.getAttribute, baseDi = gd(Node.prototype, 'baseURI').get;
    var docDi = gd(Node.prototype, 'ownerDocument').get, Indirizzo = URL, origineUrl = gd(URL.prototype, 'origin').get;
    var trim = String.prototype.trim, VUOTO = /^about:blank([?#]|$)/i;
    return function inArrivo(el) {
      try {
        var n = R(nomeDi, el, []);
        if (n === 'iframe' && R(haAttr, el, ['srcdoc'])) return true;
        var a = n === 'object' ? 'data' : 'src';
        if (!R(haAttr, el, [a])) return false;
        var v = R(trim, String(R(attr, el, [a])), []);
        if (!v || VUOTO.test(v)) return false;
        var d = R(docDi, el, []);
        return R(origineUrl, nuovo(Indirizzo, [v, R(baseDi, el, [])]), []) === d.location.origin;
      } catch (e) { return false; }
    };
  })()`;
}

module.exports = { VIE_NODI, VIE_TESTO, RISCRIVONO, CORNICI, GETTER_FINESTRA, CON_SVG, sorgenteInArrivo };
