# brain-smooch-desktop — Plan de la prueba: extracción de fichas + ablación

> Documento para Claude Code. Repo nuevo, , independiente de Brain-Smooch (Android).
> Entorno: **Windows 11 + Firefox**. Todo corre en local; lo único externo son las llamadas a los modelos y a la YouTube Data API.

---

## 0. Reglas del repo (leer antes de nada)

- **Commits y PRs a nombre del autor.** No mencionar a Claude, no añadir `Co-Authored-By`, ni "Generated with" ni ninguna atribución similar en commits, PRs o código.
- Secretos solo en `.env` (ignorado por git). Hay que dejar un `.env.example` sin valores.
- Nada de AWS, Azure, GCP ni otros clouds. El servicio escucha solo en `127.0.0.1`.
- Código e identificadores en inglés; comentarios y documentación pueden ir en español.

---

## 1. Objetivo de esta prueba

Antes de construir el bloqueador, responder con datos a una pregunta: **¿qué información necesita un modelo de decisión para clasificar bien un vídeo de YouTube en mis tres niveles (NO / LIMITADO / LIBRE)?**

Para ello:
1. Una extensión de Firefox extrae una **ficha** de cada vídeo que abro, por niveles de información, y me deja **etiquetarlo** con un clic.
2. Un servicio local guarda fichas y etiquetas.
3. Un script de **ablación** pasa el conjunto etiquetado por varios modelos de decisión con distintas combinaciones de niveles y genera un informe: acierto, errores graves, calibración, coste y latencia.

**Fuera de alcance en esta prueba:** bloquear nada, cupos de tiempo, candado/contraseña, hosts, políticas del navegador, servicio de Windows. Eso viene después (ver §11).

---

## 2. Los tres niveles de veredicto

| Nivel | Significado |
|---|---|
| `NO` | Bloqueado siempre. |
| `LIMITADO` | Entretenimiento permitido con cupo de tiempo diario. |
| `LIBRE` | Formativo o de calidad; tiempo ilimitado (con aviso si hay scroll de Shorts). |

Ante la duda, el sistema final irá a `LIMITADO`, nunca a `LIBRE`.

---

## 3. Niveles de información de la ficha

| Nivel | Contenido | Fuente | Coste |
|---|---|---|---|
| **L0** Memoria | Historial de veredictos del canal (conteo por nivel) | SQLite local | 0 |
| **L1** Metadatos | Título, descripción limpia, tags (`keywords`), categoría, duración, `is_short`, capítulos, nombre de canal | Player response de la propia página | 0 |
| **L2** Canal | Descripción del canal, `topicDetails` (categorías de tema que asigna YouTube), keywords del canal | YouTube Data API `channels.list` (`part=snippet,topicDetails,brandingSettings`, hasta 50 IDs por llamada, 1 unidad de cuota) | 0 (cuota gratuita) |
| **L3** Transcripción | ~2.000 caracteres muestreados (inicio + ventanas repartidas) | Pistas de subtítulos del player response | 0 |
| **L4** Visual | Miniatura + 6 fotogramas del storyboard | URLs del storyboard del player response | Tokens de imagen |

En la prueba **se extraen todos los niveles siempre**; la ablación decide cuáles merecen la pena. En la versión final se añadirán de forma escalonada (solo si la confianza no llega al umbral).

---

## 4. Stack

- **Extensión:** TypeScript, WebExtensions (Firefox, Manifest V3), build con `esbuild`, desarrollo con `web-ext run`.
- **Servicio:** Python 3.12, `uv`, FastAPI + Uvicorn, SQLite (`sqlite3` o SQLModel), `httpx`, `Pillow`, `pydantic`, `PyYAML`.
- **Ablación / informe:** Python, `pandas`, `scikit-learn` (métricas), salida en Markdown + HTML estático.
- **Tests:** `pytest` (servicio), `vitest` (parsers de la extensión).

---

## 5. Estructura del repo

