# WTM — Cliente nativo (Tauri)

Genera la app de escritorio nativa (el `.exe`/instalador de Windows, y binarios de
Linux).

## Arquitectura: thin client (la UI vive en el core)

Este cliente es un **cascaron minimo**. Lo unico que empaqueta es la pantalla de
conexion + login (carpeta `shell/`). Al autenticar, la ventana **navega al
escritorio servido por el core**. Por lo tanto:

- Toda la interfaz grafica vive en el core.
- Si cambias la estetica o la UI en el core, el cliente la toma sola al siguiente
  inicio de sesion, **sin reinstalar**.
- El `.exe` es pequeno y casi nunca necesita actualizarse (solo si cambia la logica
  del propio cascaron).

Ademas, la estetica (colores, nombre, logo) tambien se puede cambiar como datos
desde el core (endpoint `/api/appearance`), y el escritorio la descarga al cargar.

Todo esta listo para compilar. Los iconos ya estan generados en `src-tauri/icons/`
(incluido `icon.ico` para Windows). Solo faltan las herramientas de compilacion de
tu lado, porque el `.exe` de Windows debe compilarse en Windows (Tauri usa Rust y
WebView2 nativos; no se puede cross-compilar de forma fiable desde macOS/Linux).

## 1. Preparar la maquina Windows (una sola vez)

1. **Node.js 18+**: https://nodejs.org
2. **Rust** (incluye `cargo`): https://www.rust-lang.org/tools/install
   - Descarga y ejecuta `rustup-init.exe`, acepta la instalacion por defecto.
3. **Microsoft C++ Build Tools**: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - En el instalador marca "Desarrollo para el escritorio con C++".
4. **WebView2**: ya viene en Windows 10/11 actualizados. Si no, se instala desde
   https://developer.microsoft.com/microsoft-edge/webview2/

Para comprobar que Rust quedo bien, en una terminal nueva:

```
rustc --version
cargo --version
```

## 2. Copiar el proyecto

Copia toda la carpeta `WTM` a la maquina Windows (USB, red, git, lo que prefieras).

## 3. Compilar el instalador

### Forma facil (recomendada): un solo comando

Desde la carpeta del proyecto (incluso si esta en la unidad de red del Mac),
ejecuta:

```
scripts\build-exe-windows.bat
```

Ese script hace todo solo: copia el codigo a una carpeta local (porque npm y
Rust no pueden crear enlaces simbolicos sobre unidades de red), instala, compila
el `.exe`, y deja los instaladores en `dist-exe\` junto al proyecto. No tienes
que copiar nada a mano.

### Forma manual

Si prefieres hacerlo paso a paso (debes estar en un disco local, no de red):

```
npm install
npm run build:desktop
cd client-native
npm install
npm run tauri:build
```

- La primera compilacion de Rust tarda varios minutos. Las siguientes son rapidas.

## 4. Donde queda el ejecutable

```
client-native\src-tauri\target\release\bundle\
├─ msi\   WTM_0.1.0_x64_en-US.msi      (instalador MSI)
└─ nsis\  WTM_0.1.0_x64-setup.exe      (instalador .exe)
```

Tambien queda el ejecutable suelto en:
```
client-native\src-tauri\target\release\WTM.exe
```

Puedes distribuir el instalador o el `WTM.exe` directo.

## 5. Probar sin instalar (modo desarrollo)

Con el core corriendo (en esta u otra maquina):

```
cd client-native
npm run tauri:dev
```

Abre el cascaron (login). Al entrar, carga el escritorio del core. Util para iterar
sobre el propio cascaron. Para iterar sobre la UI, trabaja en `packages/desktop` y
el cambio se vera en el cliente sin recompilar el `.exe`.

## Pantalla completa

El cliente arranca en **pantalla completa sin bordes** (como un juego/kiosco), sin
la barra de titulo ni botones de Windows: solo se ve el sistema WTM.

- Pulsa **F11** para alternar entre pantalla completa y ventana.
- Alt+F4 cierra la app (lo maneja Windows).

## 6. Conectarse al servidor

Al abrir la app veras el cascaron de conexion. Indica donde corre el core:

- Local, misma maquina: `http://localhost:4000`
- Otro equipo de la red (por nombre o IP): `http://NOMBRE-SERVIDOR:4000` o `http://192.168.1.50:4000`
- VPS remoto: `http://IP-PUBLICA:4000`, `https://midominio.com`, o un DDNS

El cascaron muestra en vivo si el servidor responde. Al entrar, la ventana carga el
escritorio del core. La app recuerda el ultimo servidor. Usuario de prueba:
`admin` / `admin`.

## Regenerar los iconos (opcional)

Si cambias el logo, reemplaza `src-tauri/icons/icon.png` (1024x1024) y ejecuta:

```
cd client-native
npx tauri icon src-tauri/icons/icon.png
```
