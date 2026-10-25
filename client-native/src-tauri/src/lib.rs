// Punto de entrada de la libreria de la app WTM (Tauri v2).
// main.rs llama a run(). Separarlo en lib permite compartir el codigo
// con el target movil en el futuro.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error al iniciar WTM");
}
