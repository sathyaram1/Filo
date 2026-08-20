// Firma "alla buona" l'app per Mac, subito dopo che è stata impacchettata.
//
// PERCHÉ ESISTE
//   Filo non ha (ancora) un certificato Apple: non possiamo firmare l'app con
//   un'identità vera. Su Mac con processore Intel un'app non firmata parte lo
//   stesso — con l'avviso del sistema — mentre sui Mac con chip Apple NON parte
//   proprio: il sistema pretende almeno una firma "locale", fatta dalla
//   macchina che costruisce e valida solo per sé stessa. Senza, chi ha un Mac
//   recente scarica un'app che si rifiuta di aprirsi, e non capisce perché.
//
//   Lo strumento di impacchettamento, quando non trova un certificato, salta la
//   firma del tutto: non ne mette nemmeno una locale. Questo passo la aggiunge.
//   NON toglie l'avviso al primo avvio (per quello serve un certificato Apple e
//   la registrazione dell'app presso Apple): rende solo l'app avviabile ovunque.
//
//   Quando arriverà un certificato vero, questo passo va tolto e sostituito con
//   la firma+registrazione ufficiale.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  // --force: sovrascrive un'eventuale firma parziale già presente.
  // --deep: firma anche i pezzi annidati (helper, framework).
  // --sign -: è la firma locale, senza certificato.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`[after-pack-mac] firma locale applicata a ${appPath}`);
};
