# brain-smooch-desktop — Plan fase 2: bloqueador real

> Continuación de `PLAN.md` (fase 1: extracción, etiquetado, jueces y ablación).
> Entorno: **Windows 11 Home**, Firefox como navegador principal, Edge preinstalado.
> Reglas del repo (§0 de `PLAN.md`) siguen vigentes: commits a nombre del autor, sin atribuciones, secretos solo en `.env`, nada de cloud salvo las APIs de modelos y la YouTube Data API, servicio solo en `127.0.0.1`.

---

## 0. Requisitos previos (antes de empezar la fase 2)

- Fase 1 con datos suficientes: ≥ 100 vídeos etiquetados, ≥ 20 LIBRE, ablación en `test` con **falso LIBRE ≈ 0 %**. Sin esto no se le da al modelo poder para bloquear.
- Juez y configuración elegidos (hoy: `liquid/d1.2-ultra`, config D o E) y umbral de confianza fijado con la tabla de cobertura.
- Extensión **firmada** por AMO (`npm run sign`, claves `AMO_JWT_*`), necesaria para instalarla de forma forzada.

---

## 1. Objetivo

Pasar de "el modelo opina" a "el sistema bloquea", de forma que:

1. **YouTube** se filtre vídeo a vídeo (NO / LIMITADO con cupo / LIBRE).
2. **Webs extra** se bloqueen por completo (como el Brain Smooch original).
3. Nada de lo anterior se pueda **desactivar, desinstalar ni esquivar** sin la contraseña que custodia otra persona — o, sin ella, solo desmontando a mano muchas capas independientes que además se reparan solas.
4. Con la contraseña, **todo sea siempre recuperable**. Ninguna acción puede dejar el PC inutilizable o sin cuenta de administrador.

---

## 2. Modelo de confianza

| Rol | Quién | Qué puede hacer |
|---|---|---|
| **Usuario** | Tú, en tu cuenta de Windows del día a día (**estándar**, no admin) | Navegar, etiquetar, **endurecer** la política (más NO, más webs bloqueadas, menos cupo) al instante |
| **Custodio** | Otra persona de confianza | Tiene **dos secretos**: la contraseña de la app y la de la cuenta de Windows administradora. Los introduce para **relajar**, pausar o desinstalar |
| **Sistema** | Servicio de Windows como `LocalSystem` | Aplica y repara todas las capas |

- **Endurecer = sin contraseña. Relajar = contraseña** (y, opcionalmente, una espera configurable de 24 h entre petición y efecto, para que ni con el custodio al lado sea impulsivo).
- "Relajar" = mover un canal o tema hacia LIBRE, quitar una web bloqueada, subir el cupo, desactivar un interruptor "No a…", pausar o desinstalar.
- **Kit de recuperación**: documento (PDF/sobre) para el custodio con la contraseña de la app, la de Windows admin y el procedimiento de desinstalación manual paso a paso. Es la garantía de que nunca hay encierro.

---

## 3. Arquitectura

```
┌──────────────────────── Windows (LocalSystem) ────────────────────────┐
│  BrainSmooch Service (FastAPI, 127.0.0.1:8765)                        │
│   ├─ API actual (fichas, labels, verdicts, policy…)                   │
│   ├─ Web UI local  →  http://127.0.0.1:8765/  (onboarding neón,       │
│   │                    contraseña, panel "Sistema activo")             │
│   ├─ lock/       contraseña (argon2id), sesiones admin, solicitudes   │
│   │              de relajación con espera                              │
│   ├─ enforce/    capas: políticas de navegador, hosts, vigilante       │
│   │              de navegadores, auto-reparación                       │
│   └─ quota/      cupo diario LIMITADO, gracia, vídeos largos           │
│  Watchdog (tarea programada SYSTEM)  →  resucita el servicio y         │
│                                         reinstala capas si faltan      │
└────────────────────────────────────────────────────────────────────────┘
        ▲ HTTP local                                   ▲ registro / archivos
        │                                              │
┌───────┴─────────── Firefox ───────────┐   ┌──────────┴───────── Edge / Chrome ─────────┐
│ Extensión forzada (policies.json)     │   │ URLBlocklist: youtube.com + webs extra     │
│  · pausa el vídeo hasta el veredicto  │   │ InPrivate/Incógnito desactivado            │
│  · NO → pantalla de bloqueo           │   │ DoH desactivado                            │
│  · LIMITADO → cuenta tiempo           │   └────────────────────────────────────────────┘
│  · fail-closed si el servicio no      │
│    responde                           │
└───────────────────────────────────────┘
```

