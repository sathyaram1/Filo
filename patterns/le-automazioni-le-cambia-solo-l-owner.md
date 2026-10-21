# Le automazioni le cambia solo l'owner

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un cambio in `.github/workflows` arriva su GitHub solo per mano
dell'owner. Una routine non lo scrive e manda il lavoro ai lavori locali (lo
dicono i ruoli; il controllo di sicurezza boccia un diff che ci entra). In locale
il salvataggio automatico non deve poterlo spedire: il ramo lo spinge l'owner con
una credenziale a parte.

**Perché** (decisione dell'owner, #1140). GitHub fa girare un'automazione appena
arriva il ramo che la contiene: niente fusione, niente cancello. Non vede i
segreti dell'ambiente di rilascio, ma può chiedere `contents: write` e riscrivere
una release vecchia ancora modificabile (le 237 uscite prima dei rilasci
immutabili; #1119 limita il danno a chi è rimasto indietro). Su main un cambio
alle automazioni non passa senza l'owner (L5 del server scatta su `.github/`), ma
su un ramo il danno è fatto alla spinta.

## Chi spinge, e con cosa (prove del 21/10/2026)

| Chi | Credenziale | Scrive le automazioni? |
|---|---|---|
| Routine in cloud, `git push` | proxy della sessione, con l'App «Claude» di Anthropic installata sul repo | **sì**: un ramo di prova con un file nuovo in `.github/workflows` è stato accettato |
| Routine in cloud, strumenti GitHub della sessione | la stessa App, a nome dell'owner | **sì**: lo stesso file l'ha tolto uno di questi strumenti, con un commit firmato dall'owner |
| Lavori server su filo-security | token da un'ora del server, senza `workflows` | no |
| Cancello di fusione su Filo | App `filo-merge-gate` | sì, ed è voluto: porta su main i cambi che l'owner ha approvato (#1073) |
| Salvataggio automatico e `npm run finish` sul PC dell'owner | l'aiutante delle credenziali di git (gh o Git Credential Manager) | sì, finché il token ha lo scope `workflow` |

**In cloud non c'è un interruttore per le sole automazioni.** I permessi di
un'App li decide chi l'ha scritta: chi la installa sceglie solo su quali repo
agisce. Il blocco per percorso di GitHub («Restrict file paths» delle push
ruleset) esiste solo per i repo privati o interni dei piani a pagamento, e Filo è
pubblico. Restano due strade, e le sceglie l'owner: tenere l'App e accettare il
rischio residuo, oppure togliere Filo all'App e far spingere le routine con un
token del server senza `workflows`, come già per filo-security. La seconda va
provata prima con una sessione sola: una sessione cloud potrebbe non partire
senza l'App sul repo.

## In locale: i passi dell'owner

Da una sessione locale con lui, in PowerShell.

1. **Chi dà le credenziali a git**: `git config --show-origin --get-all
   credential.helper` e `git config --get-urlmatch credential.helper
   https://github.com`. `!gh auth git-credential` vuol dire gh; `manager` vuol
   dire Git Credential Manager.
2. **Togliere il permesso**. Con gh: `gh auth refresh -h github.com
   --remove-scopes workflow`, poi `gh auth status`: fra gli scope `workflow` non
   deve più esserci. Con Git Credential Manager il token ha sempre `workflow`: si
   cancella la voce `git:https://github.com` da Gestione credenziali di Windows,
   si passa a gh con `gh auth setup-git` e si fa il passo con gh.
3. **La credenziale delle automazioni**, usata solo a mano: un token
   fine-grained (GitHub → Settings → Developer settings → Fine-grained tokens)
   solo sul repo Filo, con Contents e Workflows in lettura e scrittura e una
   scadenza breve. Sul PC non si salva (un gestore di password va bene). Quando
   un ramo porta un cambio alle automazioni:
   `git -c credential.helper= -c credential.https://github.com.helper= push origin <ramo>`.
   Con gli aiutanti spenti git chiede utente e password, e la password è il
   token. Un agente a quella domanda non sa rispondere: è questo che tiene la
   credenziale a mano. Poi `npm run finish` come sempre: L5 si ferma su
   `.github/` e il sì lo dà l'owner.
4. **La prova** (è la verifica del #1140): da un ramo usa e getta, un file nuovo
   in `.github/workflows` e `git push`. GitHub deve rispondere `refusing to allow
   an OAuth App to create or update workflow … without workflow scope`.

## Cosa succede dopo

- Il salvataggio automatico e `npm run finish` riconoscono quel no e dicono di
  spingere a mano (`.claude/hooks/auto-commit-merge.sh`,
  `scripts/finish-local.mjs`). Finché quel commit non è su origin, anche i
  salvataggi successivi del ramo restano in locale.
- Quando main porta un cambio alle automazioni, un ramo che lo incorpora con una
  fusione probabilmente viene rifiutato anche lui: su filo-security il cancello
  lo vede già (il suo riallineamento di main nel ramo torna con `refusing to
  allow a GitHub App to create or update workflow`). Con un rebase i commit
  nuovi non toccano le automazioni, ma non è provato. Se succede, quel ramo si
  spinge una volta a mano.
