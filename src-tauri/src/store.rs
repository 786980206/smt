//! tasks.json persistence (authoritative task model).

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use smt_core::TaskTree;

const FILE_NAME: &str = "tasks.json";

/// Seed for first run: a folder + the file-server example task.
fn seed_tree() -> TaskTree {
    let mut tree = TaskTree::default();
    let folder_id = "folder-web-services";
    let _ = tree.create_folder(folder_id, "Web 服务", None::<String>);
    let _ = tree.create_task(
        "task-file-server",
        smt_core::TaskInput {
            name: "file-server".to_string(),
            folder_id: Some(folder_id.to_string()),
            command: "python -m http.server 8000".to_string(),
            workdir: None,
            env: Default::default(),
            auto_start: false,
            auto_attach: true,
            save_log: false,
            shell: None,
            run_as_admin: false,
        },
    );
    tree
}

pub struct TaskStore {
    path: PathBuf,
    tree: Mutex<TaskTree>,
}

impl TaskStore {
    pub fn init(dir: PathBuf) -> Self {
        let path = dir.join(FILE_NAME);
        let mut tree = if path.exists() {
            match fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str::<TaskTree>(&s).ok())
            {
                Some(t) => t,
                None => seed_tree(), // corrupt file → reseed
            }
        } else {
            let t = seed_tree();
            let _ = fs::create_dir_all(&dir);
            let _ = fs::write(&path, serde_json::to_string_pretty(&t).unwrap_or_default());
            t
        };
        // 旧数据可能没有 order 字段：归一化后顺序即文件顺序；
        // 同时保证每次加载后兄弟 group 内 order 连续。
        tree.normalize();
        Self {
            path,
            tree: Mutex::new(tree),
        }
    }

    pub fn tree(&self) -> TaskTree {
        self.tree.lock().unwrap().clone()
    }

    pub fn mutate<R>(
        &self,
        f: impl FnOnce(&mut TaskTree) -> Result<R, smt_core::TreeError>,
    ) -> Result<R, String> {
        let mut tree = self.tree.lock().unwrap();
        let result = f(&mut tree).map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(&*tree).map_err(|e| format!("序列化失败: {e}"))?;
        fs::write(&self.path, json).map_err(|e| format!("写入失败: {e}"))?;
        Ok(result)
    }
}

/// Global accessor for the task store (set up once in `setup`).
/// The store is leaked for a 'static lifetime — it lives for the whole app.
static STORE: OnceLock<&'static TaskStore> = OnceLock::new();

pub fn init_store(dir: PathBuf) {
    let store: &'static TaskStore = Box::leak(Box::new(TaskStore::init(dir)));
    let _ = STORE.set(store);
}

pub fn store() -> &'static TaskStore {
    *STORE.get().expect("TaskStore not initialized")
}
