# brain-smooch-desktop

Prueba de extracción de fichas de vídeos de YouTube + ablación de niveles de información. Ver [PLAN.md](PLAN.md) y [docs/api-contract.md](docs/api-contract.md).

## Extension

Firefox (MV3, ≥ 142), TypeScript + esbuild. Código en `extension/`.

```sh
cd extension
npm install
npm run build   # -> extension/dist/ y service/app/web/static/ (web local)
npm test        # typecheck + vitest (parsers, gate, cupo, Shorts…)
npm run lint    # web-ext lint sobre dist/
npm run dev     # Firefox con la extensión temporal (web-ext run)
npm run sign    # firma "unlisted" en AMO -> extension/web-ext-artifacts/*.xpi
```

- **Arquitectura:** `page-bridge.js` corre en el mundo de la página (`world: "MAIN"`, `document_start`): lee el player response (`movie_player` / `#shorts-player` / respuestas interceptadas de `/youtubei/v1/player` y `/reel/` / `ytInitialPlayerResponse`) y descarga los subtítulos. `content.js` construye la ficha y muestra el panel. Las llamadas HTTP a `http://127.0.0.1:8765` las hace `background.js` (origen `moz-extension://`, sin CORS de youtube.com).
- **Panel:** abajo a la derecha. `Alt+1` NO, `Alt+2` LIMITADO, `Alt+3` LIBRE (Alt izquierdo; AltGr no cuenta); campo "motivo" opcional; indicador L1–L4; contador de etiquetas pendientes de incorporar a la política. Si etiquetas antes de que se guarde la ficha, la etiqueta se envía en cuanto se guarda; si el vídeo ya ha cambiado (scroll de Shorts), se rechaza.
- **Veredicto del modelo:** al guardarse la ficha, el panel pide `POST /verdicts/{id}` y muestra «Modelo: LIBRE · 87 %» (con «regla: IA/directo» si decide una regla fija y «✓ coincide / ✗ no coincide» frente a tu etiqueta). Por defecto queda oculto hasta que etiquetas; si lo muestras antes (opción en la portada), esa etiqueta se marca `verdict_seen_before_label` y no cuenta en la ablación.
- **Debug / spike:** `localStorage.setItem('bsd-debug', '1')` en youtube.com. Ver [extension/SPIKE.md](extension/SPIKE.md).
- **Puerto del servicio:** 8765 por defecto; cambiable con `browser.storage.local.set({ servicePort: N })`.
- **Instalación permanente:** Firefox normal solo instala extensiones firmadas. Poner `AMO_JWT_ISSUER` y `AMO_JWT_SECRET` (claves de API de addons.mozilla.org → *Developer Hub → Manage API Keys*) en `.env` en la raíz y ejecutar `npm run sign`. La firma unlisted no publica la extensión. Hay que subir `version` en `manifest.json` antes de cada nueva firma. El `.xpi` resultante se instala arrastrándolo a Firefox.

## Bloqueo en Firefox (fase 2: H1–H3)

Ver [docs/PLAN-FASE2.md](docs/PLAN-FASE2.md). Con el sistema lanzado (`/settings/enforcement` `mode: "soft"`):

