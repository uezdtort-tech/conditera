#!/usr/bin/env bash
# Read-only inspection of pinned Supabase service image contracts.
# Creates stopped throwaway containers only; never starts services or touches volumes.
set -Eeuo pipefail

OUT="${1:-./artifacts/supabase-image-contract}"
mkdir -p "$OUT"

declare -A IMAGES=(
  [postgres15]="supabase/postgres:15.6.1.141"
  [postgres17]="supabase/postgres:17.12.0.001"
  [gotrue]="supabase/gotrue:v2.164.0"
  [postgrest]="postgrest/postgrest:v12.2.0"
  [realtime]="supabase/realtime:v2.34.21"
  [storage]="supabase/storage-api:v1.14.5"
  [kong]="library/kong:2.8.1"
)

for name in "${!IMAGES[@]}"; do
  image="${IMAGES[$name]}"
  safe_name="supabase-image-audit-$name"
  echo "Inspecting $image"

  docker pull "$image"
  docker image inspect "$image" | jq '.[0] | {
    Id,
    RepoTags,
    Architecture,
    Os,
    User: .Config.User,
    WorkingDir: .Config.WorkingDir,
    Entrypoint: .Config.Entrypoint,
    Cmd: .Config.Cmd,
    ExposedPorts: (.Config.ExposedPorts // {})
  }' > "$OUT/$name.metadata.json"

  docker rm -f "$safe_name" >/dev/null 2>&1 || true
  container="$(docker create --name "$safe_name" "$image")"
  # Stream the rootfs archive directly to tar; no image filesystem is extracted
  # to the host. Capture only paths useful for identifying service binaries,
  # entrypoints, bundled runtimes and configuration.
  docker export "$container" |
    tar -tf - |
    grep -Ei '(^|/)(entrypoint[^/]*|docker-entrypoint[^/]*|gotrue|postgrest|realtime|storage-api|kong|nginx|postgres|beam.smp|node|supervisord)(/|$|\.)' |
    sort -u > "$OUT/$name.rootfs-candidates.txt" || true
  docker rm "$safe_name" >/dev/null
done

printf 'Image contract audit complete: %s\n' "$OUT"