```
brain-smooch-desktop/
├── README.md
├── PLAN.md
├── .env.example
├── extension/
│   ├── manifest.json
│   ├── src/
│   │   ├── content.ts          # mundo aislado: detecta navegación, UI de etiquetado, habla con el servicio
│   │   ├── page-bridge.ts      # mundo de la página: lee el player response y lo devuelve por postMessage
│   │   ├── extract/
│   │   │   ├── metadata.ts     # L1
│   │   │   ├── captions.ts     # L3
│   │   │   └── storyboard.ts   # L4 (parseo del spec → URLs de sprites)
│   │   ├── ui/label-panel.ts   # panel flotante NO / LIMITADO / LIBRE
│   │   └── api.ts              # cliente del servicio local
│   └── test/
├── service/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py             # FastAPI
│   │   ├── db.py               # esquema SQLite
│   │   ├── models.py           # Ficha, Label, Verdict (pydantic)
│   │   ├── enrich/
│   │   │   ├── channel.py      # L2: YouTube Data API, en lote y con caché
│   │   │   ├── description.py  # limpieza de descripción
│   │   │   ├── transcript.py   # muestreo de transcripción
│   │   │   └── frames.py       # L4: descarga sprites y recorta fotogramas
│   │   └── judges/
│   │       ├── base.py         # interfaz Judge
│   │       ├── liquid.py       # Liquid d1.2-ultra / d1.2
│   │       ├── openai_decisions.py
│   │       └── sonnet.py       # OPCIONAL, solo para experimentos
│   └── tests/
├── policy/
│   └── policy.yaml             # esquema de decisión (pregunta + opciones + ejemplos)
├── eval/
│   ├── ablation.py             # ejecuta configuraciones × modelos
│   ├── metrics.py
│   ├── report.py               # genera eval/reports/<fecha>.md y .html
│   └── reports/
└── data/                       # SQLite + fotogramas en caché (ignorado por git)
```

---

## 6. Componente 1 — Extensión de Firefox

### 6.1 Manifest
- MV3 con `browser_specific_settings.gecko.id` fijo (necesario para firmar e instalar de forma permanente).
- Permisos: `storage`. Host permissions: `*://*.youtube.com/*`, `*://*.ytimg.com/*`, `http://127.0.0.1/*`.
- Content script en `*://www.youtube.com/*` con `run_at: document_idle`.

### 6.2 Leer el player response (mundo de la página)
Los content scripts corren en un mundo aislado y no ven las variables de la página. Usar un script inyectado en el mundo de la página (`page-bridge.ts`) que responde por `window.postMessage`:
- **Carga inicial:** `window.ytInitialPlayerResponse`.
- **Navegación sin recarga (SPA):** escuchar el evento `yt-navigate-finish`. El `ytInitialPlayerResponse` se queda desfasado; leer el player response actual con `document.getElementById('movie_player')?.getPlayerResponse?.()` y comprobar que `videoDetails.videoId` coincide con el `v` de la URL.
- **Shorts** (`/shorts/<id>`): el reproductor es otro. Verificar empíricamente de dónde sacar el player response (p. ej. `#shorts-player`); si no hay forma fiable, como alternativa interceptar las respuestas de `/youtubei/v1/player` y `/youtubei/v1/reel/*` desde el mundo de la página (envolver `fetch`/XHR) y cachearlas por `videoId`.
- Alternativa en Firefox: `window.wrappedJSObject` desde el content script. Elegir la opción más robusta y documentarla.

### 6.3 Extracción L1 (`extract/metadata.ts`)
Desde el player response:
- `videoDetails`: `videoId`, `title`, `shortDescription` (es la descripción completa), `keywords`, `lengthSeconds`, `channelId`, `author`.
- `microformat.playerMicroformatRenderer`: `category`, `publishDate`, `isFamilySafe`.
- `is_short`: por URL `/shorts/` o duración ≤ 180 s con formato vertical (documentar el criterio).
- Capítulos: si están en la descripción (líneas `mm:ss Título`), parsearlos.
- Juego asociado (vídeos de gaming): si aparece en la página, extraerlo. Opcional, best-effort.

