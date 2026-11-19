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
  [imgproxy]="darthsim/imgproxy:v3.24.0"
  [postgres_meta]="supabase/postgres-meta:v0.83.2"
  [studio]="supabase/studio:2025.06.23-sha-2cd0383"
  [logflare]="supabase/logflare:1.4.0"
  [vector]="timberio/vector:0.28.1-debian"
)

for name in "${!IMAGES[@]}"; do
  image="${IMAGES[$name]}"
  safe_name="supabase-image-audit-$name-$$"
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

  container="$(docker create --name "$safe_name" "$image")"
  cleanup() {
    docker rm -v "$safe_name" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  # Stream the rootfs archive directly to tar; no image filesystem is extracted
  # to the host. awk exits successfully even when no candidate path is found.
  docker export "$container" |
    tar -tf - |
    awk 'tolower($0) ~ /(^|\/)(entrypoint[^/]*|docker-entrypoint[^/]*|gotrue|postgrest|realtime|storage-api|kong|nginx|postgres|beam.smp|node|supervisord)(\/|$|\.)/' |
    sort -u > "$OUT/$name.rootfs-candidates.txt"

  cleanup
  trap - EXIT
done

printf 'Image contract audit complete: %s\n' "$OUT"
