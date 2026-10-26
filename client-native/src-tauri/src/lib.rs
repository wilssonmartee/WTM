// Cliente nativo WTM (Tauri v2).
//
// Como la UI la sirve el core (origen remoto) y el webview no da acceso al
// disco, exponemos un PUENTE NATIVO (window.__WTM_NATIVE__) inyectado en toda
// pagina, con comandos Rust para:
//   - pickFile(): dialogo nativo -> ruta real del archivo
//   - readFile(path): leer un archivo del disco -> bytes
//   - listDir(path): listar archivos de una carpeta (para fotos, etc.)
// Asi el modulo Articulos puede recordar la RUTA y releer sin re-seleccionar.
//
// F11 alterna pantalla completa. Escape sale de pantalla completa.
// La ventana arranca en modo VENTANA (con barra de titulo y botones) y recuerda
// su tamano/posicion/maximizado entre aperturas (plugin window-state).

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::{StateFlags, WindowExt};

// Convierte el FilePath del dialogo a una ruta de sistema de archivos real.
// Usamos into_path() -> PathBuf para evitar que quede con esquema (file://...).
fn filepath_to_string(fp: tauri_plugin_dialog::FilePath) -> Option<String> {
    fp.into_path()
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

// IMPORTANTE: usamos la API BLOQUEANTE del dialogo dentro de un comando async.
// Los comandos async de Tauri corren fuera del hilo principal, asi que el
// bloqueo no congela la UI y evitamos el patron fragil de canal + rx.recv().
#[tauri::command]
async fn wtm_pick_file(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("DBF", &["dbf", "DBF"])
        .blocking_pick_file()
        .and_then(filepath_to_string)
}

#[tauri::command]
async fn wtm_pick_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(filepath_to_string)
}

#[tauri::command]
fn wtm_read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

// --- Control de ventana desde la UI (puente nativo) ---

#[tauri::command]
fn wtm_toggle_fullscreen(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        toggle_fullscreen(&win);
    }
}

#[tauri::command]
fn wtm_exit_fullscreen(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        exit_fullscreen(&win);
    }
}

#[tauri::command]
fn wtm_is_fullscreen(app: tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_fullscreen().ok())
        .unwrap_or(false)
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn wtm_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let md = entry.metadata().map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: md.is_dir(),
            size: md.len(),
        });
    }
    Ok(out)
}

// Puente inyectado en TODA pagina (incluida la UI remota del core).
const INIT_SCRIPT: &str = r#"
(function(){
  if (!window.__TAURI_INTERNALS__) return;
  var inv = window.__TAURI_INTERNALS__.invoke;
  window.__WTM_NATIVE__ = {
    available: true,
    pickFile: function(){ return inv('wtm_pick_file'); },
    pickDir: function(){ return inv('wtm_pick_dir'); },
    readFile: function(path){ return inv('wtm_read_file', { path: path }).then(function(b){ return new Uint8Array(b); }); },
    listDir: function(path){ return inv('wtm_list_dir', { path: path }); },
    toggleFullscreen: function(){ return inv('wtm_toggle_fullscreen'); },
    exitFullscreen: function(){ return inv('wtm_exit_fullscreen'); },
    isFullscreen: function(){ return inv('wtm_is_fullscreen'); }
  };
})();
"#;

/// Alterna pantalla completa y ajusta las decoraciones en consecuencia:
/// en pantalla completa se ocultan (inmersivo); en ventana se muestran para
/// que haya barra de titulo con botones de minimizar/maximizar/cerrar.
fn toggle_fullscreen(win: &tauri::WebviewWindow) {
    let is_fs = win.is_fullscreen().unwrap_or(false);
    let next = !is_fs;
    let _ = win.set_fullscreen(next);
    let _ = win.set_decorations(!next);
}

/// Sale de pantalla completa (si lo esta) y restaura las decoraciones.
fn exit_fullscreen(win: &tauri::WebviewWindow) {
    if win.is_fullscreen().unwrap_or(false) {
        let _ = win.set_fullscreen(false);
        let _ = win.set_decorations(true);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let f11 = Shortcut::new(None, Code::F11);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Recuerda tamano, posicion y maximizado entre aperturas. NO guardamos
        // FULLSCREEN a proposito: la app siempre arranca en modo ventana, y el
        // usuario entra a pantalla completa con F11 si quiere.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &f11 {
                        if let Some(win) = app.get_webview_window("main") {
                            toggle_fullscreen(&win);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            wtm_pick_file,
            wtm_pick_dir,
            wtm_read_file,
            wtm_list_dir,
            wtm_toggle_fullscreen,
            wtm_exit_fullscreen,
            wtm_is_fullscreen
        ])
        .setup(move |app| {
            app.global_shortcut().register(f11)?;
            // Creamos la ventana en Rust para inyectar el puente nativo en toda
            // pagina (incluida la UI remota del core). Arranca en MODO VENTANA
            // con decoraciones (barra de titulo + botones). El tamano/posicion
            // se restauran despues desde el estado guardado.
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("WTM")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 560.0)
            .resizable(true)
            .center()
            .fullscreen(false)
            .decorations(true)
            .initialization_script(INIT_SCRIPT)
            .build()?;

            // Restaura tamano/posicion/maximizado de la sesion anterior (si los
            // hay). La primera vez no hay nada guardado y se queda con el
            // inner_size/center de arriba.
            let _ = win.restore_state(
                StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar WTM");
}