### 6.4 Extracción L3 (`extract/captions.ts`)
- `captions.playerCaptionsTracklistRenderer.captionTracks[]`. Preferencia: idioma del vídeo, después `es`, después `en`; manual antes que automática (`kind: "asr"`).
- Descargar `baseUrl + "&fmt=json3"` desde el contexto de la página y convertir a texto con marcas de tiempo.
- **Riesgo a validar primero (spike):** YouTube puede exigir un token adicional (`pot`) en las peticiones de subtítulos. Si la descarga directa falla, alternativas por orden: (a) capturar la petición `timedtext` que hace el propio reproductor al activar subtítulos; (b) delegar en el servicio con `youtube-transcript-api`. Registrar en la ficha `transcript_status`: `ok | none | blocked`.
- Enviar la transcripción completa al servicio; el muestreo se hace allí.

### 6.5 Extracción L4 (`extract/storyboard.ts`)
- `storyboards.playerStoryboardSpecRenderer.spec`: cadena con una URL plantilla y varios niveles separados por `|` (ancho, alto, nº de fotogramas, columnas, filas, intervalo, nombre, firma). Parsear, elegir el nivel de mayor resolución y generar las URLs de los sprites (sustituyendo `$L` y `$N` y añadiendo `sigh`).
- Verificar el formato contra varios vídeos reales y cubrir el parser con tests usando specs reales guardados como fixtures.
- Enviar al servicio: URLs de sprites + geometría + URL de la miniatura (`maxresdefault`/`hqdefault`). El recorte se hace en el servicio.

### 6.6 Panel de etiquetado (`ui/label-panel.ts`)
Panel flotante y discreto en la página de vídeo y de Shorts:
- Botones **NO / LIMITADO / LIBRE** y un campo de texto opcional "motivo".
- Indicador de estado de la ficha (L1 ✓, L2 ✓, L3 ok/none/blocked, L4 ✓).
- Atajos de teclado (p. ej. `Alt+1/2/3`).
- Al etiquetar: `POST /labels`. Si el vídeo ya tiene etiqueta, mostrarla y permitir cambiarla.

### 6.7 Flujo
1. Detectar el vídeo → extraer L1, L3 y L4 → `POST /fichas` (idempotente por `videoId`).
2. El servicio completa L2 y prepara L3 y L4.
3. Yo etiqueto con el panel.

### 6.8 Desarrollo e instalación en Firefox
- Desarrollo: `web-ext run` (instalación temporal).
- Instalación permanente en Firefox normal: la extensión **tiene que estar firmada por Mozilla**. Usar la firma "unlisted" de AMO (`web-ext sign --channel=unlisted`, con claves de API de AMO en `.env`). Documentarlo en el README.

---

## 7. Componente 2 — Servicio local

### 7.1 Endpoints (`127.0.0.1:8765`)
- `POST /fichas` — recibe los datos crudos de la extensión, guarda y lanza el enriquecimiento.
- `GET /fichas/{video_id}` — ficha completa con el estado de cada nivel.
- `POST /labels` — `{video_id, label, reason?}`.
- `GET /labels/stats` — conteo por clase y por dificultad.
- `GET /health`.
- CORS restringido al origen de la extensión.

### 7.2 Esquema SQLite (mínimo)
- `videos(video_id PK, channel_id, title, description_raw, description_clean, keywords_json, category, duration_s, is_short, chapters_json, transcript_raw, transcript_status, storyboard_json, thumbnail_url, created_at)`
- `channels(channel_id PK, title, description, topic_categories_json, keywords, fetched_at)`
- `labels(video_id PK, label, reason, labeled_at, split)` — `split` ∈ `dev|test`, se asigna al etiquetar (60/40, estratificado por clase).
- `verdicts(id PK, video_id, judge, model, config, label, probs_json, confidence, input_tokens, cost_usd, latency_ms, policy_version, created_at)`
- `frames(video_id, idx, path)` — fotogramas recortados en `data/frames/`.

### 7.3 L2 — Canal (`enrich/channel.py`)
- Cola de `channel_id` nuevos; cada N segundos (o al llegar a 50) llamar a `channels.list` con `part=snippet,topicDetails,brandingSettings`.
- Guardar `snippet.description`, `topicDetails.topicCategories` (URLs de Wikipedia → quedarse con el último segmento, p. ej. `Music`, `Video_game_culture`), `brandingSettings.channel.keywords`.
- Caché permanente; refrescar si tiene más de 30 días.
- Clave: `YOUTUBE_API_KEY` en `.env`.

