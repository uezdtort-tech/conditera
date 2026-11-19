[CmdletBinding()]
param(
  [string]$AppContainer = $(if ($env:APP_PG_CONTAINER) { $env:APP_PG_CONTAINER } else { "conditera-db" }),
  [string]$AppDatabase = $(if ($env:APP_PG_DATABASE) { $env:APP_PG_DATABASE } else { "conditera" }),
  [string]$AppUser = $(if ($env:APP_PG_USER) { $env:APP_PG_USER } else { "conditera" }),
  [string]$SupabaseContainer = $(if ($env:SUPABASE_PG_CONTAINER) { $env:SUPABASE_PG_CONTAINER } else { "conditera-supabase-db" }),
  [string]$SupabaseDatabase = $(if ($env:SUPABASE_PG_DATABASE) { $env:SUPABASE_PG_DATABASE } else { "supabase" }),
  [string]$SupabaseUser = $(if ($env:SUPABASE_PG_USER) { $env:SUPABASE_PG_USER } else { "supabase" }),
  [string]$EnvFile = $(if ($env:PRODUCTION_ENV_FILE) { $env:PRODUCTION_ENV_FILE } elseif (Test-Path ".env.production") { ".env.production" } elseif (Test-Path ".env.local") { ".env.local" } else { "" }),
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

function Get-DockerRuntimeInventory {
  # Снимок всех контейнеров/образов/volumes/networks без чтения Env и секретов.
  $containerIdsText = Invoke-DockerText -Arguments @("ps", "-aq")
  $containers = @()
  $containerIds = @()
  foreach ($id in ($containerIdsText -split "\r?\n")) {
    if (-not [string]::IsNullOrWhiteSpace($id)) { $containerIds += $id.Trim() }
  }
  if ($containerIds.Count -gt 0) {
    $inspectText = Invoke-DockerText -Arguments (@("inspect") + $containerIds)
    $rawContainers = @(ConvertFrom-Json -InputObject $inspectText)
    foreach ($item in $rawContainers) {
      $networks = @()
      if ($null -ne $item.NetworkSettings.Networks) {
        foreach ($networkEntry in $item.NetworkSettings.Networks.PSObject.Properties) {
          $networkName = $networkEntry.Name
          $network = $networkEntry.Value
          $networks += [pscustomobject]@{
            name = $networkName
            ipAddress = $network.IPAddress
            gateway = $network.Gateway
            aliases = @($network.Aliases)
          }
        }
      }
      $health = if ($null -ne $item.State.Health) { $item.State.Health.Status } else { "no-healthcheck" }
      $portBindings = @()
      if ($null -ne $item.NetworkSettings.Ports) {
        foreach ($portEntry in $item.NetworkSettings.Ports.PSObject.Properties) {
          $hostBindings = @()
          foreach ($binding in @($portEntry.Value)) {
            if ($null -ne $binding) {
              $hostBindings += [pscustomobject]@{
                hostIp = $binding.HostIp
                hostPort = $binding.HostPort
              }
            }
          }
          $portBindings += [pscustomobject]@{
            containerPort = $portEntry.Name
            hostBindings = $hostBindings
          }
        }
      }
      $labels = $item.Config.Labels
      $composeProject = $null
      $composeService = $null
      $composeWorkingDir = $null
      $composeFiles = $null
      if ($null -ne $labels) {
        $label = $labels.PSObject.Properties["com.docker.compose.project"]
        if ($null -ne $label) { $composeProject = $label.Value }
        $label = $labels.PSObject.Properties["com.docker.compose.service"]
        if ($null -ne $label) { $composeService = $label.Value }
        $label = $labels.PSObject.Properties["com.docker.compose.project.working_dir"]
        if ($null -ne $label) { $composeWorkingDir = $label.Value }
        $label = $labels.PSObject.Properties["com.docker.compose.project.config_files"]
        if ($null -ne $label) { $composeFiles = $label.Value }
      }
      $containers += [pscustomobject]@{
        name = ([string]$item.Name).TrimStart("/")
        id = $item.Id
        image = $item.Config.Image
        imageId = $item.Image
        state = $item.State.Status
        health = $health
        startedAt = $item.State.StartedAt
        exitCode = $item.State.ExitCode
        oomKilled = $item.State.OOMKilled
        restartPolicy = $item.HostConfig.RestartPolicy.Name
        networkMode = $item.HostConfig.NetworkMode
        user = $item.Config.User
        entrypoint = @($item.Config.Entrypoint)
        command = @($item.Config.Cmd)
        exposedPorts = @($item.Config.ExposedPorts.PSObject.Properties.Name)
        portBindings = $portBindings
        composeProject = $composeProject
        composeService = $composeService
        composeWorkingDir = $composeWorkingDir
        composeFiles = $composeFiles
        networks = $networks
        mounts = @($item.Mounts | ForEach-Object {
          [pscustomobject]@{
            type = $_.Type
            name = $_.Name
            source = $_.Source
            destination = $_.Destination
            readWrite = $_.RW
          }
        })
      }
    }
  }

  $images = @()
  $imageText = Invoke-DockerText -Arguments @("image", "ls", "--no-trunc", "--format", "{{json .}}")
  foreach ($line in ($imageText -split "\r?\n")) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { $images += (ConvertFrom-Json -InputObject $line) }
  }

  $volumes = @()
  $volumeText = Invoke-DockerText -Arguments @("volume", "ls", "--format", "{{json .}}")
  foreach ($line in ($volumeText -split "\r?\n")) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { $volumes += (ConvertFrom-Json -InputObject $line) }
  }

  $networksInventory = @()
  $networkText = Invoke-DockerText -Arguments @("network", "ls", "--format", "{{json .}}")
  foreach ($line in ($networkText -split "\r?\n")) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { $networksInventory += (ConvertFrom-Json -InputObject $line) }
  }

  return [pscustomobject]@{
    containers = $containers
    images = $images
    volumes = $volumes
    networks = $networksInventory
  }
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
    $base.databaseAudit = [ordered]@{ database = $null; server_version = "not-running"; system_identifier = $null }
    $base.databaseAuditStatus = "skipped"
    return [pscustomobject]$base
  }
  $base.databaseAudit = [ordered]@{ database = $null; server_version = "not-audited"; system_identifier = $null }

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
        AND table_name IN ('profiles', 'users', 'products', 'orders', 'recipes', 'confectioners', 'product_slices', 'schema_migrations', 'objects')
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
if (-not (Test-Path "docker-compose.yml") -or -not (Test-Path "docker-compose.supabase.yml")) {
  throw "Запустите скрипт из корня репозитория Conditera."
}
$dockerVersion = Invoke-DockerText -Arguments @("version", "--format", "{{.Server.Version}}")
$dockerInfo = Invoke-DockerText -Arguments @("info", "--format", "{{.OSType}}/{{.Architecture}}")
$composeEnvArgs = @()
if ($EnvFile) {
  if (-not (Test-Path $EnvFile)) { throw "Compose env-файл не найден: $EnvFile" }
  $composeEnvArgs = @("--env-file", $EnvFile)
}

