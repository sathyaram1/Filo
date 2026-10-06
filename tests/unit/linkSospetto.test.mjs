// Unit test per src/shared/linkSospetto.js — l'euristica sui link e, #725, le
// frasi con cui l'avviso arriva a chi legge: prima il menu mostrava il codice
// interno («⚠️ Link sospetto: typosquatting:paypal.com»).
// Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'linkSospetto.js'));
const LS = globalThis.SN_LINK_SOSPETTO;

test('si registra su globalThis con la sua API', () => {
  assert.ok(LS, 'SN_LINK_SOSPETTO assente');
  for (const fn of ['analizza', 'frasi', 'avviso']) {
    assert.equal(typeof LS[fn], 'function', `manca ${fn}()`);
  }
});

test('riconosce il dominio-imitazione, l’azione a effetto e il codice nell’indirizzo', () => {
  assert.deepEqual(LS.analizza('https://paypa1.com/login'), ['typosquatting:paypal.com']);
  assert.ok(LS.analizza('https://esempio.it/unsubscribe').includes('side_effect'));
  assert.ok(LS.analizza('https://esempio.it/a?token=9f2ba71c4de80a13').includes('token_in_url'));
  assert.deepEqual(LS.analizza('non-un-indirizzo'), ['url_invalido']);
  // Il dominio vero, e un suo sottodominio, non sono sospetti.
  assert.deepEqual(LS.analizza('https://www.paypal.com/it'), []);
  assert.deepEqual(LS.analizza('https://pagamenti.paypal.com/'), []);
});

test('l’avviso è una frase, non un codice interno', () => {
  const avviso = LS.avviso(LS.analizza('https://paypa1.com/'));
  // Il successo per chi legge: capisce cosa non va senza sapere cos'è il
  // typosquatting, e vede il dominio che il link sta imitando.
  assert.ok(avviso.includes('paypal.com'), `l’avviso non nomina il dominio imitato: ${avviso}`);
  assert.ok(/imitazione/i.test(avviso), `l’avviso non dice che può essere un’imitazione: ${avviso}`);
  assert.ok(!/typosquatting|side_effect|token_in_url|url_invalido|_/.test(avviso),
    `l’avviso mostra ancora un codice interno: ${avviso}`);
  assert.match(avviso, /^⚠️ [A-Z’L]/, `l’avviso non è una frase: ${avviso}`);
  assert.match(avviso, /\.$/, `l’avviso non finisce con un punto: ${avviso}`);
});

test('ogni codice prodotto dall’euristica ha la sua frase', () => {
  // Se domani nasce un codice nuovo e nessuno scrive la frase, l'utente si
  // ritroverebbe di nuovo un avviso monco: qui i due elenchi si incrociano.
  const src = readFileSync(join(ROOT, 'src', 'shared', 'linkSospetto.js'), 'utf8');
  const codici = [...src.matchAll(/flags\.push\('([a-z_]+)'(?:\s*\+|\))/g)].map((m) => m[1]);
  const ritornati = [...src.matchAll(/return \['([a-z_]+)'\]/g)].map((m) => m[1]);
  const tutti = [...new Set([...codici, ...ritornati])];
  assert.ok(tutti.length >= 3, `mi aspetto ≥3 codici, trovati ${tutti.length}`);
  for (const c of tutti) {
    const f = LS.frasi([c]);
    assert.equal(f.length, 1, `il codice "${c}" non ha una frase per l’utente`);
    assert.ok(f[0].length > 20 && /\.$/.test(f[0]), `la frase di "${c}" non è una frase: ${f[0]}`);
  }
  assert.equal(LS.frasi(['typosquatting:paypal.com']).length, 1);
});

