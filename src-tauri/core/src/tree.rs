//! Task tree (folders + task definitions).
//!
//! This is the authoritative task model persisted to `tasks.json`. The
//! frontend treats it as read-only configuration; only the runtime process
//! state lives in memory.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDef {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    /// 同一父目录下兄弟文件夹的展示顺序（0..n-1，由 move/create 维护）
    #[serde(default)]
    pub order: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDef {
    pub id: String,
    pub name: String,
    pub folder_id: Option<String>,
    /// Full command line, executed via `cmd /C <command>`
    pub command: String,
    pub workdir: Option<String>,
    pub env: BTreeMap<String, String>,
    pub auto_start: bool,
    /// open the attached console tab right after start
    pub auto_attach: bool,
    /// persist this run's output to a timestamped log file under <data>/logs/
    #[serde(default)]
    pub save_log: bool,
    /// 终端类型：null/"cmd"=CMD，"powershell"=Windows PowerShell，
    /// "pwsh"=PowerShell 7，"bash"=Git Bash；空值由启动侧按默认处理
    #[serde(default)]
    pub shell: Option<String>,
    /// Windows 下经 UAC 以管理员身份启动（stdout/stderr 走日志文件回读）
    #[serde(default)]
    pub run_as_admin: bool,
    /// 同一文件夹下任务顺序（0..n-1，由 move/create 维护）
    #[serde(default)]
    pub order: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub name: String,
    pub folder_id: Option<String>,
    pub command: String,
    pub workdir: Option<String>,
    pub env: BTreeMap<String, String>,
    pub auto_start: bool,
    pub auto_attach: bool,
    #[serde(default)]
    pub save_log: bool,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub run_as_admin: bool,
}

#[derive(Debug, PartialEq)]
pub enum TreeError {
    NotFound(String),
    DuplicateName(String),
    InvalidParent(String),
    FolderNotEmpty(String),
}

impl std::fmt::Display for TreeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TreeError::NotFound(id) => write!(f, "节点不存在: {id}"),
            TreeError::DuplicateName(name) => write!(f, "同一文件夹下已存在同名节点: {name}"),
            TreeError::InvalidParent(id) => write!(f, "无效的父文件夹: {id}"),
            TreeError::FolderNotEmpty(id) => write!(f, "文件夹非空，无法删除: {id}"),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTree {
    pub folders: Vec<FolderDef>,
    pub tasks: Vec<TaskDef>,
}

impl TaskTree {
    pub fn folder(&self, id: &str) -> Option<&FolderDef> {
        self.folders.iter().find(|f| f.id == id)
    }

    pub fn task(&self, id: &str) -> Option<&TaskDef> {
        self.tasks.iter().find(|t| t.id == id)
    }

    /// folders directly under `parent` (None = root)
    pub fn child_folders(&self, parent: Option<&str>) -> Vec<&FolderDef> {
        self.folders
            .iter()
            .filter(|f| f.parent_id.as_deref() == parent)
            .collect()
    }

    pub fn child_tasks(&self, folder: Option<&str>) -> Vec<&TaskDef> {
        self.tasks
            .iter()
            .filter(|t| t.folder_id.as_deref() == folder)
            .collect()
    }

    pub fn tasks_in_folder_recursive(&self, folder_id: &str) -> Vec<&TaskDef> {
        let mut ids = HashSet::new();
        let mut stack = vec![folder_id.to_string()];
        while let Some(id) = stack.pop() {
            if ids.contains(&id) {
                continue;
            }
            ids.insert(id.clone());
            for f in self.child_folders(Some(&id)) {
                stack.push(f.id.clone());
            }
        }
        self.tasks.iter().filter(|t| match &t.folder_id {
            Some(fid) => ids.contains(fid),
            None => false,
        }).collect()
    }

    pub fn is_descendant_of(&self, id: &str, ancestor: &str) -> bool {
        let mut cur = self.folder(id).and_then(|f| f.parent_id.clone());
        while let Some(pid) = cur {
            if pid == ancestor {
                return true;
            }
            cur = self.folder(&pid).and_then(|f| f.parent_id.clone());
        }
        false
    }

