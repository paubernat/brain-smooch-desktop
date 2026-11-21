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
