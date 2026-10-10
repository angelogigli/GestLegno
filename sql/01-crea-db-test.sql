/* GestLegno Web - crea il database di TEST ripristinando il backup di LEGNOEURO.
   L'app scrive sul database indicato in config.json: per le prove del cliente usare LEGNOEURO_TEST,
   così il gestionale in produzione (LEGNOEURO) non viene toccato.

   1. Copia il file .bak sul server (in una cartella leggibile dal servizio SQL Server).
   2. Correggi @bak qui sotto.
   3. Esegui lo script in SSMS come amministratore SQL (sa o sysadmin).
   Funziona da SQL Server 2016 in su. */

DECLARE @bak  nvarchar(500) = N'C:\GestLegnoWeb\backup\LegnoEuro202609170500.bak';  -- <-- percorso del backup
DECLARE @db   sysname       = N'LEGNOEURO_TEST';                                   -- <-- nome del database di test

SET NOCOUNT ON;
IF DB_ID(@db) IS NOT NULL
BEGIN
  RAISERROR(N'Il database %s esiste già. Per ricrearlo eliminalo prima (DROP DATABASE) o cambia @db.', 16, 1, @db);
  RETURN;
END

DECLARE @dataPath nvarchar(500) = CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(500));
DECLARE @logPath  nvarchar(500) = CAST(SERVERPROPERTY('InstanceDefaultLogPath')  AS nvarchar(500));

-- file logici contenuti nel backup
DECLARE @files TABLE (
  LogicalName nvarchar(128), PhysicalName nvarchar(260), [Type] char(1), FileGroupName nvarchar(128) NULL,
  Size numeric(20,0), MaxSize numeric(20,0), FileId bigint, CreateLSN numeric(25,0), DropLSN numeric(25,0) NULL,
  UniqueId uniqueidentifier, ReadOnlyLSN numeric(25,0) NULL, ReadWriteLSN numeric(25,0) NULL,
  BackupSizeInBytes bigint, SourceBlockSize int, FileGroupId int, LogGroupGUID uniqueidentifier NULL,
  DifferentialBaseLSN numeric(25,0) NULL, DifferentialBaseGUID uniqueidentifier NULL, IsReadOnly bit, IsPresent bit,
  TDEThumbprint varbinary(32) NULL, SnapshotUrl nvarchar(360) NULL);
INSERT @files EXEC (N'RESTORE FILELISTONLY FROM DISK = N''' + @bak + N'''');

DECLARE @move nvarchar(max) = N'', @n int = 0;
SELECT @move = @move + N', MOVE N''' + LogicalName + N''' TO N''' +
       CASE WHEN [Type] = 'L' THEN @logPath ELSE @dataPath END + @db + N'_' + LogicalName +
       CASE WHEN [Type] = 'L' THEN N'.ldf' WHEN FileId = 1 THEN N'.mdf' ELSE N'.ndf' END + N''''
FROM @files ORDER BY FileId;

DECLARE @sql nvarchar(max) = N'RESTORE DATABASE ' + QUOTENAME(@db) + N' FROM DISK = N''' + @bak + N''' WITH RECOVERY, STATS = 10' + @move;
PRINT @sql;
EXEC (@sql);

-- database di test: modello di recupero semplice (il log non cresce)
EXEC (N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET RECOVERY SIMPLE');
PRINT N'Database ' + @db + N' pronto.';

-- controllo rapido
EXEC (N'SELECT (SELECT COUNT(*) FROM ' + QUOTENAME(@db) + N'.dbo.BIT_RichProfAnag) AS richieste,
               (SELECT MAX(BITPRT_DATA) FROM ' + QUOTENAME(@db) + N'.dbo.BIT_RichProfAnag) AS ultima_richiesta');
