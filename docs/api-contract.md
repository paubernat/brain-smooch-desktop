# Contrato extensión ↔ servicio

Servicio local en `http://127.0.0.1:8765`. JSON en snake_case.

## `POST /fichas` (idempotente por `video_id`; un segundo POST actualiza los campos)

```json
{
  "video_id": "ib6nIB-fbNE",
  "url": "https://www.youtube.com/shorts/ib6nIB-fbNE",
  "metadata": {
    "title": "These Chords So Nasty (you've been warned)",
    "description_raw": "texto completo (videoDetails.shortDescription)",
    "keywords": ["piano", "jazz"],
    "category": "Music",
    "duration_s": 58,
    "is_short": true,
    "chapters": [{"start_s": 0, "title": "Intro"}],
    "channel_id": "UC...",
    "channel_name": "Jeff Schneider",
    "publish_date": "2025-01-01",
    "is_family_safe": true,
    "game": null,
    "ai_disclosure": {"labeled": true, "source": "next", "text": "Made with AI: Sounds or visuals were altered or fully generated."},
    "live": {"is_live_now": false, "was_live": false, "is_upcoming": false}
  },
  "transcript": {
    "status": "ok",
    "language": "en",
    "kind": "manual",
    "segments": [{"start_s": 0.0, "text": "..."}]
  },
  "storyboard": {
    "thumbnail_url": "https://i.ytimg.com/vi/<id>/maxresdefault.jpg",
    "level": {
      "width": 160, "height": 90, "frame_count": 100,
      "columns": 10, "rows": 10, "interval_ms": 2000
    },
    "sprite_urls": ["https://i.ytimg.com/sb/<id>/storyboard3_L2/M0.jpg?sqp=...&sigh=..."]
  }
}
```

- `transcript.status` ∈ `ok | none | blocked`. Si no es `ok`, `segments` = `[]`.
- `storyboard` puede ser `null` si el vídeo no tiene spec.
- `chapters` = `[]` si no hay.
- `metadata.ai_disclosure`: etiqueta de YouTube «Contenido alterado o sintético» (sección «Cómo se ha hecho»; solo lo que declara el creador, nunca el doblaje automático). `source` ∈ `next | reel | dom | unknown`: dónde se buscó (`next` = `/youtubei/v1/next` o `ytInitialData` de `/watch`; `reel` = respuestas de Shorts). Con `unknown` no se encontró la respuesta y `labeled` no significa nada. `text` (opcional): cabecera y texto de la sección. Ver `extension/SPIKE.md`.
- `metadata.live`: `is_live_now` (directo en curso), `is_upcoming` (programado), `was_live` (grabación de un directo terminado). Del player response.
- Ambos son opcionales (clientes antiguos): se guardan como `NULL` y `GET` los devuelve como `null`.
- Jueces (`FichaView`, nivel L1): `video.ai_labeled` (`true`/`false`; se omite si `source` es `unknown`) y `video.live` (solo si algún indicador es `true`).

Respuesta: `200` con la ficha (igual que `GET /fichas/{video_id}`).

## `GET /fichas/{video_id}`

```json
{
  "video_id": "...",
  "levels": {"L1": "ok", "L2": "ok|pending|error", "L3": "ok|none|blocked", "L4": "ok|pending|none|error"},
  "label": {"label": "LIBRE", "reason": "...", "labeled_at": "..."} ,
  "...": "resto de campos de la ficha"
}
```
`label` es `null` si no está etiquetado. `404` si no existe.

## `POST /labels`

```json
{"video_id": "...", "label": "NO|LIMITADO|LIBRE", "reason": "opcional"}
```
Respuesta `200` `{"video_id": "...", "label": "...", "reason": "...", "split": "dev|test", "labeled_at": "...", "verdict_seen_before_label": false}`.
`404` si la ficha no existe. Re-etiquetar actualiza label/reason pero conserva el `split`.
`verdict_seen_before_label` (columna de `labels`, se recalcula en cada etiqueta): `true` si el servicio ya había devuelto el veredicto visible del juez en directo para ese vídeo (tabla `verdict_exposures`). La ablación y `/policy/evaluate` excluyen esas etiquetas (`--include-seen` las incluye en la ablación).

## Juez en directo: `POST /verdicts/{video_id}`, `GET /verdicts/{video_id}`