- **Gate:** al abrir un vídeo o Short, la extensión lo pausa y lo tapa con «Decidiendo…» hasta el veredicto en directo (`POST /verdicts/{id}`: reglas primero, luego el juez). El campo `gate` decide: **NO** → pantalla de bloqueo con el motivo y «Marcar como error» (guarda una etiqueta LIMITADO/LIBRE pendiente para calibrar; no desbloquea); **LIMITADO** → se ve contando cupo; **LIBRE** → se ve. Confianza del modelo < `min_confidence` (60 % por defecto, en «Juez en directo») → LIMITADO.
- **Fail-closed:** si el servicio no responde en 6 s (`service_timeout_s`), si no hay veredicto en 45 s (`decision_timeout_s`) o si falla la extracción, el vídeo queda bloqueado con «Reintentar». `early-hold.js` pausa el vídeo desde `document_start` hasta que `content.js` toma el control. Con `mode: "off"` (antes de lanzar) solo se etiqueta, como antes.
- **Cupo LIMITADO:** 30 min/día por defecto (día local). Latido cada ~15 s solo mientras el vídeo suena en la pestaña visible; +10 min de gracia si al vídeo le quedan < 10 min cuando se agota; los vídeos ≥ 1 h guardan la posición y siguen al día siguiente. El panel de etiquetado y el panel de la web muestran el contador.
- **Shorts:** el feed en scroll (pasar de un Short a otro dentro de la página) se bloquea siempre, sin llamar al juez; un Short abierto desde un enlace, una búsqueda o con carga completa se evalúa como cualquier vídeo.
- **Candado:** la última pantalla antes del cohete pide el nombre del custodio y la contraseña dos veces (solo se guarda el hash argon2id) y ofrece imprimir el **kit de recuperación** (`#kit`, sin la contraseña: se escribe a mano). Endurecer se aplica al momento; **relajar** (quitar webs o canales de NO, mover canales hacia LIBRE, apagar reglas o el bloqueo, subir el cupo, bajar el umbral, cambiar juez, editar cualquier texto de la política) pide la contraseña: sesión de 10 min (cookie `HttpOnly`, `SameSite=Strict`) + token CSRF, con espera creciente tras 3 fallos. Espera opcional de 24 h para relajar (desactivada por defecto). Detalle en [docs/api-contract.md](docs/api-contract.md#candado-lock-plan-fase2-6-h3).
- **Probarlo:** `cd extension && npm run build`, reinicia el servicio (`cd service && uv run python -m app`) y recarga la extensión (o `npm run dev`). Abre `http://127.0.0.1:8765/` (o ⚙ en el panel): completa política y webs, pulsa el cohete → custodio y contraseña → lanzar. En YouTube: un canal en la lista NO queda bloqueado; uno en LIBRE se ve; con el servicio parado, cualquier vídeo queda bloqueado. Para el cupo, baja `daily_minutes` a 1 en «Protección».

## Perfil / onboarding (web local)

El onboarding y el panel son una **web local** que sirve el propio servicio en `http://127.0.0.1:8765/` (mismo código que la antigua página de opciones: `extension/src/options/`, empaquetado por `build.mjs` en `service/app/web/static/`, que no se versiona). La página de opciones de la extensión es ahora un lanzador que abre esa web (y le pasa una vez el progreso guardado en el perfil de Firefox). Se abre sola al instalar la extensión, desde el botón ⚙ del panel de etiquetado o en `about:addons` → la extensión → *Preferencias*. Necesita el servicio arrancado (`cd service && uv run python -m app`) y el bundle construido (`cd extension && npm run build`).

- **Idioma:** English / Español / Català desde la primera pantalla (arriba a la derecha). Por defecto, el idioma del navegador (si no es ninguno de los tres, español); se guarda en el `localStorage` de la web y en el servicio (`/settings/ui`), de donde lo copia la extensión para el panel y las pantallas de bloqueo. Los textos están en `extension/src/options/i18n/{en,es,ca}.ts`.
- **Portada:** tres cuadros numerados: **01** configuración manual (estatua del herrero), **02** configuración agéntica (estatua del robot) y **03** lanzar (cohete, bloqueado hasta terminar). Las estatuas se encienden por segmentos (base, piernas, torso, brazos, cabeza) al avanzar: en el asistente 25/50/75/100 % por describir/borrador/afinar/guardar; en manual 25 % por sección completada (instrucciones, categorías, extras) y 100 % al guardar. Refrescar la política en calibración las hace latir.
- **Canales** (`#canales`, también dentro del editor manual): las listas de canales NO / LIMITADO / LIBRE como chips (añadir, quitar, mover; un canal solo en una lista). Desde el panel de YouTube, «📌 Canal → NO / LIM / LIBRE» fija el canal del vídeo actual (otro clic en la misma lista lo quita).
- **Bloquear webs extra** (`#webs`, paso previo al lanzamiento): dominios que la extensión bloquea enteros (y sus subdominios) fuera de YouTube; se guardan en la política (`blocked_sites`). El background los lee del servicio al arrancar y cada minuto y los guarda en `browser.storage.local` (`blockedSites`), así que el bloqueo sigue funcionando con el servicio apagado. Una navegación a esas webs se redirige a `blocked.html`.
- **Lanzar:** con la política guardada desde la página y el paso de webs revisado, el cohete se enciende; al pulsarlo pide antes el custodio y la contraseña (`#custodio`, si aún no existe), activa el bloqueo (`mode: "soft"`) y la portada pasa a «Sistema activo» (juez, webs bloqueadas, canales, etiquetas pendientes, cupo de hoy, tarjetas «Protección» y «Candado», y accesos a cada parte; `#configurar` vuelve a los cuadros; `#candado` desbloquea). El progreso (`policySaved`, `sitesReviewed`, `launched` y la luz de cada estatua) vive en el `localStorage` de la web (`setupState`); no en el servicio.
- **Configuración manual:** instrucciones, descripciones de LIBRE / LIMITADO / NO, reglas fijas, preguntas auxiliares y listas de canales; con «YAML avanzado» se edita el fichero tal cual.
- **Reglas fijas** (manual y asistente): «🚫 No a vídeos de IA (etiqueta de YouTube)» y «📡 No a directos (live)» dan NO antes del modelo en producción (`rules` en `policy.yaml`; no participan en la ablación, que solo las desglosa). La etiqueta IA solo detecta lo que declara el creador; el panel de etiquetado muestra «IA» y «LIVE» cuando aplican.
- **Configuración agéntica:** (1) describes cada categoría con tus palabras; (2) Claude (`POLICY_AUTHOR_MODEL`, por defecto `claude-sonnet-5-5`; requiere `ANTHROPIC_API_KEY`) redacta un borrador editable; (3) se evalúa con el juez elegido (por defecto, el más barato con clave) sobre tus etiquetas del split **dev**, primero con estimación de coste; «Mejorar con IA» manda los errores a Claude y propone una versión revisada con changelog; (4) guardar.
- **✨ Editar con IA** (paso 2 del asistente y editor manual): escribes una instrucción («añade que los podcasts de tecnología son LIMITADO», «quita lo de Fireship») y Claude edita el borrador; se puede deshacer y no se guarda hasta pulsar «Guardar».
- **Juez en directo** (portada): juez (desactivado si falta su clave; con precio), niveles A–F, cuándo revelar el veredicto y el umbral de confianza del bloqueo. Se guarda en SQLite (`/settings/live`).
- **Probar política** (portada → `#probar`, y botón «🧪 Probar política» en el editor manual): la misma evaluación sobre dev y «Mejorar con IA» que el paso 3 del asistente. Manual y agéntico editan la misma política (`policy/policy.yaml`).
- **Calibración** (en la portada, `#calibracion`): las etiquetas y motivos que pones en YouTube quedan *pendientes*; «Refrescar política» pide a Claude una versión revisada (los motivos cuentan como criterios explícitos) y la muestra como diff + changelog; al aceptarla se guarda y esas etiquetas pasan a incorporadas. Con 20 o más pendientes, el panel sugiere refrescar.
- El split **test** nunca se usa aquí: queda para la ablación final (en calibración solo se muestra cuántas hay). Con menos de 10 etiquetas dev, el paso 3 se puede saltar.
- Cada guardado sube `version` en `policy/policy.yaml` y deja la anterior en `policy/history/v<N>.yaml`. Endpoints en [docs/api-contract.md](docs/api-contract.md).

## Judges & ablation

Jueces en `service/app/judges/` (Liquid `d1.2-ultra`/`d1.2`, OpenAI Decisions `gpt-6-luna`, Claude Sonnet opcional), implementados con `httpx` según [docs/judges-api-notes.md](docs/judges-api-notes.md). Claves en `.env`: `LIQUID_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Precios en `service/pricing.yaml`; política en `policy/policy.yaml` (`policy_version` = `<model_version>-<sha256[:8]>`: el hash cubre solo lo que lee el modelo —instrucciones, descripciones de las opciones y preguntas auxiliares—, así que editar listas de canales, webs o reglas no invalida la caché; al arrancar se migran las claves antiguas de la caché).

La ablación (`eval/`, en la raíz del repo) se ejecuta **desde `service/`** con el entorno del servicio (el modo editable añade la raíz del repo al `sys.path`):

```sh
cd service
uv sync
uv run python -m eval.ablation --models liquid/d1.2-ultra,openai/decisions --configs A,B,C,D,E,F --split test --dry-run
uv run python -m eval.ablation --models liquid/d1.2-ultra,openai/decisions --configs A,B,C,D,E,F --split test
uv run pytest
uv run ruff check . ../eval
```

- Configuraciones A–F (PLAN §10.1); `+L0` (p. ej. `D+L0`) añade el historial del canal con validación temporal (solo etiquetas del canal anteriores al `labeled_at` del vídeo).
- Las etiquetas puestas después de ver el veredicto del juez en directo se excluyen (se imprime cuántas); `--include-seen` las incluye.
- `--dry-run`: llamadas nuevas y coste estimado (tokens ≈ caracteres/4 + asignación por imagen de `pricing.yaml`), sin llamar a nadie.
- Caché en la tabla `verdicts` por `(video_id, judge, model, config, policy_version)`: cambiar lo que lee el modelo invalida la caché (listas, webs y reglas no). `--concurrency N`, reintentos con backoff exponencial en 429/5xx (respeta `Retry-After`).
- Informe: `eval/reports/<YYYY-MM-DD>.md` y `.html` (resumen, desgloses Shorts/vídeos, con/sin transcripción, con/sin etiqueta IA de YouTube y directos, matriz de confusión y calibración del mejor par, curva cobertura/acierto, 10 errores más confiados, recomendación: menor falso LIBRE → mayor macro-F1 → menor coste).
