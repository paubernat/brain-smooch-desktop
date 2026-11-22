# Instalador de Brain Smooch (PLAN-FASE2 H4–H7)

Convierte el servicio local en un **servicio de Windows (LocalSystem)** con sus capas de bloqueo. Todo se instala en `C:\ProgramData\BrainSmooch\`.

| Script | Qué hace | Quién |
|---|---|---|
| `install.ps1` | Copia, venv, servicio WinSW (E2), watchdog (E3); el servicio aplica E4–E6 y arranca E7/E9 | Admin |
| `install.ps1 -Accounts` | Paso final y aparte: `BrainSmoochAdmin` + tu cuenta a estándar (E1) | Admin |
| `uninstall.ps1` | Desinstalación con la **contraseña de la app** (capas en orden inverso) | Admin + contraseña de la app |
| `teardown.ps1` | Desmontaje **manual** sin la app (kit de recuperación) | Admin (`BrainSmoochAdmin`) |

Todos aceptan `-DryRun`: imprimen el plan y **no cambian nada** (no hace falta ser administrador).

## Antes de empezar

1. Firmar la extensión: `cd extension && npm run sign` → `extension\web-ext-artifacts\*.xpi` (el instalador coge el más reciente). Subir `version` en `manifest.json` antes de cada firma nueva.
2. Construir la web local: `cd extension && npm run build`.
3. **Parar el servicio de desarrollo** (`uv run python -m app`): el instalado usa el mismo puerto 8765. Al instalar se copian `data\` (etiquetas, cupo y la contraseña del candado) y `policy\` solo si aún no existen en ProgramData; a partir de ahí la verdad está en ProgramData, no en el repo.
4. Ensayar: `powershell -ExecutionPolicy Bypass -File installer\install.ps1 -DryRun`.
5. (Recomendado, PLAN §11) Probar primero en una máquina virtual.

## Instalar (consola "Ejecutar como administrador", desde la raíz del repo)

```powershell
powershell -ExecutionPolicy Bypass -File installer\install.ps1 -DryRun   # 1. ensayo
powershell -ExecutionPolicy Bypass -File installer\install.ps1           # 2. instala (pide escribir INSTALAR)
#   o, para probar unos días sin cerrar del todo:
powershell -ExecutionPolicy Bypass -File installer\install.ps1 -Soft     #    vigilante solo observa, sin cuentas
```

Pasos (idempotentes; volver a ejecutarlo actualiza código, XPI y servicio):

1. Comprobaciones de solo lectura (rutas, XPI firmado, web construida, `uv`, Firefox, puerto libre).
2. `C:\ProgramData\BrainSmooch\` con ACL: SYSTEM y Administradores control total, Usuarios lectura; `secrets.env` solo SYSTEM/Administradores.
3. Copia `service\` y `eval\` a `app\`, la política y los datos (si no existen), el XPI (+ copia prístina y su SHA256), `service.env` (`BS_BROWSER_WATCH=enforce|observe`) y `secrets.env` (solo las claves de API del `.env`; no se muestran).
4. `uv sync --frozen --no-dev` con Python gestionado dentro de ProgramData (`python\`, `venv\`).
5. **WinSW** `v2.12.0` (`WinSW-x64.exe`), descargado de GitHub y verificado con SHA256 `05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA`, como `winsw\BrainSmooch.exe` + `winsw\BrainSmooch.xml`: servicio `BrainSmooch`, LocalSystem, automático, reinicio ×3. El binario no se versiona.
6. Watchdog `BrainSmoochWatchdog` (`watchdog\BrainSmoochWatchdog.xml`): SYSTEM, al arrancar, al iniciar sesión y cada minuto; reinstala/arranca el servicio si falta.
7. Arranca el servicio y llama a `POST /system/apply`. El servicio, como SYSTEM, escribe:
   - **E4** `C:\Program Files\Mozilla Firefox\distribution\policies.json`: extensión forzada desde `file:///C:/ProgramData/BrainSmooch/extension/brain-smooch.xpi`, sin ventanas privadas, DoH apagado y bloqueado, sin `about:config` ni herramientas de desarrollo (`about:debugging`), webs bloqueadas. Un `policies.json` previo que no sea nuestro se guarda como `.brainsmooch-backup` y se restaura al desinstalar.
   - **E5** `HKLM\SOFTWARE\Policies\Microsoft\Edge` y `...\Google\Chrome`: `URLBlocklist` (YouTube entero + webs), InPrivate/incógnito y modo invitado desactivados, `DnsOverHttpsMode=off`. Solo toca sus propios valores.
   - **E6** `hosts`: bloque `# BEGIN BrainSmooch … # END BrainSmooch`.
   - **E7** vigilante cada 3 s: cierra Chrome, Edge, Opera/GX, Brave, Vivaldi, DuckDuckGo, Yandex, Arc, Waterfox, LibreWolf, Floorp, Pale Moon, Maxthon, UC, Thorium, Mullvad, SeaMonkey, Chromium y cualquier `firefox.exe` fuera de `C:\Program Files\Mozilla Firefox\` (Tor, portables, Developer Edition). Nunca WebView2 ni apps Electron. Con `-Soft` solo anota.
   - **E9** integridad cada 60 s: compara (SHA256) `policies.json`, XPI, registro y `hosts`; si difieren los restaura y anota «intento de manipulación» en el panel. Los cambios de `blocked_sites` se aplican al guardar la política.

Al terminar imprime la tabla de capas; también en `http://127.0.0.1:8765/` → panel **Capas**.

