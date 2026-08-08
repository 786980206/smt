//! 配置目录解析：优先与可执行文件同目录（便携模式），目录不可写时回退应用数据目录。

use std::fs;
use std::path::{Path, PathBuf};

/// 目录是否可写（创建并删除探针文件）。
fn writable(dir: &Path) -> bool {
    if let Err(e) = fs::create_dir_all(dir) {
        eprintln!("[config] 创建目录失败 {dir:?}: {e}");
        return false;
    }
    let probe = dir.join(format!(".smt-probe-{}", std::process::id()));
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    if !ok {
        eprintln!("[config] 目录不可写 {dir:?}，回退应用数据目录");
    }
    ok
}

/// 解析配置基目录（配置 YAML、logs/、scripts/ 的父目录）。
///
/// 优先级：
/// 1. 可执行文件所在目录（smt.yaml 与 exe 同层级，方便整体拷贝迁移）且可写；
/// 2. 系统应用数据目录（AppData\Roaming\...）。
pub fn resolve_base_dir(app_data_dir: PathBuf) -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .filter(|dir| writable(dir))
        .unwrap_or_else(|| {
            let _ = fs::create_dir_all(&app_data_dir);
            app_data_dir
        })
}