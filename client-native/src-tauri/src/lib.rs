// Punto de entrada de la libreria de la app WTM (Tauri v2).
// F11 alterna pantalla completa. La seleccion/lectura de archivos la maneja el
// propio webview (input de archivo + IndexedDB), sin depender de IPC remoto
// (que Tauri restringe por dominio y desaconseja por seguridad).

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let f11 = Shortcut::new(None, Code::F11);

    tauri::Builder::default()
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
        .setup(move |app| {
            app.global_shortcut().register(f11)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar WTM");
}
