# Spike de extracción (hito 1)

> **Estado: validación manual PENDIENTE.** El código compila, los parsers pasan
> los tests con fixtures reales, pero nada se ha probado aún en un Firefox real.
> Rellenar la tabla de abajo antes de dar el hito por cerrado.

## Cómo activar el modo debug

1. `cd extension && npm install && npm run dev` (abre Firefox con la extensión temporal).
2. En la consola de youtube.com: `localStorage.setItem('bsd-debug', '1')` y recargar.
   (Alternativa: `browser.storage.local.set({ debug: true })` desde `about:debugging` → Inspeccionar.)
3. Al abrir un vídeo aparece en consola un grupo `[bsd] <id> — <título> (source: …)` con:
   L1 (metadatos), tabla de pistas de subtítulos, pista elegida, **intentos de descarga**
   (`direct`, `captured`, `pot-reuse`, `player-trigger` con HTTP status y bytes),
   nº de segmentos, el `spec` del storyboard y las URLs de sprites generadas.
   Los mensajes `[bsd:page]` vienen del mundo de la página (respuestas interceptadas, timedtext capturados).
4. `localStorage.setItem('bsd-caption-trigger', '0')` desactiva el intento de activar
   los subtítulos del reproductor (paso 4 de la descarga).

El panel funciona sin servicio (mostrará `servicio: service unreachable…` y botones desactivados);
para el spike basta con la consola.

## Checklist (5 vídeos + 5 Shorts + navegación SPA)

| # | Caso | URL / id | Fuente PR | L1 ok | Pistas | L3 status / vía | L4 sprites cargan | Notas |
|---|------|----------|-----------|-------|--------|-----------------|-------------------|-------|
| 1 | Vídeo largo con capítulos y subs manuales | `aircAruvnKk` | | | | | | |
| 2 | Vídeo en español con subs automáticos | | | | | | | |
| 3 | Vídeo sin subtítulos | | | | | | | |
| 4 | Vídeo de gaming (¿sale `game`?) | | | | | | | |
| 5 | Directo / estreno (storyboard `null` esperado) | | | | | | | |
| 6 | Short (carga directa `/shorts/`) | `ib6nIB-fbNE` | | | | | | |
| 7 | Short | `oyxs-4jk0Tg` | | | | | | |
| 8 | Short alcanzado con scroll (swipe) | | | | | | | |
| 9 | Short alcanzado con scroll | | | | | | | |
| 10 | Short abierto como `/watch?v=` | | | | | | | is_short debe ser `true` |
| 11 | SPA: home → vídeo → vídeo relacionado → atrás | | | | | | | ¿se refresca la ficha sin recargar? |
| 12 | SPA: vídeo → feed de Shorts → scroll ×3 | | | | | | | |

Para cada fila: abrir una sprite URL de la consola en una pestaña (debe verse la rejilla de fotogramas).

## Qué se sabe (comprobado el 2026-11-21 con `curl` sobre el HTML público)

- `ytInitialPlayerResponse` viene embebido en el HTML de `/watch` y de `/shorts/`, con
  `videoDetails`, `microformat`, `captions` y `storyboards`. Fixtures reales en `test/fixtures/`.
- **Shorts**: `microformat.playerMicroformatRenderer.canonicalUrl` es `…/shorts/<id>` (los vídeos
  normales tienen `/watch?v=`). Es el criterio principal de `is_short` además de la URL.
  `isShortsEligible` es `true` en Shorts y `false` en el vídeo largo probado, pero no se usa solo.
  Los Shorts probados duran 60 s y 120 s (ya no ≤ 60 s): el umbral heurístico es 180 s + vertical.
- **Storyboard**: formato confirmado `plantilla|w#h#n#cols#rows#interval#name#sigh`; nivel 0 =
  `default` (1 imagen, intervalo 0); niveles siguientes `M$M`. El `sigh` empieza por `rs$`.
  Mayor resolución: 320×180 en vídeos horizontales, 101×180 en Shorts.
- **Subtítulos**: `baseUrl + &fmt=json3` pedido sin `pot` devuelve **HTTP 200 con cuerpo vacío**
  (comprobado fuera del navegador para el vídeo largo y el Short). Por eso existen los pasos
  `captured` / `pot-reuse` / `player-trigger`. Un cuerpo vacío se registra como `blocked`.

## Qué NO se sabe aún (a validar en el navegador)

- Si el `fetch` directo desde el contexto de la página (con cookies) también devuelve vacío.
  Probablemente sí.
- Si el reproductor de Shorts (`#shorts-player`) expone `getPlayerResponse()`. Si no, la fuente
  será `intercepted` (respuestas de `/youtubei/v1/player` / `/youtubei/v1/reel/`) o `initial`.
- Si al hacer scroll en Shorts YouTube dispara `yt-navigate-finish`; el content script también
  hace *polling* de la URL cada segundo por si acaso.
- Si `loadModule('captions')` + `setOption('captions','track',…)` hace que el reproductor pida
  `timedtext` (con `pot`) y en qué formato (se espera `fmt=json3`). Si el reproductor pide otro
  formato, se reutiliza su `pot` para pedir json3 (`pot-reuse`). Si el `pot` está ligado a la
  pista/idioma, puede fallar: anotar.
- Si el `pot` capturado sirve para otra pista distinta del mismo vídeo.
- Si `world: "MAIN"` en el manifest se comporta igual en la versión instalada de Firefox (≥ 128).
- Juego asociado (`game`): solo best-effort a partir de `richMetadataRenderer` (estilo BOX_ART) en
  `/youtubei/v1/next` o `ytInitialData`; no hay fixture real.

## Fixtures

| Fichero | Origen |
|---------|--------|
| `player-short-ib6nIB-fbNE.json` | **Real** (HTML de `/shorts/ib6nIB-fbNE`, recortado) |
| `player-short-oyxs-4jk0Tg.json` | **Real** (HTML de `/shorts/oyxs-4jk0Tg`, recortado) |
| `player-watch-aircAruvnKk.json` | **Real** (HTML de `/watch?v=aircAruvnKk`, recortado; 12 capítulos, 31 pistas) |
| `captions-asr.json3.json` | **Sintético** (formato json3, estilo ASR) — sustituir por una captura real |
| `captions-manual.json3.json` | **Sintético** (formato json3, estilo manual) — sustituir por una captura real |

Para capturar un json3 real durante el spike: con debug activo, copiar el cuerpo del
`timedtext` capturado (pestaña Red → respuesta) a `test/fixtures/`.