### 7.4 Limpieza de descripción (`enrich/description.py`)
- Quitar URLs y tokens de redirección, pero **conservar el texto que acompaña a los enlaces** ("Chord Theory for R&B Piano: <url>" → "Chord Theory for R&B Piano"). Es señal útil.
- Quitar emojis decorativos repetidos, bloques de redes sociales ("FOLLOW ME", Instagram, X…) y líneas vacías.
- Limitar a ~1.500 caracteres.
- Tests con descripciones reales como fixtures (incluir la del ejemplo de §9.3).

### 7.5 Muestreo de transcripción (`enrich/transcript.py`)
- Presupuesto ~2.000 caracteres: los primeros ~800 + 4 ventanas de ~300 repartidas uniformemente, con su marca `[mm:ss]`.
- Si `transcript_status != ok`, el campo queda vacío y se indica explícitamente en la ficha ("sin transcripción").

### 7.6 Fotogramas (`enrich/frames.py`)
- Descargar los sprites del storyboard y recortar 6 fotogramas repartidos uniformemente (Pillow) + la miniatura.
- Reescalar a ≤ 512 px de lado largo, JPEG calidad 80, guardar en `data/frames/<video_id>/`.

---

## 8. Componente 3 — Política (`policy/policy.yaml`)

Esquema de decisión que leen los modelos. Versionado (`version` + hash). Estructura:

```yaml
version: 1
question:
  id: tier
  type: choice
  instructions: >
    Clasifica este vídeo de YouTube según cómo quiere usar YouTube su dueño:
    formación y música de calidad sin límite, algo de entretenimiento con cupo,
    y nada de contenido adictivo o de baja calidad.
  options:
    NO:
      description: >
        Videojuegos (en especial League of Legends), deportes (NBA y similares),
        Shorts de relleno de cualquier temática ("slop"), listas sensacionalistas de música
        tipo "TODAS LAS MELODÍAS DEL MUNDO", contenido de IA genérico o de bajo esfuerzo.
    LIMITADO:
      description: >
        Entretenimiento de creadores concretos que el usuario acepta con cupo de tiempo:
        commentary, humor, análisis ligero, vlogs. Si hay duda entre NO/LIMITADO/LIBRE, LIMITADO.
    LIBRE:
      description: >
        Música con sustancia: alguien tocando (piano, jazz) con los acordes o la partitura en pantalla,
        explicaciones de acordes, voicings, armonía o melodía, transcripciones, covers y tutoriales
        de cómo tocar temas. Técnico de calidad: arquitectura de software, tutoriales de Azure,
        IA explicada con rigor por fuentes con criterio. Shorts incluidos si cumplen esto.
auxiliary_questions:          # ayudan a depurar; no deciden el veredicto
  - {id: is_music_education, type: boolean}
  - {id: is_gaming, type: boolean}
  - {id: is_sports, type: boolean}
  - {id: is_low_effort_listicle, type: boolean}
channel_lists:                # reglas fijas; se aplican antes del modelo
  LIMITADO: [Atrioc, dunkey, Ludwig, The Yard, Good Work, Cheese Factory, Fireship, geopold, orslok]  # TODO: confirmar nombres y pasar a channel_id
  LIBRE: [DeepSeek]           # TODO: completar
  NO: []
examples:                     # few-shot, se pasan si el juez lo soporta
  - {video_id: ib6nIB-fbNE, label: LIBRE, note: "Short de acordes de piano R&B/jazz (Jeff Schneider)"}
  - {video_id: oyxs-4jk0Tg, label: LIBRE, note: "Short de música de calidad"}
```

Las listas de canales **no participan en la ablación** (se evalúa el modelo, no las reglas); solo se usan en la versión final.

---

## 9. Componente 4 — Jueces

### 9.1 Interfaz (`judges/base.py`)
```python
class Judge(Protocol):
    name: str
    supports_images: bool
    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict: ...
# Verdict: label, probs: dict[str, float], confidence: float,
#          aux: dict[str, Any], input_tokens: int, cost_usd: float, latency_ms: int, raw: dict
```
`FichaView` es la ficha **ya filtrada por la configuración de niveles** (p. ej. solo L1+L3). El juez no sabe qué se le ha quitado.

