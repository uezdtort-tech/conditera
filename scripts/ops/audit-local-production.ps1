[CmdletBinding()]
param(
  [string]$RuntimeContainer = $(if ($env:PG17_RUNTIME_CONTAINER) { $env:PG17_RUNTIME_CONTAINER } else { "conditera-supabase-runtime" }),
  [string]$Database = $(if ($env:PG17_DATABASE) { $env:PG17_DATABASE } else { "supabase" }),
  [string]$User = $(if ($env:PG17_DATABASE_USER) { $env:PG17_DATABASE_USER } else { "supabase_admin" }),
  [string]$OutputRoot = $(if ($env:PRODUCTION_AUDIT_ROOT) { $env:PRODUCTION_AUDIT_ROOT } else { ".\reports\production-audit" })
)

# Read-only аудит единственного PostgreSQL 17 runtime. Не читает Config.Env,
# не выводит секреты, не запускает/останавливает контейнеры и не меняет БД/volumes.
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

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI не найден."
}

$root = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
  [System.IO.Path]::GetFullPath($OutputRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputRoot))
}
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$outDir = Join-Path $root $stamp
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$container = $null
$audit = $null
$auditError = $null
try {
  $inspectText = Invoke-DockerText -Arguments @("inspect", $RuntimeContainer)
  $container = @(ConvertFrom-Json -InputObject $inspectText)[0]

  if ($container.State.Status -ne "running") {
    throw "Runtime container is not running (state=$($container.State.Status))."
  }

  $sql = @'
SELECT jsonb_build_object(
  'database', current_database(),
  'serverVersion', current_setting('server_version'),
  'serverVersionNum', current_setting('server_version_num')::integer,
  'serverMajor', floor(current_setting('server_version_num')::integer / 10000)::integer,
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'isInRecovery', pg_is_in_recovery(),
  'appMigrationCount', CASE
    WHEN to_regclass('public.schema_migrations') IS NULL THEN 0
    ELSE (SELECT count(*)::integer FROM public.schema_migrations)
  END,
  'rlsPolicyCount', (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public'),
  'rlsEnabledTableCount', (
    SELECT count(*)::integer
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relrowsecurity
  ),
  'extensions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) ORDER BY extname), '[]'::jsonb)
    FROM pg_extension
  ),
  'requiredObjects', jsonb_build_object(
    'auth.users', to_regclass('auth.users') IS NOT NULL,
    'storage.buckets', to_regclass('storage.buckets') IS NOT NULL,
    'storage.objects', to_regclass('storage.objects') IS NOT NULL,
    'public.schema_migrations', to_regclass('public.schema_migrations') IS NOT NULL,
    'public.profiles', to_regclass('public.profiles') IS NOT NULL,
    'public.user_roles', to_regclass('public.user_roles') IS NOT NULL,
    'public.products', to_regclass('public.products') IS NOT NULL,
    'public.orders', to_regclass('public.orders') IS NOT NULL,
    'public.inventory_items', to_regclass('public.inventory_items') IS NOT NULL,
    'public.chat_channels', to_regclass('public.chat_channels') IS NOT NULL,
    'public.moderation_queue', to_regclass('public.moderation_queue') IS NOT NULL
  ),
  'requiredRoles', jsonb_build_object(
    'supabase_admin', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'),
    'conditera_app', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera_app'),
    'conditera_backup', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conditera_backup'),
    'anon', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon'),
    'authenticated', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'),
    'service_role', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
  )
);
'@

  $jsonText = Invoke-DockerText -Arguments @(
    "exec", $RuntimeContainer, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", $User, "-d", $Database, "-At", "-c", $sql
  )
  $audit = ConvertFrom-Json -InputObject $jsonText
} catch {
  $auditError = $_.Exception.Message
}

$healthProperty = if ($null -ne $container) { $container.State.PSObject.Properties["Health"] } else { $null }
$containerHealth = if ($null -ne $healthProperty -and $null -ne $healthProperty.Value) { $healthProperty.Value.Status } else { "no-healthcheck" }

$containerInfo = if ($null -ne $container) {
  [ordered]@{
    name = ([string]$container.Name).TrimStart("/")
    id = $container.Id
    image = $container.Config.Image
    state = $container.State.Status
    health = $containerHealth
    startedAt = $container.State.StartedAt
    restartPolicy = $container.HostConfig.RestartPolicy.Name
    networks = @($container.NetworkSettings.Networks.PSObject.Properties.Name)
    mounts = @($container.Mounts | ForEach-Object {
      [ordered]@{ type = $_.Type; name = $_.Name; destination = $_.Destination; readWrite = $_.RW }
    })
  }
} else {
  [ordered]@{ name = $RuntimeContainer; state = "not-found" }
}

$report = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  mode = "READ_ONLY"
  target = "single Supabase Runtime / PostgreSQL 17"
  container = $containerInfo
  databaseAudit = $audit
  error = $auditError
  safety = [ordered]@{
    containersStartedOrStopped = $false
    databasesModified = $false
    volumesModified = $false
    environmentValuesRead = $false
    secretValuesIncludedInReport = $false
  }
}

$jsonPath = Join-Path $outDir "pg17-runtime-inventory.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -Path $jsonPath -Encoding UTF8

Write-Host "Conditera PostgreSQL 17 runtime audit — READ ONLY"
Write-Host "Container: $RuntimeContainer"
Write-Host "State: $($containerInfo.state)"
if ($null -ne $audit) {
  Write-Host "Database: $($audit.database)"
  Write-Host "PostgreSQL: $($audit.serverVersion) (major $($audit.serverMajor))"
  Write-Host "Applied app migrations: $($audit.appMigrationCount)"
  Write-Host "Public RLS policies: $($audit.rlsPolicyCount)"
}
Write-Host "Report: $jsonPath"
Write-Host "No containers, databases or volumes were changed."

if ($auditError) {
  Write-Error $auditError
  exit 2
}
if ($audit.serverMajor -ne 17) {
  Write-Host "FAIL: Expected PostgreSQL 17; actual major is $($audit.serverMajor)." -ForegroundColor Red
  exit 3
}
if ($audit.isInRecovery) {
  Write-Host "FAIL: The target PostgreSQL server is in recovery; it is not a writable primary." -ForegroundColor Red
  exit 4
}
if ($audit.appMigrationCount -lt 81) {
  Write-Host "FAIL: Expected at least 81 applied application migrations; got $($audit.appMigrationCount)." -ForegroundColor Red
  exit 5
}
if ($audit.rlsPolicyCount -lt 1 -or $audit.rlsEnabledTableCount -lt 1) {
  Write-Host "FAIL: RLS policies or RLS-enabled tables are missing." -ForegroundColor Red
  exit 6
}
foreach ($property in $audit.requiredObjects.PSObject.Properties) {
  if (-not $property.Value) {
    Write-Host "FAIL: Required database object is missing: $($property.Name)." -ForegroundColor Red
    exit 7
  }
}
foreach ($property in $audit.requiredRoles.PSObject.Properties) {
  if (-not $property.Value) {
    Write-Host "FAIL: Required PostgreSQL role is missing: $($property.Name)." -ForegroundColor Red
    exit 8
  }
}
Write-Host "PASS: one writable PostgreSQL 17 runtime with required Supabase/app schemas, roles, migrations and RLS."
