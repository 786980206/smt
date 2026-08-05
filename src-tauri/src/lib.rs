//! SMT Task Manager — IPC commands and lifecycle.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

use smt_core::{ProcessStatus, TaskInput};
use process::{EventSink, ProcessManager};
use std::sync::Arc;

mod process;
mod store;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskTreePayload {
    folders: Vec<smt_core::FolderDef>,
    tasks: Vec<smt_core::TaskDef>,
    statuses: HashMap<String, ProcessStatus>,
}

impl TaskTreePayload {
    fn build() -> Self {
        let tree = store::store().tree();
        let statuses = process_manager().statuses(&tree.tasks.iter().map(|t| t.id.clone()).collect::<Vec<_>>());
        Self {
            folders: tree.folders,
            tasks: tree.tasks,
            statuses,
        }
    }
}

fn process_manager() -> &'static ProcessManager {
    static PM: OnceLock<ProcessManager> = OnceLock::new();
    PM.get_or_init(ProcessManager::default)
}

// ────────────────────────────────────────────────────────────────
// Task tree CRUD
// ────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_tasks() -> Result<TaskTreePayload, String> {
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn create_folder(name: String, parent_id: Option<String>) -> Result<TaskTreePayload, String> {
    let id = gen_id("folder");
    store::store().mutate(|tree| tree.create_folder(id, name, parent_id))?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn rename_folder(id: String, name: String) -> Result<TaskTreePayload, String> {
    store::store().mutate(|tree| tree.rename_folder(&id, &name))?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn move_folder(id: String, parent_id: Option<String>) -> Result<TaskTreePayload, String> {
    store::store().mutate(|tree| tree.move_folder(&id, parent_id))?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn delete_folder(id: String) -> Result<TaskTreePayload, String> {
    store::store().mutate(|tree| {
        tree.delete_folder(&id)?;
        Ok(())
    })?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn create_task(input: TaskInput) -> Result<TaskTreePayload, String> {
    let id = gen_id("task");
    store::store().mutate(|tree| tree.create_task(id, input))?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn update_task(id: String, input: TaskInput) -> Result<TaskTreePayload, String> {
    store::store().mutate(|tree| tree.update_task(&id, input))?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn delete_task(id: String) -> Result<TaskTreePayload, String> {
    store::store().mutate(|tree| tree.delete_task(&id))?;
    Ok(TaskTreePayload::build())
}

#[tauri::command]
fn move_task(id: String, folder_id: Option<String>) -> Result<TaskTreePayload, String> {
    store::store().mutate(|tree| tree.move_task(&id, folder_id))?;
    Ok(TaskTreePayload::build())
}

// ────────────────────────────────────────────────────────────────
// Process lifecycle
// ────────────────────────────────────────────────────────────────

#[tauri::command]
fn start_process(app: AppHandle, task_id: String) -> Result<ProcessStatus, String> {
    let task = store::store()
        .tree()
        .task(&task_id)
        .cloned()
        .ok_or_else(|| format!("任务不存在: {task_id}"))?;
    process_manager().start(Arc::new(app.clone()) as Arc<dyn EventSink>, task)
}

#[tauri::command]
fn stop_process(app: AppHandle, task_id: String) -> Result<ProcessStatus, String> {
    process_manager().stop(Arc::new(app.clone()) as Arc<dyn EventSink>, &task_id)
}

#[tauri::command]
fn restart_process(app: AppHandle, task_id: String) -> Result<ProcessStatus, String> {
    let task = store::store()
        .tree()
        .task(&task_id)
        .cloned()
        .ok_or_else(|| format!("任务不存在: {task_id}"))?;
    process_manager().restart(Arc::new(app.clone()) as Arc<dyn EventSink>, task)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachResult {
    task_id: String,
    task_name: String,
    status: ProcessStatus,
    /// 当前运行期的日志文件全文（未开启日志保存则为空串）
    text: String,
    /// 日志文件路径（未开启日志保存则为 null）
    log_path: Option<String>,
}

#[tauri::command]
fn attach_console(task_id: String) -> Result<AttachResult, String> {
    let tree = store::store().tree();
    let task_name = tree
        .task(&task_id)
        .map(|t| t.name.clone())
        .unwrap_or_else(|| task_id.clone());
    let (status, text, log_path) = process_manager()
        .attach_console(&task_id)
        .unwrap_or((ProcessStatus::default(), String::new(), None));
    Ok(AttachResult {
        task_id,
        task_name,
        status,
        text,
        log_path,
    })
}

/// 用系统默认浏览器打开地址（仅允许 http/https，防注入）。
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持 http/https 地址".to_string());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开浏览器失败: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开浏览器失败: {e}"))?;
    }
    Ok(())
}

/// 端口监视器：周期扫描监听端口，发 process-ports 事件（无进程时发空 map，
/// 让前端清掉过期的端口显示）。
fn start_ports_monitor(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let ports = process_manager().listening_ports();
        let _ = app.emit(process::PORT_EVENT, serde_json::json!({ "ports": ports }));
    });
}

// ────────────────────────────────────────────────────────────────
// Lifecycle: seed autoStart tasks on launch, kill all on exit
// ────────────────────────────────────────────────────────────────

fn start_auto_start(app: &AppHandle) {
    let tree = store::store().tree();
    for task in tree.tasks.iter().filter(|t| t.auto_start) {
        if let Err(err) = process_manager().start(Arc::new(app.clone()) as Arc<dyn EventSink>, task.clone()) {
            let _ = app.emit(
                process::STATUS_EVENT,
                serde_json::json!({
                    "taskId": task.id,
                    "status": { "state": "error", "pid": null, "exitCode": null,
                                "startedAt": null, "error": err }
                }),
            );
        }
    }
}

fn gen_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{prefix}-{ms}-{:06}", rand_tail())
}

fn rand_tail() -> u32 {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0))
        ^ c
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            create_folder,
            rename_folder,
            move_folder,
            delete_folder,
            create_task,
            update_task,
            delete_task,
            move_task,
            start_process,
            stop_process,
            restart_process,
            attach_console,
            open_in_browser,
        ])
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            store::init_store(dir.clone());
            process::set_log_dir(dir.join("logs"));
            start_auto_start(&app.handle());
            start_ports_monitor(&app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                process_manager().kill_all();
            }
            let _ = app;
        });
}
