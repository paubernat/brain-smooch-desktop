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
  "cost_usd": 0.0001, "latency_ms": 900, "policy_version": "5-1a2b3c4d"
}
```
- `source` ∈ `rule | model`; con `rule`, `rule` ∈ `channel_list | block_live | block_ai_labeled` y `reason` lo explica.
- `revealed: false` (con `reveal: "after_label"` y el vídeo sin etiquetar): `label`, `confidence`, `probs`, `source`, `rule` y `reason` van a `null`. Tras etiquetar, `GET` lo devuelve visible.
- `cost_usd`: coste de esta petición (0 si viene de caché o de una regla).
- `404` sin ficha, `503` si falta la clave del juez (solo `POST`), `502` si el juez falla.

## `GET /settings/live`, `PUT /settings/live`
`{"judge": "liquid/d1.2-ultra", "config": "D", "reveal": "after_label"}` (valores por defecto; tabla `settings`). `judge`: clave de `GET /judges`; `config`: `A`–`F` (sin `+L0`); `reveal` ∈ `after_label | always`. `PUT` con el objeto completo; `422` si algo no es válido.

## `GET /labels/stats`
`{"total": 0, "by_label": {"NO": 0, "LIMITADO": 0, "LIBRE": 0}, "by_split": {"dev": 0, "test": 0}, "shorts": 0, "with_transcript": 0}`

## `GET /health`
`{"status": "ok"}`

## Política y perfil (`/policy*`, `/judges`)

Los usa la página de opciones de la extensión («Configura tu perfil»). La política es `policy/policy.yaml` (PLAN §8); su parte editable (`PolicyContent`) es:

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

### `PUT /policy`
Cuerpo: exactamente uno de `{"content": PolicyContent}` o `{"yaml": "..."}` (modo avanzado; su `version` se ignora), más `"expected_version"` opcional y `"incorporate": [{"video_id": "...", "labeled_at": "..."}]` opcional (el `feedback` de `POST /policy/refresh`: esas etiquetas se marcan como incorporadas con la versión nueva; solo cuentan las del split dev cuyo `labeled_at` no haya cambiado).
Respuesta: como `GET /policy` más `"incorporated": N`.
- Sube `version`, archiva la anterior en `policy/history/v<N>.yaml` y escribe de forma atómica. Antes de escribir valida con el modelo `Policy` y comprueba el round-trip; las claves `NO`/`LIBRE` (y valores como `no`) van entre comillas.
- `200` con lo mismo que `GET /policy`. `409` si `expected_version` no coincide con la versión en disco. `422` si el YAML o el contenido no son válidos.
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
Solo se permite el origen de la extensión (`moz-extension://<uuid>`). Como el UUID es por instalación, el servicio acepta cualquier `moz-extension://` origin (regex) y nada más. Las peticiones salen del content script vía background/`fetch` con host permission a `http://127.0.0.1/*` (solo `/health`, `/fichas`, `/labels`, `/verdicts/{id}`, el resumen de `/policy/feedback` y `GET`/`PUT /policy` para fijar canales; el background además lee `GET /policy` cada minuto para `blocked_sites`); la página de opciones (también `moz-extension://`) hace `fetch` directamente. Métodos permitidos: `GET`, `POST`, `PUT`.

## Estado local de la extensión (`browser.storage.local`)
No pasa por el servicio; es por perfil de Firefox.
- `uiLanguage`: `"en" | "es" | "ca"` (página de perfil, página de bloqueo y el control 📌 del panel).
- `blockedSites`: copia de `blocked_sites` que usa el background para bloquear aunque el servicio esté apagado.
- `setupState`: `{"policySaved": bool, "sitesReviewed": bool, "launched": bool, "light": {"manual": 0..1, "agentic": 0..1}}`. `setup_complete` = `policySaved && sitesReviewed` (desbloquea el cohete).
- `profileWizard`: textos y borrador del asistente (ya existía).