$root = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputRoot))
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$outDir = Join-Path $root $stamp
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

try { $app = Get-ContainerInventory -Name $AppContainer -Database $AppDatabase -User $AppUser }
catch { $app = [pscustomobject]@{ container = $AppContainer; exists = $false; state = "not-found"; health = "unknown"; databaseAudit = [pscustomobject]@{ database = $null; server_version = "not-found"; system_identifier = $null }; databaseAuditStatus = "not-run"; error = $_.Exception.Message } }
try { $supabase = Get-ContainerInventory -Name $SupabaseContainer -Database $SupabaseDatabase -User $SupabaseUser }
catch { $supabase = [pscustomobject]@{ container = $SupabaseContainer; exists = $false; state = "not-found"; health = "unknown"; databaseAudit = [pscustomobject]@{ server_version = "not-found"; system_identifier = $null }; databaseAuditStatus = "not-run"; error = $_.Exception.Message } }

$composeAppServices = ""
$composeSupabaseServices = ""
$composePg17Services = ""
$composeAppImages = ""
$composeSupabaseImages = ""
$composePg17Images = ""
try { $composeAppServices = Invoke-DockerText -Arguments (@("compose") + $composeEnvArgs + @("-f", "docker-compose.yml", "config", "--services")) } catch { $composeAppServices = "ERROR: " + $_.Exception.Message }
try { $composeSupabaseServices = Invoke-DockerText -Arguments (@("compose") + $composeEnvArgs + @("-f", "docker-compose.supabase.yml", "config", "--services")) } catch { $composeSupabaseServices = "ERROR: " + $_.Exception.Message }
try { $composeAppImages = Invoke-DockerText -Arguments (@("compose") + $composeEnvArgs + @("-f", "docker-compose.yml", "config", "--images")) } catch { $composeAppImages = "ERROR: " + $_.Exception.Message }
try { $composeSupabaseImages = Invoke-DockerText -Arguments (@("compose") + $composeEnvArgs + @("-f", "docker-compose.supabase.yml", "config", "--images")) } catch { $composeSupabaseImages = "ERROR: " + $_.Exception.Message }
try { $composePg17Services = Invoke-DockerText -Arguments (@("compose") + $composeEnvArgs + @("-f", "docker-compose.supabase.yml", "-f", "docker-compose.pg17-migration.yml", "--profile", "pg17-migration", "config", "--services")) } catch { $composePg17Services = "ERROR: " + $_.Exception.Message }
try { $composePg17Images = Invoke-DockerText -Arguments (@("compose") + $composeEnvArgs + @("-f", "docker-compose.supabase.yml", "-f", "docker-compose.pg17-migration.yml", "--profile", "pg17-migration", "config", "--images")) } catch { $composePg17Images = "ERROR: " + $_.Exception.Message }

