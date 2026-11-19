---
id: privacy
title: Privacy
subtitle: Cosa esce dal tuo computer e chi lo vede.
updated: 2026-11-17
order: 2
---

Filo vuole essere un programma intelligente, che non devi imparare a usare. Per riuscirci usa diversi modelli di intelligenza artificiale, e i migliori non girano su un computer di casa: hanno bisogno di macchine molto più potenti. In più Filo è in alpha, e per capire cosa non funziona deve raccogliere dei dati.

Quindi qualcosa deve uscire dal tuo computer. Filo cerca di farne uscire il meno possibile, e di farlo vedere a meno persone possibile.

I tuoi dati vanno soprattutto in due posti. Il primo è il server di Filo, a cui io, creatore di Filo, ho accesso. Il secondo sono i fornitori dei modelli: il tuo computer parla con loro senza passare dal mio server, e io non vedo cosa mandi. Qui sotto spiego cosa va a ciascuno, e poi gli altri servizi che ricevono qualcosa.

## Cosa non esce mai

Password, numeri di carta e codici segreti. Filo li riconosce e li toglie dal testo prima che parta, anche quando sei tu a mandare la pagina. Li riconosce dalla forma, quindi uno scritto in un posto strano può sfuggirgli. Nelle immagini, come gli screenshot, non li cerca.

## Al server di Filo

Il server sta su Google: il codice gira in Belgio, i dati per ora negli Stati Uniti. Ci arrivano i feedback che mandi tu, e qualche segnalazione che Filo manda da solo quando qualcosa non funziona, con scritto solo cosa. Li leggiamo io e i modelli che correggono il problema.

Oltre ai feedback condividi dei conteggi: quanto aspetti, cosa si rompe, quali impostazioni cambi. Sono solo numeri, mai quello che scrivi né le pagine che apri. Filo te li chiede la prima volta che lo apri, e puoi spegnerli quando vuoi.

Se usi i crediti di Filo, il server sa quanto spendi e per cosa, per esempio in chat o in traduzioni, ma non cosa chiedi. Se entri con Google, tiene anche nome ed email accanto a quanto usi ogni funzione, con o senza crediti e anche a conteggi spenti. Lo correggerò, ma oggi è così.

Quando chiedi qualcosa all'Aiuto su un sito, il server riceve il nome del sito, senza conservarlo, per sapere come Filo ci è riuscito altre volte.

Il resto rimane sul server finché non mi chiedi di cancellarlo. I conteggi restano per sempre, perché non so quali sono tuoi.

## Ai fornitori dei modelli

Quando usi una funzione, al modello va quello che le serve: il testo da tradurre, la pagina su cui chiedi aiuto, la chat con le tue memorie, i file che Filo legge per risponderti.

Per non farti aspettare, molte risposte Filo le prepara prima che tu le chieda, come la spiegazione di un testo che selezioni o la correzione di quello che scrivi. Così parte un pezzo della pagina, a volte tutta, anche se poi la risposta non la apri.

Di serie Filo prepara tutto, anche sulla pagina della banca o della posta, password escluse. Aspetta che premi un tasto sui siti di salute del suo elenco, su quelli che gli indichi tu e in incognito. Puoi farlo aspettare anche su banche e posta, o ovunque. Te lo chiede la prima volta che apri Filo, e lo cambi nelle impostazioni, anche per un solo sito.

Le richieste passano da OpenRouter, che le smista ai fornitori ammessi dalla [politica sui modelli](models). Con i crediti di Filo vanno solo a quelli che promettono di non tenere niente, e nessuno può usarle per addestrare i suoi modelli. Anthropic fa eccezione e le tiene fino a un mese, di più se sospetta un abuso. Se usi una tua chiave OpenRouter, valgono le regole del tuo account.

## Gli altri servizi

Per segnalarti i siti pericolosi, Google riceve un codice ricavato dall'indirizzo di ogni pagina, troppo corto per sapere quale pagina apri. Quando Filo cerca sul web per te, la ricerca va a Wikipedia, Tavily o DuckDuckGo (quella di immagini a Wikimedia Commons e, con la chiave, a Tavily), e quella che scrivi nella barra a Google. Col tasto destro su un link, Filo chiede al sito dove porta prima del tuo clic. Se ti fermi col puntatore su un link accorciato, come quelli di bit.ly, la visita la riceve chi l'ha accorciato.

Ognuno vede da quale connessione arrivi, come sempre in rete. Filo non usa servizi esterni di pubblicità o di statistiche.

## Cosa puoi fare

Chat, memorie e cronologia sono salvate solo sul tuo computer, dove chi lo usa può leggerle. Le cancelli dalle impostazioni, una per una o tutte insieme. Per cancellare i tuoi dati dal server scrivi a hello@filo.red.

Puoi controllare tu stesso [il codice](https://github.com/sathyaram1/Filo) e verificare quali dati possono uscire. Se noti incongruenze con quanto dichiarato qui è un errore e ti chiedo di segnalarlo con un feedback o una mail in modo che si possa correggere al più presto.

## I punti deboli

Quello che OpenRouter e i fornitori promettono, io non posso controllarlo.

Nei primi mesi gli utenti sono pochi, ed è possibile quindi associare i dati di utilizzo a una persona specifica provando ad indovinare.

[Tutti i dettagli](privacy-completa), funzione per funzione.