`POST` decide el veredicto del vídeo con la política guardada y los ajustes de `/settings/live`:
1. Reglas fijas (`apply_rules`): si aplican, `source: "rule"` sin llamar al modelo.
2. Caché de la ablación (`verdicts`, clave `video_id`/judge/model/`config`/`policy_version`).
3. Si no, espera como mucho 8 s (`LIVE_WAIT_S`) a los niveles asíncronos que pide la config (L2, L4; fuerza el lote de canales) y llama al juez (2 reintentos). Si siguen pendientes decide con lo que haya y guarda el veredicto como `<config>~partial` (la ablación no lo lee); la siguiente petición con los niveles completos vuelve a llamar.

`GET` devuelve la regla o el último veredicto en caché (completo o parcial) sin llamar a nadie; `404` si no hay.

```json
{
  "video_id": "...", "revealed": true, "reveal": "after_label",
  "label": "LIBRE", "confidence": 0.87, "probs": {"NO": 0.05, "LIMITADO": 0.08, "LIBRE": 0.87},
  "source": "model", "rule": null, "reason": null,
  "judge": "liquid/d1.2-ultra", "config": "D", "partial": false, "cached": false,
  "cost_usd": 0.0001, "latency_ms": 900, "policy_version": "5-1a2b3c4d",
  "gate": {"action": "allow", "label": "LIBRE", "low_confidence": false,
           "source": "model", "rule": null, "confidence": 0.87}
}
```
- `source` ∈ `rule | model`; con `rule`, `rule` ∈ `channel_list | block_live | block_ai_labeled` y `reason` lo explica.
- `gate` (bloqueo en Firefox, PLAN-FASE2 H1): **siempre presente**, aunque el veredicto esté oculto (`revealed: false`). `action` ∈ `block | limit | allow` (NO / LIMITADO / LIBRE). `label` es la etiqueta efectiva: un veredicto del **modelo** con `confidence < min_confidence` (de `/settings/live`) pasa a `LIMITADO` con `low_confidence: true` (nunca LIBRE por duda). Las reglas fijas no tienen umbral. `source`, `rule` y `confidence` sirven para explicar el bloqueo (la extensión traduce el motivo).
- Con el bloqueo activo (`/settings/enforcement` `mode: "soft"`) cada `POST`/`GET` cuenta como veredicto visto (`verdict_exposures`): el gate actúa según él, así que una etiqueta posterior queda con `verdict_seen_before_label`.
- `revealed: false` (con `reveal: "after_label"` y el vídeo sin etiquetar): `label`, `confidence`, `probs`, `source`, `rule` y `reason` van a `null`. Tras etiquetar, `GET` lo devuelve visible.
- `cost_usd`: coste de esta petición (0 si viene de caché o de una regla).
- `404` sin ficha, `503` si falta la clave del juez (solo `POST`), `502` si el juez falla.

## `GET /settings/live`, `PUT /settings/live`
`{"judge": "liquid/d1.2-ultra", "config": "D", "reveal": "after_label", "min_confidence": 0.6}` (valores por defecto; tabla `settings`). `judge`: clave de `GET /judges`; `config`: `A`–`F` (sin `+L0`); `reveal` ∈ `after_label | always`; `min_confidence` ∈ [0, 1], umbral del gate. `PUT` con el objeto completo; `422` si algo no es válido. Bajar `min_confidence` o cambiar `judge`/`config` es **relajar** (ver «Candado»).

## Bloqueo en Firefox (PLAN-FASE2 H1/H2)

### `GET /settings/enforcement`, `PUT /settings/enforcement`
`{"mode": "off", "service_timeout_s": 6.0, "decision_timeout_s": 45.0, "block_shorts_feed": true}` (por defecto).
- `mode`: `off` (solo etiquetado) o `soft` (el gate pausa cada vídeo con la capa «Decidiendo…» hasta el veredicto; NO → pantalla de bloqueo; LIMITADO → cupo; LIBRE → se ve). El cohete del onboarding lo pone en `soft`.
- `service_timeout_s` (1–30): si el servicio no responde en ese tiempo, el vídeo queda bloqueado (fail-closed). `decision_timeout_s` (5–180): tiempo máximo con «Decidiendo…» (ficha + juez); al pasarlo, bloqueo con «Reintentar».
- `block_shorts_feed`: bloquear el feed de Shorts en scroll (navegación SPA de un Short a otro distinto, `extension/src/enforce/shorts-scroll.ts`). Un Short al que se llega desde otra página o con carga completa se evalúa como cualquier vídeo.
- Pasar a `off` o permitir el feed de Shorts es relajar.