**Decisión: web local, no app de escritorio.** La UI se sirve desde el propio servicio (`http://127.0.0.1:8765/`), se abre en cualquier navegador y sigue existiendo aunque se rompa la extensión. La página de opciones de la extensión pasa a ser un enlace a esa web. Opcional más adelante: icono en la bandeja que la abre.

**Datos e instalación** en `C:\ProgramData\BrainSmooch\` (servicio, venv, `policy.yaml`, SQLite, XPI firmado, logs) con ACL: `SYSTEM` y `Administrators` control total, `Users` solo lectura. La API keys pasan del `.env` del repo a `C:\ProgramData\BrainSmooch\secrets.env` con la misma ACL (solo SYSTEM/Admins leen).

---

## 4. Capas de enforcement

Cada capa es independiente; el objetivo es que quitar una no sirva de nada si las demás siguen en pie y el watchdog la repone.

| # | Capa | Mecanismo | Qué evita |
|---|---|---|---|
| E1 | **Cuenta estándar** | Tu cuenta diaria pasa a estándar; existe una cuenta admin (`BrainSmoochAdmin`) con la contraseña del custodio | Que tú, desde tu sesión, toques servicios, registro HKLM, `Program Files` o `ProgramData` |
| E2 | **Servicio de Windows** | `LocalSystem`, inicio automático, acciones de recuperación "reiniciar" ×3. Wrapper: **WinSW** (exe + XML) sobre el venv de `uv` | Cerrar el cerebro. Un usuario estándar no puede parar servicios |
| E3 | **Watchdog** | Tarea programada como SYSTEM cada 1 min + al iniciar sesión: si el servicio no está, lo reinstala/arranca; si una capa falta, la repone | Desmontar capas una a una |
| E4 | **Firefox `policies.json`** en `C:\Program Files\Mozilla Firefox\distribution\` | `ExtensionSettings` → `force_installed` con el XPI firmado local; `DisablePrivateBrowsing`; `DNSOverHTTPS` `{Enabled:false, Locked:true}`; `BlockAboutConfig`; `DisableDeveloperTools` (bloquea también `about:debugging`, evita cargar extensiones temporales); `WebsiteFilter.Block` con las webs extra | Quitar o desactivar la extensión, ventanas privadas, saltarse `hosts` con DoH |
| E5 | **Edge y Chrome por registro** (`HKLM\SOFTWARE\Policies\Microsoft\Edge`, `…\Google\Chrome`) | `URLBlocklist` (YouTube entero + webs extra), `InPrivateModeAvailability=1` / `IncognitoModeAvailability=1`, `DnsOverHttpsMode=off`, `BrowserGuestModeEnabled=0` | Usar otro navegador para ver YouTube. En Home no se pueden forzar extensiones fuera de su tienda, por eso **YouTube solo funciona en Firefox** |
| E6 | **`hosts`** | Entradas `0.0.0.0` para las webs extra, entre marcas `# BEGIN/END BrainSmooch` | Webs bloqueadas desde cualquier programa, no solo navegadores |
| E7 | **Vigilante de navegadores** | El servicio enumera procesos cada pocos segundos: navegadores conocidos no gestionados (Brave, Opera, Vivaldi, Tor, Chromium portable, Firefox fuera de `Program Files`…) → se cierran y se avisa | Instalar o descomprimir otro navegador sin políticas |
| E8 | **Fail-closed** | Si la extensión no obtiene respuesta del servicio en X s, la página de YouTube queda bloqueada | Matar el servicio para ver vídeos |
| E9 | **Integridad** | El servicio comprueba cada minuto el hash de `policies.json`, claves de registro, `hosts` y el XPI; si difieren, los restaura y anota un evento "intento de manipulación" visible en el panel | Editar a mano cualquier capa |

**Lo que queda fuera (límite honesto):** con la contraseña de administrador de Windows, o arrancando desde un USB / formateando, todo se puede deshacer. El diseño apunta a que eso requiera la contraseña del custodio o un esfuerzo largo y deliberado, nunca un impulso.

---

## 5. Comportamiento en YouTube

- **Al abrir un vídeo**: la extensión lo pausa y lo oculta con una capa "Decidiendo…" hasta tener veredicto (reglas → modelo). Objetivo p95 < 1,5 s (config D sin imágenes). Si la confianza < umbral → `LIMITADO` (nunca `LIBRE` por duda).
- **NO** → pantalla de bloqueo (estilo neón) con motivo y botón "Etiquetar como error" (queda pendiente para calibración; no desbloquea).
- **LIMITADO** → cuenta tiempo reproducido contra el cupo diario (30 min por defecto, configurable; endurecer sin contraseña, subir con contraseña). Reglas de tus preferencias:
  - Si al vídeo le quedan < 10 min cuando se agota el cupo, +10 min de gracia para terminarlo.
  - Vídeos ≥ 1 h: se reparten en dos días (al agotar el cupo, se guarda la posición y se retoma mañana).
