# brain-smooch-desktop

Prueba de extracción de fichas de vídeos de YouTube + ablación de niveles de información. Ver [PLAN.md](PLAN.md) y [docs/api-contract.md](docs/api-contract.md).

## Extension

Firefox (MV3, ≥ 142), TypeScript + esbuild. Código en `extension/`.

```sh
cd extension
npm install
npm run build   # -> extension/dist/
npm test        # typecheck + vitest (parsers L1/L3/L4)
npm run lint    # web-ext lint sobre dist/
npm run dev     # Firefox con la extensión temporal (web-ext run)
npm run sign    # firma "unlisted" en AMO -> extension/web-ext-artifacts/*.xpi
```

- **Arquitectura:** `page-bridge.js` corre en el mundo de la página (`world: "MAIN"`, `document_start`): lee el player response (`movie_player` / `#shorts-player` / respuestas interceptadas de `/youtubei/v1/player` y `/reel/` / `ytInitialPlayerResponse`) y descarga los subtítulos. `content.js` construye la ficha y muestra el panel. Las llamadas HTTP a `http://127.0.0.1:8765` las hace `background.js` (origen `moz-extension://`, sin CORS de youtube.com).
- **Panel:** abajo a la derecha. `Alt+1` NO, `Alt+2` LIMITADO, `Alt+3` LIBRE; campo "motivo" opcional; indicador L1–L4.
- **Debug / spike:** `localStorage.setItem('bsd-debug', '1')` en youtube.com. Ver [extension/SPIKE.md](extension/SPIKE.md).
- **Puerto del servicio:** 8765 por defecto; cambiable con `browser.storage.local.set({ servicePort: N })`.
- **Instalación permanente:** Firefox normal solo instala extensiones firmadas. Poner `AMO_JWT_ISSUER` y `AMO_JWT_SECRET` (claves de API de addons.mozilla.org → *Developer Hub → Manage API Keys*) en `.env` en la raíz y ejecutar `npm run sign`. La firma unlisted no publica la extensión. Hay que subir `version` en `manifest.json` antes de cada nueva firma. El `.xpi` resultante se instala arrastrándolo a Firefox.

## Perfil / onboarding

«Configura tu perfil» es la página de opciones de la extensión. Se abre sola al instalarla, desde el botón ⚙ del panel de etiquetado o en `about:addons` → la extensión → *Preferencias*. Necesita el servicio arrancado (`cd service && uv run python -m app`).

- **Configuración manual:** instrucciones, descripciones de LIBRE / LIMITADO / NO, preguntas auxiliares y listas de canales; con «YAML avanzado» se edita el fichero tal cual.
- **Configuración agéntica:** (1) describes cada categoría con tus palabras; (2) Claude (`POLICY_AUTHOR_MODEL`, por defecto `claude-sonnet-5-5`; requiere `ANTHROPIC_API_KEY`) redacta un borrador editable; (3) se evalúa con el juez elegido (por defecto, el más barato con clave) sobre tus etiquetas del split **dev**, primero con estimación de coste; «Mejorar con IA» manda los errores a Claude y propone una versión revisada con changelog; (4) guardar.
- El split **test** nunca se usa aquí: queda para la ablación final. Con menos de 10 etiquetas dev, el paso 3 se puede saltar.
- Cada guardado sube `version` en `policy/policy.yaml` y deja la anterior en `policy/history/v<N>.yaml`. Endpoints en [docs/api-contract.md](docs/api-contract.md).

## Judges & ablation

Jueces en `service/app/judges/` (Liquid `d1.2-ultra`/`d1.2`, OpenAI Decisions `gpt-6-luna`, Claude Sonnet opcional), implementados con `httpx` según [docs/judges-api-notes.md](docs/judges-api-notes.md). Claves en `.env`: `LIQUID_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Precios en `service/pricing.yaml`; política en `policy/policy.yaml` (`policy_version` = `<version>-<sha256[:8]>`).

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
- `--dry-run`: llamadas nuevas y coste estimado (tokens ≈ caracteres/4 + asignación por imagen de `pricing.yaml`), sin llamar a nadie.
- Caché en la tabla `verdicts` por `(video_id, judge, model, config, policy_version)`: cambiar la política invalida la caché. `--concurrency N`, reintentos con backoff exponencial en 429/5xx (respeta `Retry-After`).
- Informe: `eval/reports/<YYYY-MM-DD>.md` y `.html` (resumen, desgloses Shorts/vídeos y con/sin transcripción, matriz de confusión y calibración del mejor par, curva cobertura/acierto, 10 errores más confiados, recomendación: menor falso LIBRE → mayor macro-F1 → menor coste).
