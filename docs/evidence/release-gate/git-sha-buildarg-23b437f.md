# DEV-15: GIT_SHA build-arg прокинут в web-образ из CI

HEAD before: 23b437f. TZ v4.0 §9 (P1). Commit of this change follows (one commit).

## Состояние ДО (проверка механизма)

- `Dockerfile:43-44` (builder) и `Dockerfile:72-73` (runner): **механизм УЖЕ существует** —
  `ARG GIT_SHA=unknown` + `ENV APP_VERSION=${GIT_SHA}`; приложение читает
  `process.env.APP_VERSION` в `src/app/api/health/route.ts:102` (поле `version` тела /api/health).
- `Dockerfile.chat`, `Dockerfile.simplex-bridge`: ARG/ENV версии НЕ объявляют (chat/bridge —
  инфраструктурные сервисы; по заданию их build-логика не меняется, для bridge — только этот документ).
- `.github/workflows/ci.yml` job `docker-build` → step "Build web image": build-args ОТСУТСТВОВАЛИ
  → все CI-сборки получали `APP_VERSION=unknown` (Dockerfile-дефолт) — не понять, какой коммит крутится
  на сервере по /api/health. (Находка зафиксирована ранее: docs/evidence/release-gate/docker-static-review.md п.4.)
- Runtime-оверрайд деплоя сохраняется: docker-compose.yml:61 `APP_VERSION=${WEB_TAG:-dev}` (compose
  environment старше image ENV) — для локальных compose-запусков; CI-образ при этом несёт SHA в себе.

## Состояние ПОСЛЕ

`.github/workflows/ci.yml` → job `docker-build`, step "Build web image" (строки 143-155):

```yaml
      - name: Build web image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          push: false
          tags: conditera:${{ github.sha }}
          # DEV-15: GIT_SHA → ENV APP_VERSION в образе (Dockerfile:43-44/72-73) —
          # версия деплоя видна в /api/health (version). Без этого APP_VERSION=unknown.
          build-args: |
            GIT_SHA=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Имя ARG совпадает точно: `GIT_SHA` (Dockerfile:43/72) ← `build-args: GIT_SHA=${{ github.sha }}`.

## Осознанные границы

- build-arg добавлен ТОЛЬКО в web-образ: только `Dockerfile` объявляет `ARG GIT_SHA`;
  для Dockerfile.chat / Dockerfile.simplex-bridge передача была бы dead-config (ARG нет).
- Экспозиция в /api/health уже реализована кодом (`version: APP_VERSION`, route.ts:176) —
  health-роут в этой задаче НЕ менялся (параллельная DEV-17 работает с тем же файлом).
- Runtime-verify в песочнице НЕВОЗМОЖЕН (docker engine отсутствует — см. docker-gate-2,
  cap_sys_admin absent); проверка статическая: соответствие имени ARG ↔ build-args ↔ ENV ↔
  process.env.APP_VERSION. Полный verify — CI-прогон docker-build на GitHub (NOT RUN here).

## Изменённые файлы

- `.github/workflows/ci.yml:150-153` (+4 строки с комментарием)
- этот evidence-файл