### Cupo diario de LIMITADO: `GET /quota/today`, `POST /quota/heartbeat`
Día local del sistema (Europe/Madrid en el PC del usuario); a medianoche empieza un cupo nuevo. Reglas (`app/quota/rules.py`):
- Cupo `daily_minutes` (30 por defecto, `GET/PUT /settings/quota` `{"daily_minutes": 30}`; subirlo es relajar).
- Gracia: si el latido que agota el cupo es de un vídeo al que le quedan < 10 min, ese vídeo tiene 10 min más (una vez al día).
- Vídeos ≥ 1 h: al agotarse el cupo se guarda la posición (`quota_resume`) y se retoma otro día (`resume_at_s`).
- Cada latido cuenta como mucho 30 s.

`GET /quota/today?video_id=<id>&duration_s=<s>&position_s=<s>` (los tres opcionales) y `POST /quota/heartbeat` `{"video_id": "...", "seconds": 15, "duration_s": 3600, "position_s": 1500}` (la extensión lo manda cada ~15 s mientras un vídeo LIMITADO se reproduce en la pestaña visible) responden:
```json
{"day": "2026-11-21", "daily_s": 1800, "used_s": 600, "remaining_s": 1200, "exhausted": false,
 "grace_video": null,
 "video": {"allowed": true, "state": "ok", "grace_remaining_s": 0, "resume_at_s": null}}
```
`video.state` ∈ `ok | grace | exhausted | resume_tomorrow`; `video` es `null` sin `video_id`. Consultar no guarda posiciones; solo el latido.

### `GET /settings/ui`, `PUT /settings/ui`
`{"language": "es" | "en" | "ca" | null}`: idioma elegido en la web local; el background de la extensión lo copia cada minuto para el panel y las pantallas de bloqueo.

## Candado (`/lock/*`, PLAN-FASE2 §6, H3)

Contraseña del custodio: solo el hash **argon2id** (`argon2-cffi`) en `settings` (clave `lock`); nunca sale por la API.

- `GET /lock/status` → `{"password_set": true, "custodian": "Ana", "created_at": "...", "relax_delay_hours": 0, "session": {"expires_at": 1764000000.0, "csrf": "..."} | null, "retry_after_s": 0}`.
- `POST /lock/setup` `{"custodian", "password", "password_confirm", "relax_delay_hours": 0}`: solo si aún no hay contraseña (`409` si ya existe); `422` si no coinciden o tiene < 8 caracteres. Abre sesión.
- `POST /lock/login` `{"password"}` → abre sesión: cookie `bs_admin` `HttpOnly; SameSite=Strict; Max-Age=600` (10 min) y `session.csrf` en el JSON. `401` contraseña incorrecta, `429` (+ `Retry-After`) tras 3 fallos seguidos: espera de 2 s que se dobla en cada fallo (tope 15 min; persiste entre reinicios).
- `POST /lock/logout`; `POST /lock/password` `{"password", "password_confirm"}` (siempre con sesión + CSRF; cierra las demás sesiones).
- `PUT /lock/settings` `{"relax_delay_hours": 0..168}`: espera opcional para relajar (desactivada por defecto). Acortarla es relajar.
- `GET /lock/requests` (aplica las vencidas y devuelve las 20 últimas) y `POST /lock/requests/{id}/cancel` (sin contraseña: cancelar endurece).

**Endurecer vs relajar** (`app/lock/classify.py`). Con contraseña creada, todo cambio que relaja exige sesión de administrador **y** la cabecera `X-CSRF-Token` (`401` sin sesión, `403` con CSRF incorrecto); endurecer nunca la pide. Relajar es:
- política: sacar un canal de NO, pasar de LIMITADO a LIBRE, añadir a LIBRE o sacar de LIMITADO sin ir a NO; quitar una web bloqueada; desactivar una regla fija; **cualquier edición** de instrucciones, descripciones o preguntas auxiliares (conservador: no se sabe si permite más);
- `/settings/live`: bajar `min_confidence`, cambiar juez o niveles; `/settings/enforcement`: `mode` → `off`, `block_shorts_feed` → `false`; `/settings/quota`: subir el cupo; `/lock/settings`: acortar la espera.