test('più avvisi insieme restano leggibili, e i casi vuoti non mostrano niente', () => {
  const codici = LS.analizza('https://paypa1.com/unsubscribe?token=9f2ba71c4de80a13');
  assert.ok(codici.length >= 3, `mi aspetto tre avvisi insieme, trovati ${codici.join(', ')}`);
  const avviso = LS.avviso(codici);
  assert.equal(avviso.split('⚠️').length, 2, 'un solo simbolo di avviso, in testa');
  assert.equal(LS.frasi(codici).length, codici.length, 'ogni codice porta la sua frase');

  assert.equal(LS.avviso([]), '');
  assert.equal(LS.avviso(null), '');
  assert.equal(LS.avviso(['codice_che_non_esiste']), '');
  assert.equal(LS.avviso([null, 42, {}]), '');
  // Un doppione non si ripete due volte.
  assert.equal(LS.frasi(['side_effect', 'side_effect']).length, 1);
});

test('l’euristica vive in un posto solo: actions.js la chiede qui', () => {
  const actions = readFileSync(join(ROOT, 'src', 'content', 'actions.js'), 'utf8');
  assert.ok(!/function analyzeLinkSuspicious/.test(actions),
    'la copia dell’euristica è tornata in actions.js: due copie divergono in silenzio');
  assert.match(actions, /SN_LINK_SOSPETTO/, 'actions.js non usa più il modulo condiviso');
  // L'avviso lo mostra il menu prima di chiamare il modello: se un giorno
  // tornasse dentro il ramo dello streaming, un provider caduto lo farebbe
  // sparire e il link sospetto passerebbe in silenzio.
  const mount = actions.slice(actions.indexOf('function buildInlineExplainLink'));
  assert.ok(mount.indexOf('LinkSospetto.avviso') < mount.indexOf('port.onMessage'),
    'l’avviso sul link sospetto viene mostrato solo insieme alla risposta del modello');
});

test('un parametro che si chiama come una chiave ma non lo è non fa scattare l’avviso', () => {
  // #725 — il nome da solo accusava di portare una chiave d'accesso i link di
  // tutti i giorni: il segnatempo di un video, il contatore anti-cache. Il
  // successo per chi legge è non vedere niente di rosso su un link normale, così
  // che l'avviso conti ancora quando compare.
  const normali = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
    'https://youtu.be/dQw4w9WgXcQ?t=90',
    'https://esempio.it/articolo?t=1699999999999',
    'https://esempio.it/pagina?key=2',
    'https://esempio.it/lista?hash=1234567890123',
  ];
  for (const u of normali) {
    assert.ok(!LS.analizza(u).includes('token_in_url'), `avviso a sproposito su ${u}`);
    assert.ok(!/chiave/.test(LS.avviso(LS.analizza(u))), `l’avviso parla di chiavi su ${u}`);
  }
  // E il caso vero continua a scattare.
  for (const u of [
    'https://esempio.it/entra?sig=Ab3kZ9qX1p7LmN4r',
    'https://esempio.it/a?access_token=eyJhbGciOiJIUzI1NiJ9',
  ]) {
    assert.ok(LS.analizza(u).includes('token_in_url'), `nessun avviso su ${u}`);
  }
});

test('l’avviso non afferma più di quello che il controllo sa', () => {
  // Il controllo guarda l'indirizzo, non il sito: nessuna delle frasi può
  // dichiarare un fatto. Una che afferma trasforma ogni falso allarme in
  // un'accusa, e chi legge smette di crederci (#725).
  for (const c of ['side_effect', 'token_in_url', 'typosquatting:paypal.com']) {
    const f = LS.frasi([c])[0];
    assert.match(f, /potrebbe|può|sembra/i, `la frase di "${c}" afferma invece di ipotizzare: ${f}`);
  }
});

