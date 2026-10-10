# GestLegno Web — installazione sul server

App web per le richieste profili dei clienti e la proposta di taglio dal magazzino, sul database LEGNOEURO di GestLegno.
Si apre dal browser su **https://gestlegno.mapnet.it**.
IIS riceve le richieste in HTTPS e le inoltra a Node.js, che gira sul server come attività pianificata e ascolta solo in locale (127.0.0.1:3010).

## Cosa serve
- Windows Server con SQL Server (2016 o successivo) e il database LEGNOEURO
- Node.js LTS 18 o successivo (l'installer prova a installarlo con winget; altrimenti msi x64 da https://nodejs.org)
- Accesso a internet dal server durante l'installazione (per scaricare le librerie npm)
- Il backup `LegnoEuro*.bak` se vuoi creare il database di test
- Per HTTPS: record DNS `gestlegno.mapnet.it` verso il server e un certificato (Let's Encrypt con win-acme, oppure un certificato *.mapnet.it già in vostro possesso)

## Installazione (prima volta)

**1. Database di test** (consigliato per le prove del cliente)
Copia il `.bak` sul server, apri `sql\01-crea-db-test.sql` in SSMS, correggi il percorso in `@bak` ed esegui.
Crea `LEGNOEURO_TEST`, copia identica di LEGNOEURO: le prove non toccano il gestionale in uso.

**2. Utente SQL dell'app**
Apri `sql\02-utente-app.sql`, scegli una password ed esegui. Crea l'utente `gestlegno_web` con sola lettura/scrittura dati.
Serve la modalità di autenticazione mista: lo script avvisa se non è attiva.

**3. DNS e rete** (per HTTPS)
- Record A `gestlegno.mapnet.it` → IP pubblico del server (o IP interno, se il cliente lavora solo in rete locale/VPN).
- Se il sito è raggiungibile da internet: porte **443** e **80** inoltrate al server. La 80 serve solo alla verifica Let's Encrypt e al reindirizzamento su HTTPS.

**4. Installa l'app**
Copia questa cartella sul server e fai doppio clic su `installa.cmd` (chiede i permessi di amministratore). L'installer:
- copia i file in `C:\GestLegnoWeb` e installa le librerie
- chiede server SQL, database, utente e password, se attivare la scrittura, utente e password per entrare nell'app
- verifica la connessione al database
- registra l'avvio automatico (attività "GestLegnoWeb", account SYSTEM)
- alla fine propone di configurare IIS (`iis\configura-iis.ps1`): installa URL Rewrite e ARR se mancano, crea il sito
  IIS "GestLegno" per `gestlegno.mapnet.it` e collega il certificato se è già sul server

**5. Certificato**
Se il server ha già un certificato valido per `gestlegno.mapnet.it` o `*.mapnet.it` (in Computer locale › Personale), lo script lo usa da solo.
Altrimenti, con DNS e porta 80 pronti, usa win-acme (gratuito, rinnovo automatico): lo script stampa il comando esatto, del tipo
`C:\win-acme\wacs.exe --source iis --siteid N --host gestlegno.mapnet.it --accepttos --emailaddress tua@email`.

Alla fine apri **https://gestlegno.mapnet.it**: il browser chiede utente e password dell'app.

## Uso quotidiano
| Cosa | Come |
|---|---|
| Aprire l'app | https://gestlegno.mapnet.it |
| Configurare/ricontrollare IIS e certificato | `iis\configura-iis.ps1` |
| Riavviare dopo una modifica a `config.json` | `riavvia.ps1` (da PowerShell come amministratore) |
| Leggere il registro | `C:\GestLegnoWeb\logs\server.log` |
| Verificare il database | `node verifica-db.js` nella cartella dell'app |
| Aggiornare l'app | copia i file nuovi in una cartella e rilancia `installa.cmd`: `config.json` resta |
| Fermare e togliere l'avvio automatico | `disinstalla.ps1` |

## config.json
Esempio completo in `config.esempio.json`. È leggibile solo da amministratori e SYSTEM (contiene password).

- `allowWrite`: `false` = l'app legge soltanto; `true` = "Salva richiesta" scrive in `BIT_RichProfAnag` / `BIT_RichProfDett`
- `accesso.utenti`: utenti e password per entrare nell'app (aggiungine uno per persona)
- `db.database`: `LEGNOEURO_TEST` per le prove, `LEGNOEURO` per la produzione
- `db.auth`: `sql` (utente e password, consigliato) oppure `windows` (l'app si collega come account SYSTEM del server)
- `db.instanceName`: nome dell'istanza se non è quella predefinita (es. `SQLEXPRESS`)

Dopo ogni modifica: `riavvia.ps1`.

## Passaggio alla produzione
Quando il cliente approva: esegui `sql\02-utente-app.sql` con `@db = N'LEGNOEURO'`, metti `"database": "LEGNOEURO"` in `config.json` e riavvia.
Prima fai un backup di LEGNOEURO.

## Note di sicurezza
- Node.js ascolta solo su 127.0.0.1: dall'esterno si passa soltanto da IIS in HTTPS (HTTP viene reindirizzato, HSTS attivo).
- Accesso con utente e password per ogni persona (`accesso.utenti`), password lunghe. Dopo 10 tentativi sbagliati in 15 minuti
  lo stesso indirizzo viene bloccato per 15 minuti (registrato in `logs\server.log`).
- Se il cliente lavora da sedi fisse, conviene limitare il sito IIS ai suoi indirizzi IP (IIS › Restrizioni indirizzi IP e domini) o usare la VPN.
- Non usare `sa` in `config.json`: usa l'utente dedicato `gestlegno_web`.
- Solo per prove in rete locale senza IIS: `installa.ps1 -AccessoDiretto` apre la porta 3010.