Con espera configurada, un cambio que relaja (y ya pasó la contraseña) no se aplica: responde `202 {"deferred": true, "request": {"id", "kind", "summary", "apply_after", "status": "pending", ...}}` y se aplica al vencer (tarea cada minuto). Una solicitud de política solo se aplica si la política no cambió desde entonces; si no, queda `conflict`.

## Web local
El servicio sirve el onboarding y el panel en `http://127.0.0.1:8765/` (el bundle `service/app/web/static/`, generado por `extension/build.mjs`; `index.html` con `Cache-Control: no-cache`). Las rutas de la API tienen prioridad. Sin bundle, `/` responde `503` con la instrucción para construirlo.

## `GET /labels/stats`
`{"total": 0, "by_label": {"NO": 0, "LIMITADO": 0, "LIBRE": 0}, "by_split": {"dev": 0, "test": 0}, "shorts": 0, "with_transcript": 0}`

## `GET /health`
`{"status": "ok"}`

## Política y perfil (`/policy*`, `/judges`)

Los usa la web local (onboarding y panel, antes la página de opciones de la extensión). La política es `policy/policy.yaml` (PLAN §8); su parte editable (`PolicyContent`) es:

```json
{
  "question": {
    "id": "tier", "type": "choice", "instructions": "...",
    "options": {"NO": {"description": "..."}, "LIMITADO": {"description": "..."}, "LIBRE": {"description": "..."}}
  },
  "auxiliary_questions": [{"id": "is_gaming", "type": "boolean", "instructions": "¿...?"}],
  "channel_lists": {"NO": [], "LIMITADO": ["Atrioc"], "LIBRE": ["Fireship"]},
  "rules": {"block_ai_labeled": false, "block_live": false},
  "blocked_sites": ["reddit.com", "twitch.tv"]
}
```

`rules` (por defecto todo `false`; opcional al enviar) son reglas fijas como `channel_lists`: dan el veredicto antes del modelo en producción (`app.rules.apply_rules`) y **no** se aplican en la ablación ni en `/policy/evaluate`. `block_ai_labeled`: NO si `metadata.ai_disclosure.labeled`. `block_live`: NO si `live.is_live_now` o `live.is_upcoming` (las grabaciones de directos las decide el modelo). Orden: lista NO de canales → `block_live` → `block_ai_labeled` → listas LIMITADO/LIBRE (un interruptor «No a…» gana a un canal en LIBRE). Claude (draft/refine/refresh/edit) nunca cambia `rules`: se conservan de la política de partida.

`blocked_sites` (por defecto `[]`; opcional al enviar): webs que la **extensión** bloquea enteras (dominio y subdominios), fuera de YouTube. No pasan por el juez ni por la ablación, y Claude nunca las cambia (como `rules`). El servicio normaliza cada entrada al dominio desnudo (`https://www.Reddit.com/r/x` → `reddit.com`: sin esquema, ruta, puerto, usuario ni `www.`; minúsculas; sin duplicados) y responde `422` si alguna no es un dominio válido (al menos dos etiquetas, TLD alfabético o punycode; las IP no valen). La extensión aplica la misma regla (`extension/src/sites.ts`) y además rechaza dominios de YouTube. En el YAML se escriben en una línea: `blocked_sites: [reddit.com, twitch.tv]`.

### `GET /policy`
`{"version": 3, "policy_version": "3-424f6405", "content": PolicyContent, "yaml": "texto del fichero"}`

`policy_version` = `<model_version>-<sha256[:8]>` es la clave de la caché de veredictos. El hash cubre **solo lo que lee el modelo** (pregunta: id, instrucciones y descripciones de las opciones; preguntas auxiliares), en JSON canónico sin espacios extremos: ni `channel_lists`, ni `blocked_sites`, ni `rules`, ni comentarios o formato del YAML lo cambian. `model_version` (campo del YAML, lo escribe el guardado) es la versión en la que cambió por última vez esa parte; un fichero sin él usa `version`. Así, guardar listas o webs sube `version` pero conserva `policy_version` y la caché. Al arrancar, el servicio renombra una vez las claves antiguas (`<version>-<hash del fichero entero>`) de la política actual y de `policy/history/` (`app/policy_migration.py`); los candidatos evaluados que nunca se guardaron quedan sin migrar.