> Con `DisableDeveloperTools`, `npm run dev` (web-ext run) deja de funcionar en ese Firefox.

## Cuentas (último paso, cuando todo lo anterior funcione)

```powershell
powershell -ExecutionPolicy Bypass -File installer\install.ps1 -Accounts -DryRun
powershell -ExecutionPolicy Bypass -File installer\install.ps1 -Accounts            # [-DemoteUser <cuenta>]
```

1. Confirmación escrita (`CONFIRMO`) y la contraseña de `BrainSmoochAdmin` dos veces (la del **custodio**, la de Windows admin del kit; mínimo 8 caracteres).
2. Crea (o actualiza) `BrainSmoochAdmin` y la mete en Administradores (por SID, vale con Windows en español).
3. **Verifica**: existe y está habilitada, está en Administradores, la contraseña funciona (`ValidateCredentials` + proceso de prueba con esas credenciales). Si algo falla, **aborta sin tocar tu cuenta**.
4. Comprueba que quedará al menos otro administrador habilitado, pide `DEGRADAR` y quita tu cuenta (la de la sesión abierta, o `-DemoteUser`) de Administradores; la deja en Usuarios.
5. Cierra sesión y vuelve a entrar.

## Desinstalar (con la contraseña de la app)

Como `BrainSmoochAdmin` (o "Ejecutar como administrador" con sus credenciales), con el servicio en marcha:

```powershell
powershell -ExecutionPolicy Bypass -File installer\uninstall.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File installer\uninstall.ps1             # [-RemoveData]
```

Pide la contraseña de la app (`POST /lock/login`), borra el watchdog, llama a `POST /system/uninstall` (el servicio deja de reparar y retira E6 → E5 → E4), y ejecuta `teardown.ps1 -Yes` para parar y borrar el servicio y limpiar ProgramData (conserva `data\` y `policy\` salvo `-RemoveData`). Al final ofrece devolver tu cuenta a Administradores.

## Recuperación manual (kit del custodio, sin la app)

Si el servicio no arranca o se ha perdido la contraseña de la app, con la contraseña de `BrainSmoochAdmin`:

1. Iniciar sesión como `BrainSmoochAdmin` (o abrir PowerShell con "Ejecutar como administrador" y sus credenciales).
2. Copiar `teardown.ps1` del kit (USB) a cualquier carpeta. No necesita el repo ni el servicio.
3. `powershell -ExecutionPolicy Bypass -File teardown.ps1 -DryRun` (ver el plan).
4. `powershell -ExecutionPolicy Bypass -File teardown.ps1 -RestoreAdmin <tu_usuario>` y escribir `DESMONTAR`.
   Quita watchdog → servicio → `hosts` → Edge/Chrome → Firefox `policies.json` → ProgramData (conserva `data\` y `policy\`, legibles otra vez). Idempotente.
5. Reiniciar Firefox. Cerrar sesión y entrar con tu cuenta (de nuevo administradora).

Si incluso eso fallara, a mano y como administrador: `schtasks /Delete /TN BrainSmoochWatchdog /F`, `sc.exe stop BrainSmooch`, `sc.exe delete BrainSmooch`, borrar `C:\Program Files\Mozilla Firefox\distribution\policies.json`, las claves `URLBlocklist` de `HKLM\SOFTWARE\Policies\Microsoft\Edge` y `...\Google\Chrome`, y el bloque BrainSmooch de `C:\Windows\System32\drivers\etc\hosts`.

## Ficheros

```
installer/
├── install.ps1, uninstall.ps1, teardown.ps1
├── lib/common.ps1                    # constantes y utilidades (no la usa teardown.ps1)
├── winsw/BrainSmooch.xml             # configuración de WinSW (URL, versión y SHA256 en el comentario)
└── watchdog/BrainSmoochWatchdog.xml, watchdog.ps1
```
