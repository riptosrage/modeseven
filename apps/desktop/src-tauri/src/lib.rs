/// The Mac app is a thin native shell around the same web build that runs in
/// browsers. Native-only powers (file dialogs now; MIDI and low-latency audio
/// later) are added here as plugins, so module code stays the same everywhere.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Mode 7");
}