### `PUT /policy`
Cuerpo: exactamente uno de `{"content": PolicyContent}` o `{"yaml": "..."}` (modo avanzado; su `version` se ignora), más `"expected_version"` opcional y `"incorporate": [{"video_id": "...", "labeled_at": "..."}]` opcional (el `feedback` de `POST /policy/refresh`: esas etiquetas se marcan como incorporadas con la versión nueva; solo cuentan las del split dev cuyo `labeled_at` no haya cambiado).
Respuesta: como `GET /policy` más `"incorporated": N`.
- Sube `version`, archiva la anterior en `policy/history/v<N>.yaml` y escribe de forma atómica. Antes de escribir valida con el modelo `Policy` y comprueba el round-trip; las claves `NO`/`LIBRE` (y valores como `no`) van entre comillas.
- `200` con lo mismo que `GET /policy`. `409` si `expected_version` no coincide con la versión en disco. `422` si el YAML o el contenido no son válidos.
- Con contraseña creada, un cambio que relaja (ver «Candado») exige sesión de administrador (`401`/`403`) o, con espera, responde `202`.
- Los pasos «Canales» y «Bloquear webs extra» y el botón «📌 Canal» del panel de YouTube hacen lectura-modificación-escritura: `GET /policy`, cambian solo `channel_lists` o `blocked_sites` y `PUT` con `expected_version`; ante un `409` releen y reintentan (hasta 3 veces).

### `GET /policy/history`
`[{"version": 3, "file": "v3.yaml", "saved_at": "2026-11-21T18:00:00+00:00"}]` (más reciente primero).

### `POST /policy/draft`
`{"preferences": {"libre": "...", "limitado": "...", "no": "...", "examples": {"libre": "", "limitado": "", "no": ""}}}` → Claude (`POLICY_AUTHOR_MODEL`, por defecto `claude-sonnet-5-5`, salida estructurada) redacta un borrador.
Respuesta: `{"content": PolicyContent, "rationale": "...", "usage": {"model": "...", "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}}`. Conserva `channel_lists` de la política actual. No guarda nada.
`422` si las preferencias están vacías, `503` sin `ANTHROPIC_API_KEY`, `502` si Claude rechaza o devuelve algo inutilizable.

### `POST /policy/evaluate`
`{"content": PolicyContent, "judge": "liquid/d1.2" | null, "config": "D", "dry_run": true}`. Evalúa un candidato **sin guardar** sobre las etiquetas del split **`dev`** (nunca `test`, reservado para la ablación final). `judge` por defecto: el más barato con clave configurada.
- El candidato lleva el `policy_version` que tendría al guardarse, así que la caché de veredictos sirve entre evaluaciones y después de guardar.
- `dry_run: true`: solo estimación. `dry_run: false`: llama al juez (concurrencia y reintentos de la ablación).
- Si hay menos de 10 etiquetas dev, `enough_labels: false` y no se llama a nadie.

```json
{
  "split": "dev", "policy_version": "4-bacbb623", "judge": "liquid/d1.2", "config": "D",
  "n_dev": 42, "min_labels": 10, "enough_labels": true,
  "calls": 30, "cached": 12, "est_tokens": 51000, "est_cost_usd": 0.001,
  "n": 42, "accuracy": 0.81, "macro_f1": 0.78, "false_libre": 2, "false_libre_rate": 0.07,
  "failures": 0, "new_calls": 30, "cost_usd": 0.0011,
  "errors": [{"video_id": "...", "title": "...", "channel": "...", "url": "https://www.youtube.com/watch?v=...",
              "truth": "NO", "predicted": "LIBRE", "confidence": 0.74}]
}
```
En `dry_run` los campos de resultados (`n`, `accuracy`…) van a cero/`null`. `errors` va ordenado: falsos LIBRE primero, luego por confianza. `400` si el juez o la config no existen; `503` si falta la clave del juez (solo sin `dry_run`).

### `POST /policy/refine`
`{"draft": PolicyContent, "errors": [{"video_id": "...", "predicted": "LIBRE", "confidence": 0.74}], "config": "D", "preferences": {...} | null, "snapshot": {"n": 42, "accuracy": 0.81, "false_libre": 2} | null}`.
El servicio resume las fichas (mismos niveles que `config`) y toma la etiqueta real de la base de datos; ignora vídeos que no estén en `dev` o que no sean errores. Envía a Claude como mucho 25 (falsos LIBRE primero).
Respuesta: como `/policy/draft` más `"changelog": ["..."]`. `422` si no queda ningún error dev válido.