$dockerRuntime = Get-DockerRuntimeInventory

$sameCluster = $app.databaseAudit.system_identifier -and
  $supabase.databaseAudit.system_identifier -and
  ($app.databaseAudit.system_identifier -eq $supabase.databaseAudit.system_identifier)
$sameDatabase = $app.databaseAudit.database -and
  $supabase.databaseAudit.database -and
  ($app.databaseAudit.database -eq $supabase.databaseAudit.database)

$report = [ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  mode = "READ_ONLY"
  databaseTopology = [ordered]@{
    samePostgresCluster = [bool]$sameCluster
    sameDatabaseName = [bool]$sameDatabase
    singleDatabaseTarget = [bool]($sameCluster -and $sameDatabase)
  }
  docker = [ordered]@{ serverVersion = $dockerVersion; platform = $dockerInfo }
  dockerRuntime = $dockerRuntime
  composeEnvFile = if ($EnvFile) { [System.IO.Path]::GetFullPath($EnvFile) } else { "Docker Compose default .env resolution" }
  compose = [ordered]@{
    services = [ordered]@{
      application = @($composeAppServices -split "\r?\n" | Where-Object { $_ })
      supabase = @($composeSupabaseServices -split "\r?\n" | Where-Object { $_ })
      pg17Migration = @($composePg17Services -split "\r?\n" | Where-Object { $_ })
    }
    images = [ordered]@{
      application = @($composeAppImages -split "\r?\n" | Where-Object { $_ })
      supabase = @($composeSupabaseImages -split "\r?\n" | Where-Object { $_ })
      pg17Migration = @($composePg17Images -split "\r?\n" | Where-Object { $_ })
    }
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
  "Docker inventory: $($dockerRuntime.containers.Count) containers, $($dockerRuntime.images.Count) images, $($dockerRuntime.volumes.Count) volumes, $($dockerRuntime.networks.Count) networks",
  "App PostgreSQL: $($app.state) / $($app.health) / $($app.databaseAudit.server_version)",
  "Supabase PostgreSQL: $($supabase.state) / $($supabase.health) / $($supabase.databaseAudit.server_version)",
  "Same PostgreSQL cluster: $sameCluster",
  "Same database name: $sameDatabase",
  "Single database target: $($sameCluster -and $sameDatabase)",
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
if (-not $sameCluster) {
  Write-Error "SPLIT_POSTGRES_CLUSTERS: приложение и Supabase подключены к разным PostgreSQL-кластерам. Production cutover запрещён."
  exit 4
}
if (-not $sameDatabase) {
  Write-Error "SPLIT_POSTGRES_DATABASES: подключения ведут в разные базы одного кластера. Единый источник данных не подтверждён."
  exit 5
}
Write-Host "OK: прямое подключение приложения и Supabase API ведут в одну базу одного PostgreSQL-кластера."
