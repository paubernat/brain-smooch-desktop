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
    "game": null
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
Respuesta `200` `{"video_id": "...", "label": "...", "reason": "...", "split": "dev|test", "labeled_at": "..."}`.
`404` si la ficha no existe. Re-etiquetar actualiza label/reason pero conserva el `split`.

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
  "channel_lists": {"NO": [], "LIMITADO": ["Atrioc"], "LIBRE": ["Fireship"]}
}
```

### `GET /policy`
`{"version": 3, "policy_version": "3-424f6405", "content": PolicyContent, "yaml": "texto del fichero"}`

### `PUT /policy`
Cuerpo: exactamente uno de `{"content": PolicyContent}` o `{"yaml": "..."}` (modo avanzado; su `version` se ignora), más `"expected_version"` opcional.
- Sube `version`, archiva la anterior en `policy/history/v<N>.yaml` y escribe de forma atómica. Antes de escribir valida con el modelo `Policy` y comprueba el round-trip; las claves `NO`/`LIBRE` (y valores como `no`) van entre comillas.
- `200` con lo mismo que `GET /policy`. `409` si `expected_version` no coincide con la versión en disco. `422` si el YAML o el contenido no son válidos.

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
Solo se permite el origen de la extensión (`moz-extension://<uuid>`). Como el UUID es por instalación, el servicio acepta cualquier `moz-extension://` origin (regex) y nada más. Las peticiones salen del content script vía background/`fetch` con host permission a `http://127.0.0.1/*`; la página de opciones (también `moz-extension://`) hace `fetch` directamente. Métodos permitidos: `GET`, `POST`, `PUT`.
