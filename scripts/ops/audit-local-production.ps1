[CmdletBinding()]
param(
  [string]$AppContainer = $(if ($env:APP_PG_CONTAINER) { $env:APP_PG_CONTAINER } else { "conditera-db" }),
  [string]$AppDatabase = $(if ($env:APP_PG_DATABASE) { $env:APP_PG_DATABASE } else { "conditera" }),
  [string]$AppUser = $(if ($env:APP_PG_USER) { $env:APP_PG_USER } else { "conditera" }),
  [string]$SupabaseContainer = $(if ($env:SUPABASE_PG_CONTAINER) { $env:SUPABASE_PG_CONTAINER } else { "conditera-supabase-db" }),
  [string]$SupabaseDatabase = $(if ($env:SUPABASE_PG_DATABASE) { $env:SUPABASE_PG_DATABASE } else { "supabase" }),
  [string]$SupabaseUser = $(if ($env:SUPABASE_PG_USER) { $env:SUPABASE_PG_USER } else { "supabase" }),
  [string]$OutputRoot = $(if ($env:PRODUCTION_AUDIT_ROOT) { $env:PRODUCTION_AUDIT_ROOT } else { ".\backups\production-audit" })
)

# Только SELECT и docker inspect. Не запускает/останавливает контейнеры,
# не меняет БД/volumes и не читает значения секретов.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-DockerText {
  param([string[]]$Arguments)
  $result = & docker @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("docker " + ($Arguments -join " ") + " завершился с кодом " + $LASTEXITCODE + ": " + ($result -join [Environment]::NewLine))
  }
  return ($result -join [Environment]::NewLine)
}

function Get-ContainerInventory {
  param([string]$Name, [string]$Database, [string]$User)

  $inspectText = Invoke-DockerText -Arguments @("inspect", $Name)
  $inspectArray = ConvertFrom-Json -InputObject $inspectText
  $inspect = @($inspectArray)[0]
  $state = $inspect.State.Status
  $health = if ($null -ne $inspect.State.Health) { $inspect.State.Health.Status } else { "no-healthcheck" }

  $base = [ordered]@{
    container = $Name
    exists = $true
    state = $state
    health = $health
    image = $inspect.Config.Image
    imageId = $inspect.Image
    networks = @($inspect.NetworkSettings.Networks.PSObject.Properties.Name)
    mounts = @($inspect.Mounts | ForEach-Object {
      [ordered]@{
        type = $_.Type
        name = $_.Name
        source = $_.Source
        destination = $_.Destination
        readWrite = $_.RW
      }
    })
    database = $Database
    databaseUser = $User
  }

  if ($state -ne "running") {
    $base.databaseAudit = [ordered]@{ status = "skipped"; reason = "container is not running" }
    return [pscustomobject]$base
  }

  $sql = @'
SELECT jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num')::integer,
  'system_identifier', (SELECT system_identifier::text FROM pg_control_system()),
  'schemas', (SELECT coalesce(jsonb_agg(nspname ORDER BY nspname), '[]'::jsonb) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),
  'extensions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) ORDER BY extname), '[]'::jsonb) FROM pg_extension),
  'tables', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('schema', schemaname, 'name', relname, 'estimatedRows', n_live_tup, 'bytes', pg_total_relation_size(relid)) ORDER BY schemaname, relname), '[]'::jsonb)
    FROM pg_stat_user_tables
  ),
  'exactTableRows', (
    SELECT coalesce(jsonb_object_agg(table_schema || '.' || table_name, row_count), '{}'::jsonb)
    FROM (
      SELECT table_schema, table_name,
        (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, false, '')))[1]::text::bigint AS row_count
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ) counts
  ),
  'rlsEnabledTables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND c.relrowsecurity),
  'rlsPolicies', (SELECT count(*) FROM pg_policies),
  'triggers', (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema NOT IN ('pg_catalog','information_schema')),
  'constraints', (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema NOT IN ('pg_catalog','information_schema')),
  'functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')),
  'sequences', (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog','information_schema')),
  'roles', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', rolname, 'superuser', rolsuper, 'bypassRls', rolbypassrls, 'canLogin', rolcanlogin) ORDER BY rolname), '[]'::jsonb) FROM pg_roles),
  'authUsers', CASE WHEN to_regclass('auth.users') IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM auth.users', false, false, '')))[1]::text::bigint END,
  'storageObjects', CASE WHEN to_regclass('storage.objects') IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM storage.objects', false, false, '')))[1]::text::bigint END,
  'migrationLedger', CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN NULL ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.schema_migrations', false, false, '')))[1]::text::bigint END
);
'@

  try {
    $jsonText = Invoke-DockerText -Arguments @("exec", $Name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", $User, "-d", $Database, "-At", "-c", $sql)
    $base.databaseAudit = ConvertFrom-Json -InputObject $jsonText
    $base.databaseAuditStatus = "success"
  } catch {
    $base.databaseAuditStatus = "failed"
    $base.databaseAuditError = $_.Exception.Message
  }

  return [pscustomobject]$base
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI не найден."
}
$dockerVersion = Invoke-DockerText -Arguments @("version", "--format", "{{.Server.Version}}")
$dockerInfo = Invoke-DockerText -Arguments @("info", "--format", "{{.OSType}}/{{.Architecture}}")