### `POST /policy/edit`
`{"policy": PolicyContent, "instruction": "quita lo de Fireship"}` → Claude aplica solo esa instrucción (puede tocar `channel_lists`). No guarda nada.
Respuesta: `{"content": PolicyContent, "changelog": "una frase", "usage": {...}}`. `422` si la instrucción está vacía, `503` sin clave, `502` si Claude falla.

### Recalibración: `GET /policy/feedback` y `POST /policy/refresh`
Cada etiqueta (con su «motivo») queda **pendiente** hasta que se incorpora a la política (tabla `policy_feedback`; re-etiquetar un vídeo lo vuelve a dejar pendiente). Solo el split **dev** alimenta la recalibración; las pendientes de test solo se cuentan.

`GET /policy/feedback` (`?items=false` omite la lista; lo usa el panel):
```json
{
  "split": "dev", "pending": 12, "by_label": {"NO": 8, "LIMITADO": 3, "LIBRE": 1},
  "with_reason": 2, "pending_test": 7, "hint_threshold": 20,
  "items": [{"video_id": "...", "title": "...", "channel": "...", "label": "LIMITADO",
             "reason": "añade este canal a los limitados", "is_short": false, "labeled_at": "..."}]
}
```
`items`: solo dev, más recientes primero.

`POST /policy/refresh` `{"config": "D"}` (opcional; niveles de la ficha que se resumen) → Claude propone una política revisada a partir de la vigente y de las etiquetas dev pendientes (como mucho 60: primero las que tienen motivo, que se tratan como criterios explícitos; luego las más recientes). No guarda.
Respuesta: como `/policy/refine` más `"base_version": 3` y `"feedback": [{"video_id": "...", "labeled_at": "..."}]` (lo que hay que mandar en `incorporate` al guardar). `422` si no hay pendientes dev.

### `GET /judges`
```json
{
  "judges": [{"key": "liquid/d1.2", "key_env": "LIQUID_API_KEY", "key_configured": true,
              "input_per_mtok": 0.02, "output_per_mtok": 0.0}],
  "default_judge": "liquid/d1.2",
  "configs": [{"id": "D", "levels": "L1+L2+L3"}],
  "default_config": "D"
}
```
Nunca incluye el valor de las claves, solo si están configuradas.

## CORS
Solo se permite el origen de la extensión (`moz-extension://<uuid>`). Como el UUID es por instalación, el servicio acepta cualquier `moz-extension://` origin (regex) y nada más. Las peticiones salen del content script vía background/`fetch` con host permission a `http://127.0.0.1/*` (solo `/health`, `/fichas`, `/labels`, `/verdicts/{id}`, el resumen de `/policy/feedback`, `GET`/`PUT /policy` para fijar canales, `GET /settings/enforcement`, `GET /settings/ui`, `GET /quota/today` y `POST /quota/heartbeat`; el background además lee cada minuto `GET /policy` para `blocked_sites` y los ajustes de bloqueo e idioma). La web local es del mismo origen que la API (sin CORS); la cookie de sesión es `SameSite=Strict`, así que nunca viaja en peticiones de la extensión. Métodos permitidos: `GET`, `POST`, `PUT`.

## Estado local de la extensión (`browser.storage.local`) y de la web (`localStorage`)
La web local guarda `uiLanguage`, `setupState` y `profileWizard` en el `localStorage` de `http://127.0.0.1:8765` (`extension/src/platform/storage.ts`); la primera vez que el lanzador de la extensión abre la web le pasa su `setupState` (`?setup=`, sin `launched`). En la extensión (por perfil de Firefox):
- `enforcement`: copia de `/settings/enforcement` (el gate decide si bloquear cuando el servicio no responde: con `mode: "soft"` bloquea; sin copia, no). También la lee `early-hold.js` (`document_start`) para pausar el vídeo antes de que cargue `content.js`.
- `uiLanguage`: `"en" | "es" | "ca"` (panel, pantallas de bloqueo y lanzador; se copia de `/settings/ui`).
- `blockedSites`: copia de `blocked_sites` que usa el background para bloquear aunque el servicio esté apagado.
- `setupState`: `{"policySaved": bool, "sitesReviewed": bool, "launched": bool, "light": {"manual": 0..1, "agentic": 0..1}}`. `setup_complete` = `policySaved && sitesReviewed` (desbloquea el cohete).
- `profileWizard`: textos y borrador del asistente (ya existía).