    fn sibling_name_exists(&self, name: &str, parent: Option<&str>) -> bool {
        self.folders
            .iter()
            .any(|f| f.parent_id.as_deref() == parent && f.name == name)
            || self
                .tasks
                .iter()
                .any(|t| t.folder_id.as_deref() == parent && t.name == name)
    }

    /// 归一化兄弟顺序：每个「同一父目录」分组内按 (order, 原位置) 排序，
    /// 并重新编号为 0..n-1（同时把 Vec 重排成分组连续、组内按序）。
    /// 保证 order 恒为同组内的展示索引，旧数据（无 order 字段）自动按文件顺序排。
    pub fn normalize(&mut self) {
        use std::collections::BTreeMap;
        let mut groups: BTreeMap<Option<String>, Vec<(usize, i32)>> = BTreeMap::new();
        for (i, f) in self.folders.iter().enumerate() {
            groups.entry(f.parent_id.clone()).or_default().push((i, f.order));
        }
        let mut out = Vec::with_capacity(self.folders.len());
        for (parent, mut members) in groups {
            members.sort_by_key(|&(i, o)| (o, i));
            for (pos, (i, _)) in members.into_iter().enumerate() {
                let mut f = self.folders[i].clone();
                f.order = pos as i32;
                f.parent_id = parent.clone();
                out.push(f);
            }
        }
        self.folders = out;

        let mut groups: BTreeMap<Option<String>, Vec<(usize, i32)>> = BTreeMap::new();
        for (i, t) in self.tasks.iter().enumerate() {
            groups.entry(t.folder_id.clone()).or_default().push((i, t.order));
        }
        let mut out = Vec::with_capacity(self.tasks.len());
        for (folder, mut members) in groups {
            members.sort_by_key(|&(i, o)| (o, i));
            for (pos, (i, _)) in members.into_iter().enumerate() {
                let mut t = self.tasks[i].clone();
                t.order = pos as i32;
                t.folder_id = folder.clone();
                out.push(t);
            }
        }
        self.tasks = out;
    }