$root = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputRoot))
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$outDir = Join-Path $root $stamp
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

try { $app = Get-ContainerInventory -Name $AppContainer -Database $AppDatabase -User $AppUser }
catch { $app = [pscustomobject]@{ container = $AppContainer; exists = $false; error = $_.Exception.Message } }
try { $supabase = Get-ContainerInventory -Name $SupabaseContainer -Database $SupabaseDatabase -User $SupabaseUser }
catch { $supabase = [pscustomobject]@{ container = $SupabaseContainer; exists = $false; error = $_.Exception.Message } }

$composeAppServices = ""
$composeSupabaseServices = ""
try { $composeAppServices = Invoke-DockerText -Arguments @("compose", "-f", "docker-compose.yml", "config", "--services") } catch { $composeAppServices = "ERROR: " + $_.Exception.Message }
try { $composeSupabaseServices = Invoke-DockerText -Arguments @("compose", "-f", "docker-compose.supabase.yml", "config", "--services") } catch { $composeSupabaseServices = "ERROR: " + $_.Exception.Message }

$report = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  mode = "READ_ONLY"
  docker = [ordered]@{ serverVersion = $dockerVersion; platform = $dockerInfo }
  composeServices = [ordered]@{
    application = @($composeAppServices -split "\r?\n" | Where-Object { $_ })
    supabase = @($composeSupabaseServices -split "\r?\n" | Where-Object { $_ })
  }
  applicationPostgres = $app
  supabasePostgres = $supabase
  safety = [ordered]@{
    containersStartedOrStopped = $false
    databasesModified = $false
    volumesModified = $false
    secretsCollected = $false
  }
}

$jsonPath = Join-Path $outDir "production-inventory.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -Path $jsonPath -Encoding UTF8

$summary = @(
  "Conditera production inventory — READ ONLY",
  "UTC: $($report.generatedAtUtc)",
  "Docker: $dockerVersion ($dockerInfo)",
  "App PostgreSQL: $($app.state) / $($app.health) / $($app.databaseAudit.server_version)",
  "Supabase PostgreSQL: $($supabase.state) / $($supabase.health) / $($supabase.databaseAudit.server_version)",
  "Report: $jsonPath",
  "No containers, databases or volumes were changed."
)
$summary | Set-Content -Path (Join-Path $outDir "summary.txt") -Encoding UTF8
$summary | ForEach-Object { Write-Host $_ }

if (-not $app.exists -or -not $supabase.exists) {
  Write-Warning "Один или оба PostgreSQL-контейнера не найдены. Отчёт частичный; проверьте container_name в текущем Compose."
  exit 2
}
if ($app.state -ne "running" -or $supabase.state -ne "running") {
  Write-Warning "Один или оба PostgreSQL-контейнера не запущены. Базы не изменялись; аудит БД частичный."
  exit 2
}
if ($app.databaseAuditStatus -ne "success" -or $supabase.databaseAuditStatus -ne "success") {
  Write-Warning "Не удалось прочитать обе БД. Смотрите production-inventory.json."
  exit 3
}
if ($app.databaseAudit.system_identifier -eq $supabase.databaseAudit.system_identifier) {
  throw "Оба подключения вернули одинаковый system_identifier: возможно, контейнеры/URL указывают на один кластер."
}
Write-Host "OK: два разных PostgreSQL-кластера инвентаризированы без изменений."
