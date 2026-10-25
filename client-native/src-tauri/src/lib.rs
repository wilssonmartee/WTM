// Punto de entrada de la libreria de la app WTM (Tauri v2).
// main.rs llama a run(). Separarlo en lib permite compartir el codigo
// con el target movil en el futuro.

use tauri::Manager;
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // F11 alterna pantalla completa. Alt+F4 lo maneja el SO.
    let f11 = Shortcut::new(None, Code::F11);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &f11 {
                        if let Some(win) = app.get_webview_window("main") {
                            let is_fs = win.is_fullscreen().unwrap_or(false);
                            let _ = win.set_fullscreen(!is_fs);
                            // Al salir de fullscreen, quitamos tambien la
                            // decoracion para que siga sin bordes del SO.
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
