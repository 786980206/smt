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
        let folder = FolderDef {
            id,
            name,
            parent_id,
        };
        self.folders.push(folder.clone());
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
    pub fn move_folder(
        &mut self,
        id: &str,
        new_parent: Option<String>,
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
        self.folders[idx].parent_id = new_parent;
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
        };
        self.tasks.push(task.clone());
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
        Ok(task.clone())
    }

    pub fn delete_task(&mut self, id: &str) -> Result<(), TreeError> {
        let before = self.tasks.len();
        self.tasks.retain(|t| t.id != id);
        if self.tasks.len() == before {
            return Err(TreeError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn move_task(&mut self, id: &str, folder_id: Option<String>) -> Result<(), TreeError> {
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
        self.tasks[idx].folder_id = folder_id;
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
            t.move_folder("f1", Some("f3".into())),
            Err(TreeError::InvalidParent(_))
        ));
        assert!(t.move_folder("f1", None).is_ok());
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
}
