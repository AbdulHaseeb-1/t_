#!/usr/bin/env bash
# Attach infra/mssql/data/$MDF_FILE to the compose SQL Server and create a read-only login.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f ../.env ] && . ../.env
set +a
: "${MSSQL_SA_PASSWORD:?set MSSQL_SA_PASSWORD in .env}"
: "${DB_PASSWORD:?set DB_PASSWORD (reader login password) in .env}"
MDF_FILE="${MDF_FILE:-MDS_EPD_SQL16.mdf}"

[ -f "mssql/data/$MDF_FILE" ] || { echo "Missing infra/mssql/data/$MDF_FILE" >&2; exit 1; }
chmod a+rw "mssql/data" "mssql/data/$MDF_FILE"  # SQL Server runs as uid 10001 in the container

docker compose --env-file ../.env up -d --wait mssql
docker compose --env-file ../.env exec -T mssql /opt/mssql-tools18/bin/sqlcmd \
  -C -b -S localhost -U sa -P "$MSSQL_SA_PASSWORD" \
  -v DB_NAME="${DB_NAME:-MDS_EPD}" MDF_FILE="$MDF_FILE" \
     READER_LOGIN="${DB_USER:-db_intel_reader}" READER_PASSWORD="$DB_PASSWORD" \
  -i /dev/stdin < mssql/attach.sql
echo "Attached. Start the API with: pnpm dev"
