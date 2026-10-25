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
// F11 alterna pantalla completa.

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

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
    listDir: function(path){ return inv('wtm_list_dir', { path: path }); }
  };
})();
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let f11 = Shortcut::new(None, Code::F11);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &f11 {
                        if let Some(win) = app.get_webview_window("main") {
                            let is_fs = win.is_fullscreen().unwrap_or(false);
                            let _ = win.set_fullscreen(!is_fs);
                            let _ = win.set_decorations(false);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            wtm_pick_file,
            wtm_pick_dir,
            wtm_read_file,
            wtm_list_dir
        ])
        .setup(move |app| {
            app.global_shortcut().register(f11)?;
            // Creamos la ventana en Rust para inyectar el puente nativo en
            // toda pagina (incluida la UI remota del core).
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("WTM")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 560.0)
                .resizable(true)
                .center()
                .fullscreen(true)
                .decorations(false)
                .initialization_script(INIT_SCRIPT)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar WTM");
}
