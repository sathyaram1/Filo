// I client hints (Sec-CH-UA*) delle richieste: Electron con la UA riscritta non ne manda nessuno, Chrome sempre, e
// senza Google respinge l'accesso in un profilo nuovo (#1616). Marchio onesto «Chromium» con la versione vera di
// process.versions.chrome, mai «Google Chrome» (provato: non serve). Puro; lo chiama l'unico onBeforeSendHeaders.

'use strict';

function piattaforma(platform) {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
}

// I tre hint a bassa entropia si aggiungono se mancano; la lista delle versioni piene si riscrive solo se c'è già,
// così il marchio di riempimento resta lo stesso nei due header. Torna una copia: le intestazioni date non si toccano.
function completaClientHints(headers, { versione = process.versions.chrome, platform = process.platform } = {}) {
  const out = { ...(headers || {}) };
  const piena = String(versione || '').trim();
  if (!/^\d+(\.\d+)*$/.test(piena)) return out;
  const maggiore = piena.split('.')[0];
  const chiavi = Object.keys(out);
  const trova = (nome) => chiavi.find((k) => k.toLowerCase() === nome.toLowerCase()) || null;
  const seManca = (nome, valore) => { if (!trova(nome)) out[nome] = valore; };
  seManca('Sec-CH-UA', `"Not?A_Brand";v="24", "Chromium";v="${maggiore}"`);
  seManca('Sec-CH-UA-Mobile', '?0');
  seManca('Sec-CH-UA-Platform', `"${piattaforma(platform)}"`);
  const lista = trova('Sec-CH-UA-Full-Version-List');
  if (lista) out[lista] = `"Not?A_Brand";v="24.0.0.0", "Chromium";v="${piena}"`;
  return out;
}

module.exports = { completaClientHints, piattaforma };