    pub fn create_folder(
        &mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<impl Into<String>>,
    ) -> Result<FolderDef, TreeError> {
        let id = id.into();
        let name = name.into();
        let parent_id = parent_id.map(Into::into);
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(TreeError::DuplicateName(name));
        }
        if let Some(pid) = &parent_id {
            if self.folder(pid).is_none() {
                return Err(TreeError::InvalidParent(pid.clone()));
            }
        }
        if self.sibling_name_exists(&name, parent_id.as_deref()) {
            return Err(TreeError::DuplicateName(name));
        }
        let order = self.child_folders(parent_id.as_deref()).len() as i32;
        let folder = FolderDef {
            id,
            name,
            parent_id,
            order,
        };
        self.folders.push(folder.clone());
        self.normalize();
        Ok(folder)
    }

    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<(), TreeError> {
        let idx = self
            .folders
            .iter()
            .position(|f| f.id == id)
            .ok_or_else(|| TreeError::NotFound(id.to_string()))?;
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(TreeError::DuplicateName(name));
        }
        let parent = self.folders[idx].parent_id.clone();
        if self
            .folders
            .iter()
            .enumerate()
            .any(|(i, f)| i != idx && f.parent_id == parent && f.name == name)
        {
            return Err(TreeError::DuplicateName(name));
        }
        self.folders[idx].name = name;
        Ok(())
    }

    /// Move a folder. Rejects moving into itself or its own descendant.
    /// `to_index`：移动到新父目录兄弟文件夹中的位置（默认追加到末尾）。
    pub fn move_folder(
        &mut self,
        id: &str,
        new_parent: Option<String>,
        to_index: Option<usize>,
    ) -> Result<(), TreeError> {
        if let Some(np) = &new_parent {
            if np == id || self.is_descendant_of(np, id) {
                return Err(TreeError::InvalidParent(np.clone()));
            }
            if self.folder(np).is_none() {
                return Err(TreeError::InvalidParent(np.clone()));
            }
        }
        let idx = self
            .folders
            .iter()
            .position(|f| f.id == id)
            .ok_or_else(|| TreeError::NotFound(id.to_string()))?;
        let mut folder = self.folders.remove(idx);
        // 旧组去掉该节点后重排
        self.normalize();
        folder.parent_id = new_parent;
        // 目标组的期望顺序：现成员按序 + 在 to_index 处插入本节点
        let group: Vec<String> = self
            .folders
            .iter()
            .filter(|f| f.parent_id == folder.parent_id)
            .map(|f| f.id.clone())
            .collect();
        let at = to_index.unwrap_or(group.len()).min(group.len());
        let mut nids = group.clone();
        nids.insert(at, id.to_string());
        // 按 nids 位置给整组重新编号（含本节点），保证无并列 order
        for f in &mut self.folders {
            if let Some(pos) = nids.iter().position(|x| x == &f.id) {
                f.order = pos as i32;
            }
        }
        folder.order = at as i32;
        self.folders.push(folder);
        self.normalize();
        Ok(())
    }

    /// Delete a folder with all of its descendants (folders + tasks).
    /// Returns the ids that were removed.
    pub fn delete_folder(&mut self, id: &str) -> Result<Vec<String>, TreeError> {
        if self.folder(id).is_none() {
            return Err(TreeError::NotFound(id.to_string()));
        }
        let mut removed = Vec::new();
        let mut stack = vec![id.to_string()];
        while let Some(fid) = stack.pop() {
            removed.push(fid.clone());
            let children: Vec<String> = self
                .folders
                .iter()
                .filter(|f| f.parent_id.as_deref() == Some(fid.as_str()))
                .map(|f| f.id.clone())
                .collect();
            stack.extend(children);
        }
        let removed_set: HashSet<&str> = removed.iter().map(String::as_str).collect();
        self.folders
            .retain(|f| !removed_set.contains(f.id.as_str()));
        self.tasks.retain(|t| match &t.folder_id {
            Some(fid) => !removed_set.contains(fid.as_str()),
            None => true,
        });
        self.normalize();
        Ok(removed)
    }

    pub fn create_task(
        &mut self,
        id: impl Into<String>,
        input: TaskInput,
    ) -> Result<TaskDef, TreeError> {
        let id = id.into();
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(TreeError::DuplicateName(name));
        }
        if input.command.trim().is_empty() {
            return Err(TreeError::DuplicateName("命令不能为空".to_string()));
        }
        if let Some(fid) = &input.folder_id {
            if self.folder(fid).is_none() {
                return Err(TreeError::InvalidParent(fid.clone()));
            }
        }
        if self.sibling_name_exists(&name, input.folder_id.as_deref()) {
            return Err(TreeError::DuplicateName(name));
        }
        let order = self.child_tasks(input.folder_id.as_deref()).len() as i32;
        let task = TaskDef {
            id,
            name,
            folder_id: input.folder_id,
            command: input.command,
            workdir: input.workdir,
            env: input.env,
            auto_start: input.auto_start,
            auto_attach: input.auto_attach,
            save_log: input.save_log,
            shell: input.shell,
            run_as_admin: input.run_as_admin,
            order,
        };
        self.tasks.push(task.clone());
        self.normalize();
        Ok(task)
    }

    pub fn update_task(&mut self, id: &str, input: TaskInput) -> Result<TaskDef, TreeError> {
        let idx = self
            .tasks
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| TreeError::NotFound(id.to_string()))?;
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(TreeError::DuplicateName(name));
        }
        if input.command.trim().is_empty() {
            return Err(TreeError::DuplicateName("命令不能为空".to_string()));
        }
        if let Some(fid) = &input.folder_id {
            if self.folder(fid).is_none() {
                return Err(TreeError::InvalidParent(fid.clone()));
            }
        }
        if self.tasks.iter().enumerate().any(|(i, t)| {
            i != idx && t.folder_id == input.folder_id && t.name == name
        }) {
            return Err(TreeError::DuplicateName(name));
        }
        {
            let task = &mut self.tasks[idx];
            task.name = name;
            task.folder_id = input.folder_id;
            task.command = input.command;
            task.workdir = input.workdir;
            task.env = input.env;
            task.auto_start = input.auto_start;
            task.auto_attach = input.auto_attach;
            task.save_log = input.save_log;
            task.shell = input.shell;
            task.run_as_admin = input.run_as_admin;
        }
        self.normalize(); // folder_id 变更时重排到目标组末尾
        self.tasks
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or_else(|| TreeError::NotFound(id.to_string()))
    }

    pub fn delete_task(&mut self, id: &str) -> Result<(), TreeError> {
        let before = self.tasks.len();
        self.tasks.retain(|t| t.id != id);
        if self.tasks.len() == before {
            return Err(TreeError::NotFound(id.to_string()));
        }
        self.normalize();
        Ok(())
    }

    pub fn move_task(
        &mut self,
        id: &str,
        folder_id: Option<String>,
        to_index: Option<usize>,
    ) -> Result<(), TreeError> {
        let idx = self
            .tasks
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| TreeError::NotFound(id.to_string()))?;
        if let Some(fid) = &folder_id {
            if self.folder(fid).is_none() {
                return Err(TreeError::InvalidParent(fid.clone()));
            }
        }
        let mut task = self.tasks.remove(idx);
        self.normalize();
        task.folder_id = folder_id;
        let group: Vec<String> = self
            .tasks
            .iter()
            .filter(|t| t.folder_id == task.folder_id)
            .map(|t| t.id.clone())
            .collect();
        let at = to_index.unwrap_or(group.len()).min(group.len());
        let mut nids = group.clone();
        nids.insert(at, id.to_string());
        for t in &mut self.tasks {
            if let Some(pos) = nids.iter().position(|x| x == &t.id) {
                t.order = pos as i32;
            }
        }
        task.order = at as i32;
        self.tasks.push(task);
        self.normalize();
        Ok(())
    }

    /// Look up one task by id; also expose the name for console titles.
    pub fn task_name(&self, id: &str) -> Option<String> {
        self.task(id).map(|t| t.name.clone())
    }

    /// Build a lookup map id → name for status bar / console headers.
    pub fn name_map(&self) -> HashMap<String, String> {
        self.tasks
            .iter()
            .map(|t| (t.id.clone(), t.name.clone()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> TaskTree {
        let mut t = TaskTree::default();
        t.create_folder("f1", "Web", None::<String>).unwrap();
        t.create_folder("f2", "DB", None::<String>).unwrap();
        t.create_folder("f3", "Front", Some("f1")).unwrap();
        t.create_task(
            "t1",
            TaskInput {
                name: "file-server".into(),
                folder_id: Some("f3".into()),
                command: "python -m http.server 8000".into(),
                workdir: None,
                env: BTreeMap::new(),
                auto_start: false,
                auto_attach: true,
                save_log: false,
                shell: None,
                run_as_admin: false,
            },
        )
        .unwrap();
        t
    }

    #[test]
    fn duplicate_name_rejected_in_same_folder() {
        let mut t = tree();
        assert!(matches!(
            t.create_folder("f4", "Web", None::<String>),
            Err(TreeError::DuplicateName(_))
        ));
        assert!(matches!(
            t.create_task(
                "t2",
                TaskInput {
                    name: "file-server".into(),
                    folder_id: Some("f3".into()),
                    command: "x".into(),
                    workdir: None,
                    env: BTreeMap::new(),
                    auto_start: false,
                    auto_attach: false,
                    save_log: false,
                    shell: None,
                    run_as_admin: false,
                }
            ),
            Err(TreeError::DuplicateName(_))
        ));
    }

    #[test]
    fn same_name_ok_in_different_folders() {
        let mut t = tree();
        assert!(t.create_folder("f4", "Web", Some("f2")).is_ok());
    }

    #[test]
    fn move_folder_rejects_into_own_descendant() {
        let mut t = tree();
        assert!(matches!(
            t.move_folder("f1", Some("f3".into()), None),
            Err(TreeError::InvalidParent(_))
        ));
        assert!(t.move_folder("f1", None, None).is_ok());
    }

    #[test]
    fn delete_folder_cascades() {
        let mut t = tree();
        let removed = t.delete_folder("f1").unwrap();
        assert_eq!(removed.len(), 2); // f1 + f3
        assert!(t.folder("f1").is_none());
        assert!(t.folder("f3").is_none());
        assert!(t.task("t1").is_none());
        assert!(t.folder("f2").is_some());
    }

    #[test]
    fn tasks_in_folder_recursive() {
        let t = tree();
        let ids: Vec<&str> = t
            .tasks_in_folder_recursive("f1")
            .iter()
            .map(|t| t.id.as_str())
            .collect();
        assert_eq!(ids, vec!["t1"]);
    }

    #[test]
    fn rename_checks_siblings() {
        let mut t = tree();
        assert!(matches!(
            t.rename_folder("f2", "Web"),
            Err(TreeError::DuplicateName(_))
        ));
        assert!(t.rename_folder("f2", "Database").is_ok());
    }

    #[test]
    fn create_assigns_sibling_order() {
        let mut t = tree();
        t.create_folder("f4", "Alpha", None::<String>).unwrap();
        t.create_folder("f5", "Beta", None::<String>).unwrap();
        // 兄弟文件夹 order 连续编号（tree() 已有根级 f1、f2，加上 f4、f5）
        let orders: Vec<i32> = t
            .folders
            .iter()
            .filter(|f| f.parent_id.is_none())
            .map(|f| f.order)
            .collect();
        assert_eq!(orders, vec![0, 1, 2, 3]);
    }

    #[test]
    fn move_folder_reorders_siblings() {
        let mut t = tree();
        t.create_folder("fa", "A", None::<String>).unwrap();
        t.create_folder("fb", "B", None::<String>).unwrap();
        t.create_folder("fc", "C", None::<String>).unwrap();
        // 把 C 移到最前（根级兄弟：f1, f2, fa, fb, fc → fc 排最前）
        t.move_folder("fc", None, Some(0)).unwrap();
        let order: Vec<String> = t.child_folders(None).iter().map(|f| f.id.clone()).collect();
        assert_eq!(order, vec!["fc", "f1", "f2", "fa", "fb"]);
        // 把 B 移到 index 1
        t.move_folder("fb", None, Some(1)).unwrap();
        let order: Vec<String> = t.child_folders(None).iter().map(|f| f.id.clone()).collect();
        assert_eq!(order, vec!["fc", "fb", "f1", "f2", "fa"]);
        // 移入子文件夹
        t.move_folder("fc", Some("f1".into()), None).unwrap();
        assert_eq!(t.folder("fc").unwrap().parent_id.as_deref(), Some("f1"));
        assert_eq!(t.child_folders(Some("f1")).len(), 1);
    }

    #[test]
    fn move_task_reorders_siblings() {
        let mut t = tree();
        for (id, name) in [("a", "A"), ("b", "B"), ("c", "C")] {
            t.create_task(
                id,
                TaskInput {
                    name: name.into(),
                    folder_id: Some("f3".into()),
                    command: "x".into(),
                    workdir: None,
                    env: BTreeMap::new(),
                    auto_start: false,
                    auto_attach: false,
                    save_log: false,
                    shell: None,
                    run_as_admin: false,
                },
            )
            .unwrap();
        }
        // C → 最前（tree() 里 f3 下原有 t1，再加 a、b、c）
        t.move_task("c", Some("f3".into()), Some(0)).unwrap();
        let order: Vec<String> = t.child_tasks(Some("f3")).iter().map(|x| x.id.clone()).collect();
        assert_eq!(order, vec!["c", "t1", "a", "b"]);
        // b → index 1
        t.move_task("b", Some("f3".into()), Some(1)).unwrap();
        let order: Vec<String> = t.child_tasks(Some("f3")).iter().map(|x| x.id.clone()).collect();
        assert_eq!(order, vec!["c", "b", "t1", "a"]);
    }

    #[test]
    fn legacy_zero_orders_normalize_to_file_order() {
        // 模拟旧数据：order 全为 0/missing → normalize 后按文件顺序编号
        let mut t = TaskTree {
            folders: vec![FolderDef { id: "x1".into(), name: "1".into(), parent_id: None, order: 0 }],
            tasks: vec![],
        };
        t.normalize();
        assert_eq!(t.child_folders(None)[0].order, 0);
    }
}
