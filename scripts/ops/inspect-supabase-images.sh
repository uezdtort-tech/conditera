#!/usr/bin/env bash
# Read-only inspection of pinned Supabase service image contracts.
# Creates stopped throwaway containers only; never starts services or touches volumes.
set -Eeuo pipefail

OUT="${1:-./artifacts/supabase-image-contract}"
mkdir -p "$OUT"

declare -A IMAGES=(
  [postgres15]="supabase/postgres:15.6.1.141"
  [postgres17]="supabase/postgres:17.11.0.017"
  [gotrue]="supabase/gotrue:v2.164.0"
  [postgrest]="postgrest/postgrest:v12.2.0"
  [realtime]="supabase/realtime:v2.34.21"
  [storage]="supabase/storage-api:v1.14.5"
  [kong]="library/kong:2.8.1"
  [imgproxy]="darthsim/imgproxy:v3.24.0"
  [postgres_meta]="supabase/postgres-meta:v0.83.2"
  [studio_compose]="supabase/studio:2026.11.02-sha-a05e7ec"
  [studio_stable_candidate]="supabase/studio:2026.11.02-sha-a05e7ec"
  [logflare]="supabase/logflare:1.4.0"
  [vector]="timberio/vector:0.28.1-debian"
  # Официальный self-hosted image set Supabase (versions.md, 2026-11-05).
  [official_postgres17]="supabase/postgres:17.6.1.136"
  [official_gotrue]="supabase/gotrue:v2.197.0"
  [official_postgrest]="postgrest/postgrest:v14.18"
  [official_realtime]="supabase/realtime:v2.148.3"
  [official_storage]="supabase/storage-api:v1.89.12"
  [official_imgproxy]="darthsim/imgproxy:v4.0.21"
  [official_postgres_meta]="supabase/postgres-meta:v0.100.0"
  [official_studio]="supabase/studio:2026.11.02-sha-a05e7ec"
  [official_edge_runtime]="supabase/edge-runtime:v1.77.9"
  [official_supavisor]="supabase/supavisor:2.9.13"
  [official_logflare]="supabase/logflare:1.50.15"
  [official_vector]="timberio/vector:0.53.0-alpine"
  [official_kong]="kong/kong:3.9.3"
  [official_envoy]="envoyproxy/envoy:v1.39.6"
)

FAILED_IMAGES=0
for name in "${!IMAGES[@]}"; do
  image="${IMAGES[$name]}"
  safe_name="supabase-image-audit-$name-$$"
  echo "Inspecting $image"

  if ! docker pull "$image"; then
    printf '{"image":"%s","pullStatus":"not-found-or-unavailable"}\n' "$image" > "$OUT/$name.metadata.json"
    : > "$OUT/$name.rootfs-candidates.txt"
    FAILED_IMAGES=1
    continue
  fi
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
  # Read-only rootfs metadata needed to evaluate a single-container packaging POC.
  docker cp "$container:/etc/os-release" "$OUT/$name.os-release" >/dev/null 2>&1 || true
  docker cp "$container:/etc/passwd" "$OUT/$name.passwd" >/dev/null 2>&1 || true
  cleanup() {
    docker rm -v "$safe_name" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  # Stream the rootfs archive directly to tar; no image filesystem is extracted
  # to the host. awk exits successfully even when no candidate path is found.
  docker export "$container" |
    tar -tf - |
    awk 'tolower($0) ~ /(^|\/)(entrypoint[^/]*|docker-entrypoint[^/]*|gotrue|postgrest|realtime|storage-api|supavisor|edge-runtime|postgres-meta|studio|imgproxy|vector|kong|envoy|nginx|postgres|beam.smp|node|deno|supervisord)(\/|$|\.)/' |
    sort -u > "$OUT/$name.rootfs-candidates.txt"

  cleanup
  trap - EXIT
done

printf 'Image contract audit complete: %s\n' "$OUT"
if [[ "$FAILED_IMAGES" -ne 0 ]]; then
  echo "One or more pinned images could not be pulled; see metadata reports."
  exit 1
fi
