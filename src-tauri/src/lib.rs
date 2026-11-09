use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// PDF files the OS asked us to open (double-click, "Open with", drag onto the Dock icon).
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

fn pdf_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".pdf") || a.to_lowercase().ends_with(".docx"))
        .collect()
}

/// Called once by the UI at startup to pick up files passed on launch.
#[tauri::command]
fn take_opened_files(state: tauri::State<Opened>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. double-clicking another PDF on Windows) goes to the open window.
            let files = pdf_args(argv);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Opened(Mutex::new(pdf_args(std::env::args()))))
        .invoke_handler(tauri::generate_handler![take_opened_files])
        .build(tauri::generate_context!())
        .expect("error while building MiPDF");

    app.run(|_app, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            let files: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            _app.state::<Opened>().0.lock().unwrap().extend(files.clone());
            let _ = _app.emit("open-files", files);
        }
    });
}