- **LIBRE** → sin límite.
- **Shorts** (backlog): el feed en scroll (`/shorts` encadenando Shorts) se bloquea siempre; un Short suelto al que llegas por enlace/búsqueda se evalúa como cualquier vídeo. Criterio inicial: dos navegaciones SPA seguidas de Short a Short = scroll.
- **Portada / feed / búsqueda**: sin bloquear en esta fase (opcional: ocultar miniaturas de canales en lista NO).
- **Reglas fijas** ya existentes: listas de canales, "No a directos", "No a vídeos de IA".

---

## 6. Contraseña, sesiones y desinstalación

- **Creación**: último paso del onboarding, antes del cohete. Se pide dos veces; se guarda **solo el hash argon2id** en `ProgramData` (ACL SYSTEM/Admins). Se genera el **kit de recuperación** (PDF imprimible) para el custodio.
- **Sesión admin** en la web local: tras introducir la contraseña, cookie `HttpOnly` + `SameSite=Strict` de 10 min, token CSRF en cada acción. Límite de intentos con espera creciente.
- **Clasificación de cambios**: el servicio compara la política nueva con la actual y decide si es endurecer (se aplica) o relajar (pide sesión admin y, si está activada, crea una solicitud que se aplica tras la espera).
- **Pausa temporal**: con contraseña, pausar X horas (máximo configurable); vuelve sola.
- **Desinstalación limpia**: solo desde la web con sesión admin → el servicio retira capas en orden inverso (E9…E1 salvo la cuenta), restaura `hosts`, borra claves de registro y `policies.json`, desinstala watchdog y servicio. Al final indica cómo volver a poner tu cuenta como admin si se quiere.
- **Desinstalación manual** (sin la app, con la contraseña de Windows admin): script `teardown.ps1` incluido en el kit de recuperación, no en el disco del usuario.

---

## 7. Onboarding (web local)

Reutiliza el rediseño neón de la fase 1 (idioma EN/ES/CA, 01 artesano manual / 02 robot agéntico / 03 cohete):

1. Idioma.
2. Perfil: manual o agéntico (lo existente, con estatuas que se encienden).
3. Canales (listas NO / LIMITADO / LIBRE).
4. Webs extra a bloquear.
5. Cupo de LIMITADO y reglas de Shorts.
6. Juez y umbral (por defecto el ganador de la ablación).
7. **Custodio**: nombre, contraseña de la app, espera de relajación opcional, kit de recuperación.
8. **Comprobación del sistema**: lista de capas E1–E9 con estado (✓ / pendiente / requiere admin). Las que requieren admin se aplican con el instalador elevado.
9. 🚀 Lanzar → "Sistema activo".

---

## 8. Instalación

- **Instalador** `install.ps1` que se ejecuta **una vez como administrador**:
  1. Copia servicio + venv + XPI a `ProgramData`/`Program Files`, fija ACL.
  2. Registra servicio (WinSW) y watchdog (tarea programada SYSTEM).
  3. Escribe `policies.json` y claves de Edge/Chrome, `hosts`.
  4. **Cuentas** (el paso delicado, guiado y con confirmaciones):
     a. Crea `BrainSmoochAdmin` con la contraseña del custodio.
     b. **Verifica** que esa cuenta existe, está en `Administrators` y la contraseña funciona (`runas` de prueba).
     c. Solo entonces ofrece pasar tu cuenta a estándar. Si b falla, se aborta sin tocar tu cuenta.
- **Modo ensayo** (`install.ps1 -DryRun`): muestra todo lo que haría sin aplicarlo.
- **Modo blando** (sin E1 ni E7): para probar el bloqueo días antes de cerrar del todo.

---

## 9. Estructura nueva del repo

```
service/app/
├── lock/            # password.py (argon2id), sessions.py, requests.py (relajación con espera), classify.py (endurecer vs relajar)
├── enforce/         # firefox_policies.py, chromium_policies.py, hosts.py, browser_watch.py, integrity.py, layers.py (registro de capas + estado)
├── quota/           # tracker.py, rules.py (gracia, vídeos largos)
├── web/             # UI local (build del front neón compartido con la extensión)
└── routes/          # lock.py, enforce.py, quota.py, system.py
installer/
├── install.ps1, uninstall.ps1, teardown.ps1 (kit), winsw/BrainSmooch.xml
└── README.md
extension/src/
├── enforce/         # gate.ts (pausa + capa "Decidiendo…"), block-page, quota-meter, shorts-scroll.ts
```