### 9.2 Adaptadores
- **`liquid.py`** — Liquid `d1.2-ultra` (y `d1.2` como variante barata). Implementar con la documentación oficial (docs.liquid.ai, sección Decision Models; claves en console.liquid.ai). Acepta texto e imágenes. Precio orientativo: 0,042 $/M tokens de entrada (d1.2-ultra), 0,02 $/M (d1.2), sin coste de salida.
- **`openai_decisions.py`** — OpenAI Decisions API (`POST /v1/decisions`, modelo `gpt-6-luna`). Implementar con la documentación oficial. Acepta texto e imágenes. Ojo: puede negarse a responder una pregunta y responder las demás; manejar respuestas ausentes. Precio orientativo: 0,10 $/M de entrada, sin coste de salida.
- **`sonnet.py`** — **Opcional, solo para experimentos.** Claude Sonnet con salida estructurada (JSON con label, probs, motivo). No forma parte del camino principal.
- Precios en un `pricing.yaml` editable, no en el código.
- **No inventar formatos de petición:** leer la documentación de cada proveedor y, si algo no cuadra, parar y preguntar.

### 9.3 Construcción del "state"
Serializar la ficha como JSON compacto y legible:
```json
{
  "video": {"title": "...", "channel": "...", "category": "Music", "duration_s": 58, "is_short": true,
            "keywords": ["..."], "description": "...", "chapters": []},
  "channel": {"description": "...", "topics": ["Music"], "keywords": "..."},
  "channel_history": {"NO": 0, "LIMITADO": 0, "LIBRE": 3},
  "transcript_excerpt": "[00:00] ...",
  "transcript_status": "ok"
}
```
Imágenes (L4) como adjuntos en el formato de cada proveedor.

Caso de referencia para tests: el Short `ib6nIB-fbNE` ("These Chords So Nasty (you've been warned)"). Su descripción es casi solo enlaces a cursos; tras la limpieza deben quedar los títulos de los cursos ("Chord Theory for R&B Piano", "The Soloing System", "Chord Tone Magic"…).

---

## 10. Componente 5 — Ablación (`eval/`)

### 10.1 Configuraciones
| Config | Niveles |
|---|---|
| `A` | L1 |
| `B` | L1 + L2 |
| `C` | L1 + L3 |
| `D` | L1 + L2 + L3 |
| `E` | L1 + L2 + L3 + L4 |
| `F` | L1 + L4 |

L0 (historial del canal) se evalúa aparte con validación temporal: para cada vídeo, solo cuentan las etiquetas del mismo canal **anteriores** a él. Si no, hay fuga de información.

Modelos: `liquid/d1.2-ultra`, `liquid/d1.2`, `openai/decisions`, y opcionalmente `anthropic/sonnet`.

### 10.2 Métricas (por modelo × configuración, sobre el split `test`; `dev` para iterar la política)
- Accuracy y macro-F1.
- **Tasa de falso LIBRE**: verdad NO o LIMITADO, predicho LIBRE. Es el error grave.
- **Tasa de falso NO**: verdad LIBRE, predicho NO. Es el error molesto.
- Matriz de confusión.
- Calibración: ECE y diagrama de fiabilidad.
- **Cobertura con umbral:** para varios umbrales de confianza, qué % se decide automáticamente y con qué acierto. Esto da el umbral de producción.
- Coste por vídeo (tokens de entrada × precio) y latencia p50/p95.
- Desglose por subconjunto: Shorts vs. vídeos, con transcripción vs. sin transcripción.

### 10.3 Ejecución
- `uv run python -m eval.ablation --models liquid/d1.2-ultra,openai/decisions --configs A,B,C,D,E,F --split test`
- Caché de veredictos por `(video_id, judge, model, config, policy_version)`: no repetir llamadas pagadas.
- Concurrencia limitada y reintentos con backoff.
- `--dry-run` que muestra el número de llamadas y el coste estimado antes de ejecutar.

### 10.4 Informe
`eval/reports/<fecha>.md` + `.html` con: tabla resumen, matriz de confusión del mejor par, curva cobertura/acierto, los 10 errores más confiados (con título, veredicto, probabilidades y enlace al vídeo) y una recomendación final de niveles, modelo y umbral.

