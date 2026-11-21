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

## CORS
Solo se permite el origen de la extensión (`moz-extension://<uuid>`). Como el UUID es por instalación, el servicio acepta cualquier `moz-extension://` origin (regex) y nada más. Las peticiones salen del content script vía background/`fetch` con host permission a `http://127.0.0.1/*`.