test('gli indirizzi di tutti i giorni non vengono accusati di imitarne un altro', () => {
  // #725 — il confronto correva su TUTTO l'indirizzo con due lettere di
  // tolleranza fisse: così gitlab.com «imitava» github.com, ogni indirizzo di
  // una o due lettere «imitava» x.com e amazon.de «imitava» amazon.it. Un
  // avviso rosso sui link di ogni giorno smette di essere letto proprio quando
  // servirebbe. Il successo per chi legge è non vedere niente su questi.
  const innocenti = [
    'https://gitlab.com/gitlab-org/gitlab',
    'https://t.co/AbCdEf1234',
    'https://g.co/kgs/abc',
    'https://a.co/d/abcdef',
    'https://fb.com/pagina',
    'https://vk.com/id1',
    'https://3m.com/',
    'https://ge.com/',
    'https://amazon.de/dp/B00ABCDEF',
    'https://google.co/search?q=filo',
    'https://utente.github.io/blog/',
  ];
  for (const u of innocenti) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('un titolo che si chiama come un’azione non è un pulsante', () => {
  // #725 — bastava la parola isolata nell'indirizzo: la voce di enciclopedia
  // «Delete» diventava «aprirlo può bastare a eseguire qualcosa».
  for (const u of ['https://it.wikipedia.org/wiki/Delete', 'https://esempio.it/blog/Cancel']) {
    assert.ok(!LS.analizza(u).includes('side_effect'), `avviso a sproposito su ${u}`);
  }
  // L'azione vera continua a scattare, nel percorso e nella parte dopo il «?».
  for (const u of [
    'https://esempio.it/newsletter/unsubscribe',
    'https://esempio.it/logout',
    'https://esempio.it/azione?do=Confirm',
  ]) {
    assert.ok(LS.analizza(u).includes('side_effect'), `nessun avviso su ${u}`);
  }
});

test('le imitazioni vere continuano a farsi riconoscere', () => {
  // Il contrappeso del test qui sopra: stringere la tolleranza non deve
  // spegnere il controllo. Comprese le scritture con una lettera che ne vale
  // un'altra, che prima passavano o passavano per un pelo.
  const sosia = {
    'https://paypa1.com/login': 'paypal.com',
    'https://gooogle.com/': 'google.com',
    'https://amazn.com/': 'amazon.com',
    'https://arnazon.com/': 'amazon.com',
    'https://micros0ft.com/': 'microsoft.com',
    'https://linkedln.com/in/tizio': 'linkedin.com',
    'https://facebok.com/': 'facebook.com',
  };
  for (const [u, atteso] of Object.entries(sosia)) {
    assert.deepEqual(LS.analizza(u), ['typosquatting:' + atteso], `nessun avviso su ${u}`);
  }
});

test('il nome vero c’è tutto, ma a comandare è un altro dominio', () => {
  // #725.2 — le forme delle mail di phishing: il nome del sito vero davanti a
  // un altro dominio, prima di una «@», o legato col trattino a un'altra parola.
  // Il successo per chi legge è vedere quale sito viene usato e dove porta.
  const casi = {
    'https://paypal.com.accesso-sicuro.net/login': ['paypal.com', 'accesso-sicuro.net'],
    'https://www.paypal.com.accesso-sicuro.net/': ['paypal.com', 'accesso-sicuro.net'],
    'https://paypal.com.verifica.co.uk/': ['paypal.com', 'verifica.co.uk'],
    'https://secure-paypal.com/': ['paypal.com', 'secure-paypal.com'],
    'https://paypal-com.net/': ['paypal.com', 'paypal-com.net'],
    'https://paypal.accesso-sicuro.net/': ['paypal.com', 'accesso-sicuro.net'],
    'https://www.paypal.com@accesso-sicuro.net/': ['paypal.com', 'accesso-sicuro.net'],
    'https://apple.com.id-verifica.net/': ['apple.com', 'id-verifica.net'],
    'https://login-microsoft.com/': ['microsoft.com', 'login-microsoft.com'],
  };
  for (const [u, [nome, dove]] of Object.entries(casi)) {
    const avviso = LS.avviso(LS.analizza(u));
    assert.ok(avviso.includes(nome) && avviso.includes(dove), `su ${u} l’avviso non nomina ${nome} e ${dove}: «${avviso}»`);
    assert.match(avviso, /potrebbe/, `su ${u} l’avviso afferma invece di ipotizzare: ${avviso}`);
  }
});

test('un nome scritto con lettere di un altro alfabeto si fa riconoscere', () => {
  // #725.2 — «раураl» in cirillico a schermo è «paypal»; nell'indirizzo viaggia
  // in punycode (xn--…), e così non somigliava a niente.
  const casi = {
    'https://раураl.com/': 'paypal.com',
    'https://xn--l-7sba6dbr.com/': 'paypal.com',
    'https://pаypal.com/signin': 'paypal.com',
    'https://аррӏе.com/': 'apple.com',
    'https://gооgle.com/': 'google.com',
    'https://ɡoogle.com/': 'google.com',
    'https://paypàl.com/': 'paypal.com',
  };
  for (const [u, atteso] of Object.entries(casi)) {
    assert.deepEqual(LS.analizza(u), ['omografo:' + atteso], `nessun avviso su ${u}`);
    const avviso = LS.avviso(LS.analizza(u));
    assert.ok(avviso.includes(atteso) && /lettere/.test(avviso), `l’avviso su ${u} non spiega il trucco: ${avviso}`);
  }
  // Un nome che mescola gli alfabeti senza imitare un sito noto resta sospetto.
  assert.deepEqual(LS.analizza('https://exаmple.com/'), ['alfabeto_ingannevole']);
  // E così un nome fatto solo di lettere che sembrano latine, sotto un dominio latino.
  assert.deepEqual(LS.analizza('https://сосо.com/'), ['alfabeto_ingannevole']);
  assert.ok(LS.frasi(['alfabeto_ingannevole'])[0].includes('alfabeto'));
});

test('i nomi scritti per intero in un’altra lingua, e i siti che usano un nome famoso di diritto, restano muti', () => {
  // Il contrappeso: stringere le maglie non deve far gridare al lupo su un
  // dominio russo, greco o tedesco, né sui siti che un nome famoso lo portano
  // davvero (i loro sottodomini, i domini ufficiali col trattino).
  const innocenti = [
    'https://пример.рф/', 'https://яндекс.рф/', 'https://münchen.de/', 'https://ελληνικά.gr/',
    'https://日本語.jp/', 'https://😀.com/', 'https://рост.рф/', 'https://сок.ru/', 'https://кот.bg/',
    'https://facebook.github.io/react/', 'https://microsoft.github.io/vscode/',
    'https://apple.stackexchange.com/questions/1', 'https://pineapple.com/',
    'https://appleinsider.com/', 'https://x-plane.com/', 'https://googleblog.com/', 'https://amazonaws.com/',
    'https://www.youtube-nocookie.com/embed/abc',
    'https://login.microsoftonline.com/', 'https://aws.amazon.com/', 'https://www.amazon.co.uk/',
    'https://paypal.com.co/', 'https://utente:segreto@esempio.it/',
  ];
  for (const u of innocenti) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('ogni forma di imitazione ha la sua frase', () => {
  for (const c of ['omografo:paypal.com', 'nome_altrui:paypal.com|accesso-sicuro.net', 'alfabeto_ingannevole']) {
    const f = LS.frasi([c]);
    assert.equal(f.length, 1, `il codice "${c}" non ha una frase`);
    assert.ok(!/omografo|nome_altrui|alfabeto_ingannevole|\|/.test(f[0]), `la frase mostra un codice interno: ${f[0]}`);
    assert.match(f[0], /potrebbe/, `la frase di "${c}" afferma invece di ipotizzare: ${f[0]}`);
  }
  // Un codice monco non diventa una frase a metà.
  assert.deepEqual(LS.frasi(['nome_altrui:paypal.com', 'omografo:']), []);
});

test('la decodifica del punycode dà il nome che si legge a schermo', async () => {
  const { domainToASCII } = await import('node:url');
  for (const nome of ['раураl', 'münchen', 'пример', 'ελληνικά', 'bücher', 'аррӏе']) {
    const u = 'https://' + domainToASCII(nome + '.com') + '/';
    // Il nome decodificato è quello che il controllo vede: una delle lettere
    // cirilliche lo fa sospettare, una tedesca no.
    const attesoSospetto = ['раураl', 'аррӏе'].includes(nome);
    assert.equal(LS.analizza(u).length > 0, attesoSospetto, `decodifica sbagliata per ${nome} (${u})`);
  }
  // Un'etichetta punycode rotta non fa esplodere niente.
  for (const u of ['https://xn--zz-zzz.com/', 'https://xn--.com/', 'https://xn--99999999999.com/']) {
    assert.ok(Array.isArray(LS.analizza(u)));
  }
});

test('gli indirizzi che le aziende usano davvero non si prendono l’avviso, i loro inquilini sì', () => {
  // #725.2 — il nome da solo in un pezzo dell'indirizzo accusava la comunità di
  // PayPal, le immagini di Amazon e lo SharePoint di Microsoft: chi è il sito lo
  // dice l'elenco del controllo di navigazione, uno solo per i due controlli.
  for (const u of [
    'https://www.paypal-community.com/t5/Italia/ct-p/it',
    'https://m.media-amazon.com/images/I/81abc.jpg',
    'https://images-na.ssl-images-amazon.com/images/x.jpg',
    'https://microsoft.sharepoint.com/sites/news',
    'https://instagram.fmxp6-1.fna.fbcdn.net/v/t51.2885-15/x.jpg',
    'https://youtube.fandom.com/wiki/YouTube',
    'https://paypal.wikipedia.org/',
    'https://www.youtube-nocookie.com/embed/x',
    'https://c.amazon-adsystem.com/x.js',
  ]) {
    assert.deepEqual(LS.analizza(u), [], `falso allarme su ${u}`);
  }
  // Sulle piattaforme dove ognuno si prende il suo sottodominio il nome resta
  // di chi l'ha scritto, non dell'azienda.
  for (const u of [
    'https://paypal.sharepoint.com/',
    'https://paypal.com.s3.amazonaws.com/x',
    'https://paypal.com.vercel.app/',
    'https://paypal.wordpress.com/',
    'https://paypal.com@wikipedia.evil.net/',
  ]) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:paypal.com')), `nessun avviso su ${u}`);
  }
});

test('sui servizi dove ognuno apre il suo sito, il sito è di chi l’ha aperto', () => {
  // #725.2 — il menu divideva l'indirizzo con una regola sua e credeva che in
  // paypal-login.vercel.app comandasse Vercel: dove finisce il sito lo dice
  // l'elenco dei suffissi del controllo di navigazione.
  for (const [u, dove] of [
    ['https://paypal-login.vercel.app/', 'paypal-login.vercel.app'],
    ['https://secure-paypal.web.app/', 'secure-paypal.web.app'],
    ['https://paypal-secure.netlify.app/', 'paypal-secure.netlify.app'],
    ['https://paypal-login.github.io/', 'paypal-login.github.io'],
    ['https://netflix-account.herokuapp.com/', 'netflix-account.herokuapp.com'],
    ['http://paypal.com@192.168.1.1/login', '192.168.1.1'],
  ]) {
    const codici = LS.analizza(u);
    assert.ok(codici.some((c) => c.startsWith('nome_altrui:') && c.endsWith('|' + dove)), `su ${u}: ${codici}`);
    assert.ok(LS.avviso(codici).includes(dove), `l’avviso su ${u} non dice dove porta: ${LS.avviso(codici)}`);
  }
  assert.deepEqual(LS.analizza('https://paypa1.vercel.app/'), ['typosquatting:paypal.com']);
  // Lì il nome è una parola scelta da chi l'ha aperto: somigliare non basta.
  for (const u of ['https://apply.vercel.app/', 'https://ample.netlify.app/', 'https://googly.github.io/', 'https://amazon.com.co/', 'https://amazon.com.mx/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('il nome vero col trattino si vede in ogni pezzo, non solo nel nome del sito', () => {
  // #725.2 — i pezzi davanti al sito si confrontavano solo interi: paypal-login.wixsite.com
  // e login-paypal.com.altro.net passavano, paypal.altro.net no.
  for (const [u, marchio] of [
    ['https://paypal-login.evil.com/', 'paypal.com'],
    ['https://secure-paypal.accesso-sicuro.net/', 'paypal.com'],
    ['https://login-paypal.com.evil.net/', 'paypal.com'],
    ['https://login-apple.com.evil.net/', 'apple.com'],
    ['https://apple-com.net/', 'apple.com'],
    ['https://paypal-login.wixsite.com/conto', 'paypal.com'],
    ['https://paypal-login.weebly.com/', 'paypal.com'],
    ['https://paypal-login.000webhostapp.com/', 'paypal.com'],
    ['https://paypal-login.ngrok.io/', 'paypal.com'],
    ['https://secure-paypal:x@evil.net/', 'paypal.com'],
  ]) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:' + marchio + '|')), `nessun avviso su ${u}`);
  }
  // Le pagine ufficiali dei marchi sui servizi di pagine stanno nell'elenco dei loro domini.
  for (const u of ['https://google-research.github.io/', 'https://amazon-science.github.io/', 'https://google-developers.appspot.com/', 'https://instagram-engineering.com/', 'https://pineapple-com.net/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
  assert.ok(LS.analizza('https://paypal-login.appspot.com/').some((c) => c.startsWith('nome_altrui:paypal.com')));
});

test('un marchio che è una parola conta da solo, uno distintivo anche attaccato: stessa regola del controllo all’apertura (#732)', () => {
  for (const u of ['https://pineapple.com/', 'https://appleinsider.com/', 'https://pineapple.github.io/', 'https://x-plane.com/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
  for (const [u, marchio] of [
    ['https://paypallogin.github.io/', 'paypal.com'], ['https://paypallogin.com/', 'paypal.com'],
    ['https://netflixaccount-verify.net/', 'netflix.com'], ['https://apple-pie.it/', 'apple.com'],
    ['https://appleid-verifica.com/', 'apple.com'], ['https://apple-id.evil.com/', 'apple.com'],
  ]) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:' + marchio + '|')), `nessun avviso su ${u}`);
  }
});

test('dal tasto destro avvisano gli stessi marchi del controllo all’apertura, non solo i più famosi (#732)', () => {
  for (const [u, marchio] of [['https://chase-login.com/', 'chase.com'], ['https://wise-transfer.com/', 'wise.com'], ['https://gmail-verify.com/', 'gmail.com']]) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:' + marchio + '|')), `nessun avviso su ${u}`);
  }
  for (const u of ['https://chase.com/', 'https://steamcommunity.com/', 'https://amazonia.org/', 'https://google-gemini.github.io/', 'https://otherwise.github.io/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('i domini con cui i marchi servono file, immagini e allegati non sono imitazioni, chi ci si appoggia sì (#732)', () => {
  for (const u of [
    'https://raw.githubusercontent.com/microsoft/vscode/main/README.md', 'https://lh3.googleusercontent.com/a/foto.jpg',
    'https://fonts.googleapis.com/css2?family=Inter', 'https://storage.googleapis.com/secchio/file.pdf',
    'https://s3.amazonaws.com/secchio/file.pdf', 'https://cdn.discordapp.com/attachments/1/2/foto.png',
    'https://media.discordapp.net/x.png', 'https://i.ebayimg.com/images/x.jpg', 'https://mmg.whatsapp.net/x',
  ]) assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  for (const u of ['https://paypal-login.s3.amazonaws.com/', 'https://paypal-login.storage.googleapis.com/', 'https://paypal.wordpress.com/']) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:paypal.com|')), `nessun avviso su ${u}`);
  }
});

test('un marchio-parola scritto con lettere finte e attaccato a un’altra parola avvisa dal tasto destro come all’apertura (#732)', () => {
  for (const [u, marchio] of [
    ['https://аpplelogin.com/', 'apple.com'], ['https://сhaselogin.com/', 'chase.com'],
    ['https://аpplelogin.github.io/', 'apple.com'], ['https://app1elogin.com/', 'apple.com'],
  ]) assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:' + marchio + '|')), `nessun avviso su ${u}: ${LS.analizza(u)}`);
  assert.deepEqual(LS.analizza('https://applelogin.com/'), []);
});

test('«vv» e «rn» latini non sono lettere finte, e le parole come amazonite o rosebay non sono il marchio: tasto destro e apertura tacciono uguale (#732)', () => {
  const { evaluate } = require(join(ROOT, 'src/main/services/safebrowse/engine.js'));
  for (const u of ['https://improvvise.it/', 'https://cene-improvvise.it/', 'https://avviserai.it/', 'https://avviserà.it/', 'https://ravviserai.com/', 'https://stearns.com/',
    'https://amazonite.com/', 'https://amazonite-gioielli.it/', 'https://rosebay.com/', 'https://forebay.org/', 'https://rosebay.github.io/']) {
    assert.deepEqual(LS.analizza(u), [], u);
    assert.equal(evaluate(u).level, 'safe', u);
  }
  assert.ok(LS.analizza('https://rosebay-ebay.com/').some((c) => c.startsWith('nome_altrui:ebay.com|')));
  assert.ok(LS.analizza('https://stearncommunity.com/').some((c) => c.startsWith('nome_altrui:steampowered.com|')));
});

test('su una piattaforma che ospita altri il nome nudo di un marchio è suo solo se lo dice l’elenco dei siti ufficiali: tasto destro e apertura rispondono uguale (#732)', () => {
  const { evaluate } = require(join(ROOT, 'src/main/services/safebrowse/engine.js'));
  const imita = (u) => LS.analizza(u).some((c) => /^(nome_altrui|typosquatting|omografo):/.test(c));
  for (const u of ['https://amazon.github.io/', 'https://sub.amazon.github.io/', 'https://youtube.github.io/', 'https://google.github.io/',
    'https://facebook.github.io/react/', 'https://x.github.io/', 'https://amazon.netlify.app/', 'https://amazon.de/', 'https://amazon-ion.github.io/']) {
    assert.equal(imita(u), evaluate(u).level !== 'safe', `le due strade non concordano su ${u}: ${LS.analizza(u)}`);
  }
  assert.ok(LS.analizza('https://amazon.github.io/').some((c) => c.startsWith('nome_altrui:amazon.com|')));
  assert.deepEqual(LS.analizza('https://amazon.de/'), []);
});

test('i siti dei marchi stessi non sono imitazioni, né all’apertura né dal tasto destro (#732)', () => {
  const { evaluate } = require(join(ROOT, 'src/main/services/safebrowse/engine.js'));
  for (const h of ['www.postepay.it', 'protonvpn.com', 'account.protonvpn.com', 'transferwise.com', 'ebayinc.com', 'www.microsoftstore.com',
    'www.amazontrust.com', 'gitlab-static.net', 'amazon.com.mx', 'ebay.com.my', 'yahoo.co.jp', 'github.blog', 'githubcopilot.com',
    'stripe.dev', 'revolut.me', 'telegram.me', 'binance.us', 'aliexpress.ru', 'shopify.dev', 'dropbox.tech', 'apple.news']) {
    const u = 'https://' + h + '/';
    assert.equal(evaluate(u).level, 'safe', h + ' apertura');
    assert.deepEqual(LS.analizza(u), [], h + ' tasto destro');
  }
});

test('un sosia con «rn» per m o «vv» per w avvisa all’apertura come dal tasto destro: una lettura sola (#732)', () => {
  const { evaluate } = require(join(ROOT, 'src/main/services/safebrowse/engine.js'));
  for (const h of ['grnail.com', 'grnail-login.com', 'rnicrosoftlogin.com', 'vvhatsapp-login.com', 'arnazonlogin.com', 'tvvitterlogin.com', 'p4ypallogin.com']) {
    const u = 'https://' + h + '/';
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:')), h + ' tasto destro: ' + LS.analizza(u));
    assert.notEqual(evaluate(u).level, 'safe', h + ' apertura');
  }
  for (const h of ['improvvise.it', 'stearns.com', 'avviserai.it']) assert.equal(evaluate('https://' + h + '/').level, 'safe', h);
});