Todo lo que toca Windows va detrás de interfaces (`LayerBackend`) con una implementación real y una **falsa para tests**, de modo que `pytest` no necesite admin ni toque el sistema.

---

## 10. Hitos

Cada hito termina con tests en verde y commit. Ninguno toca cuentas de Windows hasta el H7.

1. **H1 — Gate en Firefox (modo blando).** Extensión pausa vídeo, pide veredicto, aplica NO (pantalla) / LIBRE. Fail-closed. *Hecho cuando* un vídeo NO no se puede reproducir y uno LIBRE sí, con el servicio arrancado a mano.
2. **H2 — Cupo LIMITADO + Shorts.** Tracker de tiempo, gracia, vídeos largos, feed de Shorts bloqueado. *Hecho cuando* el cupo se agota y bloquea, y al día siguiente se reinicia.
3. **H3 — Web local + contraseña.** UI servida por el servicio, onboarding completo, argon2id, sesiones, clasificación endurecer/relajar, solicitudes con espera, kit de recuperación. *Hecho cuando* relajar sin contraseña es imposible desde la UI y desde la API.
4. **H4 — Capas de navegador y hosts (sin admin real en tests).** E4, E5, E6, E9 con backend falso en tests y backend real probado a mano. *Hecho cuando* Edge no abre YouTube, Firefox no deja quitar la extensión ni abrir ventana privada, y las webs extra no cargan en ningún navegador.
5. **H5 — Servicio de Windows + watchdog.** E2, E3. *Hecho cuando* tras reiniciar el PC todo está activo sin intervención, y matar el servicio desde una cuenta admin lo hace reaparecer en ≤ 1 min.
6. **H6 — Vigilante de navegadores.** E7. *Hecho cuando* abrir un navegador portable lo cierra en ≤ 5 s.
7. **H7 — Cuentas e instalador final.** `install.ps1` con verificación de la cuenta admin antes de degradar la tuya, `uninstall.ps1`, `teardown.ps1`. *Hecho cuando* se completa el ciclo instalar → usar un día → desinstalar con contraseña → PC como al principio.
8. **H8 — Prueba de manipulación.** Lista de intentos (quitar extensión, editar `hosts`, parar servicio, otro navegador, DoH, perfil nuevo, `about:debugging`…) y resultado de cada uno, documentado.

---

## 11. Riesgos

- **Encierro accidental** (el más grave): mitigado con verificación de la cuenta admin antes de degradar la tuya, kit de recuperación y desinstalación probada en H7 antes de usarlo en serio. Ensayar primero en una **máquina virtual** (Hyper-V no está en Home → VirtualBox/VMware con Windows 11 de evaluación).
- **Windows 11 Home**: sin `gpedit` ni AppLocker. Las políticas de navegador se escriben directamente en el registro (los navegadores las leen igual); verificar en H4 que Edge/Chrome aplican `URLBlocklist` en un equipo no gestionado.
- **Latencia del veredicto**: si el modelo tarda, la pausa molesta. Caché por vídeo y por canal; reglas de canal primero; config D por defecto.
- **Cambios de YouTube** (ya conocido de fase 1): el gate debe fallar cerrado, no abierto.
- **Actualizaciones de Firefox** que borren `distribution/`: lo cubre E9 (integridad) y el watchdog.
- **Antivirus/SmartScreen** pueden marcar el vigilante o el instalador: firmar scripts si da problemas y documentar exclusiones.
- **Falso NO molesto** en vídeos útiles: botón "Etiquetar como error" + calibración; el custodio no tiene que intervenir para eso.

---

## 12. Preguntas abiertas

1. ¿Espera de 24 h al relajar también con contraseña, o solo contraseña?
2. ¿Bloquear YouTube por completo en Edge/Chrome (propuesto) o intentar extensión forzada vía tienda?
3. ¿Qué hacer con la portada/feed de YouTube: nada, ocultar canales NO, o bloquear la portada y permitir solo búsqueda/enlaces?
4. ¿Cupo LIMITADO por defecto 30 min/día, igual todos los días o distinto en fin de semana?
5. ¿Te parece bien la cuenta `BrainSmoochAdmin` con contraseña del custodio y tu cuenta como estándar? Es la capa que más protege y la más delicada.
