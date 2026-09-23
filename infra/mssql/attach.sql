-- Attaches the MDS_EPD data file and creates a least-privilege login for the API.
-- Only the .mdf is required: FOR ATTACH_REBUILD_LOG creates a fresh log file,
-- which works when the database was shut down cleanly.
IF DB_ID(N'$(DB_NAME)') IS NULL
BEGIN
  CREATE DATABASE [$(DB_NAME)]
    ON (FILENAME = N'/var/opt/mssql/userdata/$(MDF_FILE)')
    FOR ATTACH_REBUILD_LOG;
END;
GO

-- Upgrade the compatibility level from SQL Server 2016 (130) to 2022 (160) to use the modern optimizer.
ALTER DATABASE [$(DB_NAME)] SET COMPATIBILITY_LEVEL = 160;
-- Readers never block writers and vice versa.
ALTER DATABASE [$(DB_NAME)] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO

IF SUSER_ID(N'$(READER_LOGIN)') IS NULL
  CREATE LOGIN [$(READER_LOGIN)] WITH PASSWORD = N'$(READER_PASSWORD)', CHECK_POLICY = ON;
GO

USE [$(DB_NAME)];
IF USER_ID(N'$(READER_LOGIN)') IS NULL
  CREATE USER [$(READER_LOGIN)] FOR LOGIN [$(READER_LOGIN)];
ALTER ROLE db_datareader ADD MEMBER [$(READER_LOGIN)];
-- Needed to read MS_Description and catalog metadata for schema introspection.
GRANT VIEW DEFINITION TO [$(READER_LOGIN)];
GO

SELECT name, state_desc, compatibility_level FROM sys.databases WHERE name = N'$(DB_NAME)';