---

## 11. Orden de trabajo e hitos

Cada hito termina con tests en verde y un commit (ver §0).

1. **Spike de extracción (lo primero, es lo más arriesgado).** Script mínimo en la extensión que, en un vídeo normal y en un Short, vuelca en consola: L1, la lista de pistas de subtítulos + el intento de descarga, y el spec del storyboard. Validar también la navegación SPA (pasar de un vídeo a otro sin recargar). **Hecho cuando** funciona en 5 vídeos y 5 Shorts distintos, y queda documentado qué falla.
2. **Servicio base:** FastAPI + SQLite + `POST /fichas`, `POST /labels`, `/health`. Tests.
3. **Extensión completa:** extracción L1/L3/L4 + envío al servicio + panel de etiquetado. **Hecho cuando** etiquetar un vídeo deja la ficha completa en SQLite.
4. **Enriquecimiento:** L2 por lotes, limpieza de descripción, muestreo de transcripción, recorte de fotogramas. Tests con fixtures reales.
5. **Etiquetado (lo hago yo):** objetivo ≥ 100 vídeos, ≥ 20 por clase, ≥ 30 casos difíciles (Shorts musicales, títulos clickbait de canales buenos, IA de dudosa calidad).
6. **Jueces:** adaptadores Liquid y OpenAI Decisions (+ Sonnet opcional) con tests de contrato usando respuestas grabadas.
7. **Ablación + informe.**
8. **Iterar la política** con el split `dev` y volver a medir en `test` al final.

---

## 12. Riesgos conocidos

- **La estructura interna de YouTube cambia** (player response, storyboards, subtítulos). Aislar los parsers y cubrirlos con fixtures reales.
- **Subtítulos con token `pot`**: ver §6.4.
- **Shorts**: obtener el player response puede requerir interceptar peticiones (ver §6.2).
- **Muchos Shorts musicales no tienen subtítulos**: ahí L4 (visual) y L2 (canal) son las únicas señales fuertes. Medirlo en el desglose.
- **Firma de la extensión en Firefox**: sin firma no se puede instalar de forma permanente (ver §6.8).
- **Cuota de la YouTube Data API**: 10.000 unidades/día por defecto. Con lotes de 50, sobra.

---

## 13. Después de la prueba (no implementar ahora; solo contexto)

- **Decisión escalonada en producción:** L0+L1 → si la confianza < umbral, + L2/L3 → si aún duda, + L4 → si aún duda, `LIMITADO`. Recordar qué nivel necesitó cada canal.
- **Modos:** feed (lotes, L0–L2), abrir un vídeo (empieza en pausa mientras se decide, todos los niveles), scroll de Shorts (evaluar en segundo plano los que YouTube ya ha precargado).
- **Cumplimiento:** NO → pantalla de bloqueo; LIMITADO → 30 min/día + 10 min de gracia si al vídeo le quedan < 10 min, y los vídeos largos siguen al día siguiente; LIBRE → aviso tras 5 Shorts seguidos.
- **Firefox en modo cerrado:** `policies.json` en `C:\Program Files\Mozilla Firefox\distribution\` o en el registro (`HKLM\Software\Policies\Mozilla\Firefox`): `ExtensionSettings` con `installation_mode: force_installed` (XPI firmado), `DisablePrivateBrowsing`, `DNSOverHTTPS` desactivado y bloqueado, `BlockAboutConfig`.
- **Edge viene instalado en Windows 11:** forzar la extensión también ahí (versión Chromium) o bloquear su ejecución. Lo mismo con cualquier otro navegador.
- **Bloqueo duro** de webs con el archivo hosts, servicio de Windows, candado con contraseña (argon2, endurecer al instante y relajar con 24 h de espera) y cuenta de Windows estándar para el día a día.
- **Opcional:** clasificador destilado local (embeddings + regresión logística) entrenado con los veredictos acumulados.

---

## 14. Variables de entorno (`.env.example`)

```
YOUTUBE_API_KEY=
LIQUID_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=        # opcional (solo experimentos con Sonnet)
AMO_JWT_ISSUER=           # firma de la extensión en Firefox
AMO_JWT_SECRET=
SERVICE_PORT=8765
```
