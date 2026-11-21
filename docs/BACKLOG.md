# Backlog — segunda iteración (bloqueador)

Decisiones de producto tomadas durante la prueba, para aplicar cuando se construya el bloqueo (PLAN §13).

## Shorts
- **No se permite el feed de Shorts en scroll** (`/shorts` navegando de uno a otro), sea cual sea el veredicto.
- **Sí se permite un Short suelto** cuando se llega a él directamente (enlace, búsqueda, recomendación en una página de vídeo), y se evalúa como cualquier otro vídeo (NO / LIMITADO / LIBRE).
- Pendiente de diseño: cómo distinguir "Short suelto" de "scroll" (p. ej. navegación SPA de Short a Short sin pasar por otra página → scroll) y qué pantalla se muestra al bloquear.
- Sustituye al aviso "tras 5 Shorts seguidos" de §13.

## Política / onboarding
- Pasar `channel_lists` de nombres a `channel_id` (confirmar geopold y orslok).
- Al guardar desde el editor se pierden los comentarios de `policy.yaml` (el histórico en `policy/history/` los conserva).

## Extracción
- L3 `blocked` por el token `pot` en algunos vídeos: medir la frecuencia con los datos etiquetados y, si es alta, añadir la alternativa `youtube-transcript-api` en el servicio (PLAN §6.4 b).

## Candado y desinstalación (decisión del usuario, 2026-11-21)
- Modelo de confianza: **contraseña que el usuario entrega a otra persona**. Sin esa contraseña no se puede relajar la política, parar el servicio ni desinstalar.
- Objetivo de dificultad: deshacerlo sin la contraseña debe ser **muy costoso** (varias capas independientes que hay que desmontar a mano), pero **siempre recuperable con la contraseña** — nada que deje el PC inutilizable.
- Capas previstas: cuenta de Windows estándar para el día a día (admin con la contraseña entregada), servicio de Windows como SYSTEM con watchdog, extensión forzada por políticas de navegador, `URLBlocklist` + `hosts`, DoH/privado/`about:config` desactivados, vigilante de navegadores no gestionados, fail-closed si el servicio no responde.
- Endurecer: inmediato. Relajar: contraseña (+ espera opcional de 24 h).
- Nota: Windows 11 Home (sin AppLocker/gpedit); Chrome/Edge solo fuerzan extensiones de su tienda en equipos no gestionados → bloquear YouTube por política en esos navegadores y dejar Firefox como único navegador con YouTube.
