#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod scan;
mod services;
mod targets;

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePayload {
    name: String,
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct SavedFile {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvInfo {
    version: &'static str,
    engine: &'static str,
    os: &'static str,
    arch: &'static str,
    mode: &'static str,
}

#[tauri::command]
async fn env_info() -> EnvInfo {
    EnvInfo {
        version: env!("CARGO_PKG_VERSION"),
        engine: "RustScan 2.4.1",
        os: "Windows 10 / 11",
        arch: std::env::consts::ARCH,
        mode: "NATIVE WEBVIEW2",
    }
}

#[tauri::command]
async fn pick_target_file() -> Result<Option<FilePayload>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .add_filter("Target lists", &["txt", "lst", "csv", "conf"])
        .add_filter("All files", &["*"])
        .set_title("Load target vector")
        .pick_file()
        .await;
    let Some(handle) = handle else { return Ok(None) };
    let path = handle.path().to_path_buf();
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("cannot stat {}: {e}", path.display()))?;
    if meta.len() > 4 * 1024 * 1024 {
        return Err("target file is larger than 4 MiB".into());
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "targets.txt".to_string());
    Ok(Some(FilePayload {
        name,
        path: path.display().to_string(),
        content,
    }))
}

#[tauri::command]
async fn save_export(default_name: String, contents: String) -> Result<Option<SavedFile>, String> {
    let ext = default_name.rsplit('.').next().unwrap_or("txt").to_string();
    let handle = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .set_title("Export sweep results")
        .save_file()
        .await;
    let Some(handle) = handle else { return Ok(None) };
    let path = handle.path().to_path_buf();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    tokio::fs::write(&path, contents)
        .await
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(Some(SavedFile { path: path.display().to_string() }))
}

#[tauri::command]
fn window_control(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    match action.as_str() {
        "min" => window.minimize().map_err(|e| e.to_string()),
        "max" => {
            let maximized = window.is_maximized().unwrap_or(false);
            if maximized {
                window.unmaximize().map_err(|e| e.to_string())
            } else {
                window.maximize().map_err(|e| e.to_string())
            }
        }
        "close" => window.close().map_err(|e| e.to_string()),
        other => Err(format!("unknown window action: {other}")),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(scan::AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("RUSTSCAN // NEON GRID");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan::start_scan,
            scan::cancel_scan,
            scan::preview_targets,
            pick_target_file,
            save_export,
            env_info,
            window_control
        ])
        .run(tauri::generate_context!())
        .expect("failed to run RustScan Neon");
}
