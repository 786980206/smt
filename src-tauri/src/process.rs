//! Managed subprocess framework.
//!
//! Every task definition maps to at most one managed child process:
//!
//! - Windows 上经 `cmd.exe /C <command>` 启动（PATH 解析 + BAT 脚本支持；
//!   所有 stdio 重定向，无控制台闪烁）
//! - stdin 置空（黑窗是只读输出视图）
//! - stdout/stderr 由独立 reader 线程读取
//! - 行按 ~50ms 批量 flush 到前端（避免逐行 IPC）
//! - 任务开启「保存日志」时，每次启动都会在 `<data>/logs/` 生成一个新的
//!   带时间戳的日志文件，从启动到退出全量落盘 —— 无内存缓存，每次重启
//!   都是全新的过程
//! - 停止用 `taskkill /PID <pid> /T /F` 杀整个进程树
//! - reaper 线程只负责等待退出并更新最终状态，绝不主动杀进程
//!   （长运行的后台服务不能被超时误杀）

use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use smt_core::{ConsoleLine, ConsoleStream, ProcessStatus, TaskDef};
use tauri::Emitter;

use crate::store;

/// Abstraction over where process events go. Tauri emits to the frontend;
/// tests use an in-memory sink (no WebView/DLL dependencies).
pub trait EventSink: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

impl EventSink for tauri::AppHandle {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        let _ = self.emit(event, payload);
    }
}

pub const OUTPUT_EVENT: &str = "process-output";
pub const STATUS_EVENT: &str = "process-status";
pub const PORT_EVENT: &str = "process-ports";

const FLUSH_INTERVAL: Duration = Duration::from_millis(50);
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_POLL: Duration = Duration::from_millis(50);
const READ_BUFFER_SIZE: usize = 8192;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 日志文件目录（setup 时设置）。未设置时即使任务开启 save_log 也不落盘。
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_log_dir(dir: PathBuf) {
    let _ = fs::create_dir_all(&dir);
    let _ = LOG_DIR.set(dir);
}

struct ManagedProc {
    child: Mutex<Option<Child>>,
    status: Mutex<ProcessStatus>,
    /// desired == Stopped means a user requested stop (→ Stopped status);
    /// otherwise a natural exit is reported as Exited(code).
    desired_stop: Mutex<bool>,
    /// fed by reader threads, drained by the flush thread
    tx: Mutex<Option<Sender<ConsoleLine>>>,
    /// 当前运行期的日志文件（task.save_log 开启时才有）
    log: Mutex<Option<LogFile>>,
}

struct LogFile {
    path: PathBuf,
    writer: BufWriter<File>,
}

impl LogFile {
    fn write_line(&mut self, line: &ConsoleLine) {
        let stamp = fmt_hms_ms(line.at);
        let stream = match line.stream {
            ConsoleStream::Stdout => "stdout",
            ConsoleStream::Stderr => "stderr",
        };
        let _ = writeln!(self.writer, "[{stamp}] [{stream}] {}", line.text);
        let _ = self.writer.flush();
    }
}

impl ManagedProc {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(ProcessStatus::default()),
            desired_stop: Mutex::new(false),
            tx: Mutex::new(None),
            log: Mutex::new(None),
        }
    }
}

/// Global registry of managed processes (one per task id).
#[derive(Default)]
pub struct ProcessManager {
    procs: Mutex<HashMap<String, Arc<ManagedProc>>>,
}

type Pid = u32;

impl ProcessManager {
    fn proc(&self, task_id: &str) -> Option<Arc<ManagedProc>> {
        self.procs.lock().unwrap().get(task_id).cloned()
    }

    fn ensure(&self, task_id: String) -> Arc<ManagedProc> {
        let mut map = self.procs.lock().unwrap();
        map.entry(task_id.clone())
            .or_insert_with(|| Arc::new(ManagedProc::new()))
            .clone()
    }

    fn is_live(p: &ManagedProc) -> bool {
        p.child
            .lock()
            .unwrap()
            .as_mut()
            .map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false))
            .unwrap_or(false)
    }

    /// Current status of every known task (stopped default for unknown ids).
    pub fn statuses(&self, task_ids: &[String]) -> HashMap<String, ProcessStatus> {
        let map = self.procs.lock().unwrap();
        task_ids
            .iter()
            .map(|id| {
                let status = map
                    .get(id)
                    .map(|p| p.status.lock().unwrap().clone())
                    .unwrap_or_default();
                (id.clone(), status)
            })
            .collect()
    }

    /// 控制台附加：状态 + 当前运行期日志文件的全部内容（未开日志则为空串）。
    pub fn attach_console(
        &self,
        task_id: &str,
    ) -> Option<(ProcessStatus, String, Option<String>)> {
        let p = self.proc(task_id)?;
        let status = p.status.lock().unwrap().clone();
        let log = p.log.lock().unwrap();
        match log.as_ref() {
            Some(l) => {
                let text = fs::read_to_string(&l.path).unwrap_or_default();
                Some((status, text, Some(l.path.to_string_lossy().into_owned())))
            }
            None => Some((status, String::new(), None)),
        }
    }

    /// Kill every live child (called on app exit).
    pub fn kill_all(&self) {
        let procs: Vec<Arc<ManagedProc>> = self
            .procs
            .lock()
            .unwrap()
            .values()
            .filter(|p| Self::is_live(p))
            .cloned()
            .collect();
        for p in procs {
            let pid = p
                .child
                .lock()
                .unwrap()
                .as_ref()
                .map(|c| c.id());
            if let Some(pid) = pid {
                kill_tree(pid);
            }
        }
    }

    /// 扫描每个存活任务的监听端口，返回 task_id → 可访问 URL 列表。
    ///
    /// 任务经 `cmd /C` 启动，真正监听端口的往往是子进程（如 python），
    /// 所以要先枚举整棵进程树再与 netstat 的 PID 比对。
    pub fn listening_ports(&self) -> HashMap<String, Vec<String>> {
        let mut roots: HashMap<u32, String> = HashMap::new();
        {
            let map = self.procs.lock().unwrap();
            for (id, p) in map.iter() {
                if let Some(pid) = p.child.lock().unwrap().as_ref().map(|c| c.id()) {
                    roots.insert(pid, id.clone());
                }
            }
        }
        if roots.is_empty() {
            return HashMap::new();
        }
        let root_pids: Vec<u32> = roots.keys().cloned().collect();
        let pid_to_root = process_tree(&root_pids);

        let mut result: HashMap<String, BTreeSet<String>> = HashMap::new();
        #[cfg(windows)]
        if let Ok(out) = Command::new("netstat").args(["-ano"]).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() >= 5
                    && (cols[0] == "TCP" || cols[0] == "TCP6")
                    && cols[3] == "LISTENING"
                {
                    let Ok(pid) = cols[4].parse::<u32>() else {
                        continue;
                    };
                    let Some(root) = pid_to_root.get(&pid) else {
                        continue;
                    };
                    let Some(task_id) = roots.get(root) else {
                        continue;
                    };
                    let Some(url) = url_for_local(cols[1]) else {
                        continue;
                    };
                    result.entry(task_id.clone()).or_default().insert(url);
                }
            }
        }
        result
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().collect()))
            .collect()
    }

    pub fn start(&self, sink: Arc<dyn EventSink>, task: TaskDef) -> Result<ProcessStatus, String> {
        let p = self.ensure(task.id.clone());
        Self::start_inner(p, sink, task)
    }

    fn start_inner(
        p: Arc<ManagedProc>,
        sink: Arc<dyn EventSink>,
        task: TaskDef,
    ) -> Result<ProcessStatus, String> {
        {
            let mut guard = p.child.lock().unwrap();
            if let Some(c) = guard.as_mut() {
                if c.try_wait().map(|s| s.is_none()).unwrap_or(false) {
                    return Err("进程已在运行中".to_string());
                }
            }
        }

        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd.exe");
            c.args(["/C", &task.command]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let exe = task.command.split_whitespace().next().unwrap_or("");
            let args: Vec<&str> = task.command.split_whitespace().skip(1).collect();
            let mut c = Command::new(exe);
            c.args(&args);
            c
        };
        cmd.env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (k, v) in &task.env {
            cmd.env(k, v);
        }
        if let Some(dir) = &task.workdir {
            if std::path::Path::new(dir).is_dir() {
                cmd.current_dir(dir);
            }
        }

        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(err) => {
                p.status.lock().unwrap().error(format!("启动失败: {err}"));
                let status = p.status.lock().unwrap().clone();
                emit_status(&sink, &task.id, &status);
                return Err(format!("启动失败: {err}"));
            }
        };
        let pid = child.id();

        *p.desired_stop.lock().unwrap() = false;
        *p.status.lock().unwrap() = ProcessStatus::starting(Some(pid), now_ms());
        *p.child.lock().unwrap() = Some(child);
        // 每次启动都是全新过程：开启保存日志则新建一个带时间戳的日志文件
        *p.log.lock().unwrap() = if task.save_log {
            LOG_DIR.get().and_then(|dir| {
                let path = dir.join(format!(
                    "{}-{}.log",
                    fmt_file_stamp(now_ms()),
                    sanitize(&task.id)
                ));
                File::create(&path)
                    .ok()
                    .map(|f| LogFile {
                        path,
                        writer: BufWriter::new(f),
                    })
            })
        } else {
            None
        };
        emit_status(&sink, &task.id, &p.status.lock().unwrap());
        p.status.lock().unwrap().running();
        emit_status(&sink, &task.id, &p.status.lock().unwrap());

        let (tx, rx) = mpsc::channel::<ConsoleLine>();
        *p.tx.lock().unwrap() = Some(tx);
        let sink2 = sink.clone();
        let task_id2 = task.id.clone();
        std::thread::spawn(move || run_flush(sink2, task_id2, rx));

        if let Some(stream) = p.child.lock().unwrap().as_mut().unwrap().stdout.take() {
            spawn_reader(stream, ConsoleStream::Stdout, p.clone());
        }
        if let Some(stream) = p.child.lock().unwrap().as_mut().unwrap().stderr.take() {
            spawn_reader(stream, ConsoleStream::Stderr, p.clone());
        }

        let p2 = p.clone();
        let sink3 = sink.clone();
        std::thread::spawn(move || {
            // 等待进程自然退出或被 stop()/kill_tree 杀掉后，回收并更新最终状态。
            // 注意：绝不在这里做超时强杀 —— 长时间运行的后台服务会被误杀。
            loop {
                let exited = {
                    let mut guard = p2.child.lock().unwrap();
                    matches!(
                        guard.as_mut().and_then(|c| c.try_wait().ok()),
                        Some(Some(_))
                    )
                };
                if exited {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let code = {
                let mut guard = p2.child.lock().unwrap();
                let code = guard
                    .as_mut()
                    .and_then(|c| c.try_wait().ok())
                    .flatten()
                    .and_then(|s| s.code());
                *guard = None;
                code
            };
            let desired = *p2.desired_stop.lock().unwrap();
            let mut status = p2.status.lock().unwrap();
            if desired {
                status.stopped();
            } else {
                status.exited(code.or(Some(1)));
            }
            drop(status);
            emit_status(&sink3, &task.id, &p2.status.lock().unwrap());
        });

        let status = p.status.lock().unwrap().clone();
        Ok(status)
    }

    pub fn stop(&self, sink: Arc<dyn EventSink>, task_id: &str) -> Result<ProcessStatus, String> {
        let p = self
            .proc(task_id)
            .ok_or_else(|| "任务进程不存在".to_string())?;
        let pid = {
            let mut guard = p.child.lock().unwrap();
            match guard.as_mut() {
                Some(c) => {
                    if c.try_wait().map(|s| s.is_none()).unwrap_or(false) {
                        *p.desired_stop.lock().unwrap() = true;
                        p.status.lock().unwrap().stopping();
                        Some(c.id())
                    } else {
                        None
                    }
                }
                None => None,
            }
        };
    let Some(pid) = pid else {
        *p.desired_stop.lock().unwrap() = true;
        p.status.lock().unwrap().stopped();
        let status = p.status.lock().unwrap().clone();
        emit_status(&sink, task_id, &status);
        return Ok(status);
    };
        kill_tree(pid);
        emit_status(&sink, task_id, &p.status.lock().unwrap());
        // 不再阻塞等待：reaper 线程会在退出后设置最终状态
        let status = p.status.lock().unwrap().clone();
        Ok(status)
    }

    pub fn restart(&self, sink: Arc<dyn EventSink>, task: TaskDef) -> Result<ProcessStatus, String> {
        let p = self.ensure(task.id.clone());
        p.status.lock().unwrap().restarting();
        emit_status(&sink, &task.id, &p.status.lock().unwrap());
        let _ = self.stop(sink.clone(), &task.id);
        // 等待 reaper 收尾 + 重新启动，放到后台线程避免阻塞 UI
        let p2 = p.clone();
        let sink2 = sink.clone();
        let task_id = task.id.clone();
        std::thread::spawn(move || {
            let deadline = Instant::now() + STOP_WAIT_TIMEOUT;
            loop {
                if p2.child.lock().unwrap().is_none() {
                    break;
                }
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(STOP_POLL);
            }
            let Some(task) = store::store().tree().task(&task_id).cloned() else {
                return;
            };
            let _ = Self::start_inner(p2, sink2, task);
        });
        let status = p.status.lock().unwrap().clone();
        Ok(status)
    }
}

fn run_flush(sink: Arc<dyn EventSink>, task_id: String, rx: Receiver<ConsoleLine>) {
    let mut pending: Vec<ConsoleLine> = Vec::new();
    let mut deadline = Instant::now() + FLUSH_INTERVAL;
    loop {
        let wait = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(wait) {
            Ok(line) => pending.push(line),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                if !pending.is_empty() {
                    sink.emit_json(
                        OUTPUT_EVENT,
                        serde_json::json!({ "taskId": task_id, "lines": pending }),
                    );
                }
                break;
            }
        }
        if Instant::now() >= deadline && !pending.is_empty() {
            let batch = std::mem::take(&mut pending);
            sink.emit_json(
                OUTPUT_EVENT,
                serde_json::json!({ "taskId": task_id, "lines": batch }),
            );
            deadline = Instant::now() + FLUSH_INTERVAL;
        }
    }
}

fn emit_status(sink: &Arc<dyn EventSink>, task_id: &str, status: &ProcessStatus) {
    sink.emit_json(
        STATUS_EVENT,
        serde_json::json!({ "taskId": task_id, "status": status }),
    );
}

/// Kill the whole process tree on Windows. Tolerant of dead/missing pids.
fn kill_tree(pid: Pid) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = pid; // POSIX: std::process handles the direct child only
    }
}

/// 枚举进程树：输入根 PID，返回 pid → 所属根 pid 的映射（含根自身）。
/// Windows 下用 PowerShell 一次性取全量 pid/parent 映射后本地构建。
fn process_tree(roots: &[u32]) -> HashMap<u32, u32> {
    let mut out: HashMap<u32, u32> = HashMap::new();
    let mut parent_of: HashMap<u32, u32> = HashMap::new();
    #[cfg(windows)]
    {
        if let Ok(pw) = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId)\" }",
            ])
            .output()
        {
            for line in String::from_utf8_lossy(&pw.stdout).lines() {
                let mut it = line.trim().splitn(2, ',');
                let (Some(pid), Some(parent)) = (it.next(), it.next()) else {
                    continue;
                };
                if let (Ok(pid), Ok(parent)) = (pid.parse::<u32>(), parent.parse::<u32>()) {
                    parent_of.insert(pid, parent);
                }
            }
        }
    }
    for &root in roots {
        out.insert(root, root);
    }
    // 同一 pid 归到它所属的根；进程可能已退出，容忍缺失
    let mut queue: std::collections::VecDeque<u32> = roots.to_vec().into();
    while let Some(pid) = queue.pop_front() {
        let root = out[&pid];
        let children: Vec<u32> = parent_of
            .iter()
            .filter(|(_, &p)| p == pid)
            .map(|(&c, _)| c)
            .collect();
        for child in children {
            out.insert(child, root);
            queue.push_back(child);
        }
    }
    out
}

/// netstat 本地地址 → 可访问 URL（任意地址绑定映射到 127.0.0.1）。
fn url_for_local(local: &str) -> Option<String> {
    let (addr, port) = local.rsplit_once(':')?;
    if !port.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let host = match addr {
        "0.0.0.0" | "[::]" | "::" => "127.0.0.1".to_string(),
        a => a.to_string(), // 已含 IPv6 方括号则原样保留
    };
    Some(format!("http://{host}:{port}"))
}

/// Reader thread: drain a pipe into the log file (if enabled) + IPC channel.
/// Bytes are split on `\n` and decoded with UTF-8 lossy fallback (GBK output
/// from user scripts degrades to replacement chars instead of crashing).
fn spawn_reader(
    mut stream: impl Read + Send + 'static,
    kind: ConsoleStream,
    proc: Arc<ManagedProc>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUFFER_SIZE];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            let n = match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            carry.extend_from_slice(&buf[..n]);
            let mut start = 0usize;
            while let Some(rel) = carry[start..].iter().position(|&b| b == b'\n') {
                push_line(kind, &carry[start..start + rel], &proc);
                start += rel + 1;
            }
            carry.drain(..start);
            if carry.len() > READ_BUFFER_SIZE * 4 {
                // pathological single "line" (binary output): force flush
                push_line(kind, &carry, &proc);
                carry.clear();
            }
        }
        if !carry.is_empty() {
            push_line(kind, &carry, &proc);
        }
    });
}

/// 解码一行输出：优先 UTF-8（Python 等按 PYTHONIOENCODING=utf-8 输出）；
/// 失败时回退到 GBK —— Windows 系统程序（ping/ipconfig 等）的中文本地化
/// 输出是 GBK/GB2312 编码。
fn decode_line(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            #[cfg(windows)]
            {
                let (cow, _, _) = encoding_rs::GBK.decode(bytes);
                cow.into_owned()
            }
            #[cfg(not(windows))]
            {
                String::from_utf8_lossy(bytes).into_owned()
            }
        }
    }
}

fn push_line(kind: ConsoleStream, bytes: &[u8], proc: &ManagedProc) {
    let text = decode_line(bytes)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    if text.is_empty() {
        return;
    }
    let line = ConsoleLine {
        at: now_ms(),
        stream: kind,
        text,
    };
    if let Some(log) = proc.log.lock().unwrap().as_mut() {
        log.write_line(&line);
    }
    if let Some(tx) = proc.tx.lock().unwrap().as_ref() {
        let _ = tx.send(line);
    }
}

/// `HH:MM:SS.mmm`（本地时间，日志行前缀）
fn fmt_hms_ms(ms: u64) -> String {
    use chrono::{TimeZone, Timelike};
    let t = chrono::Local.timestamp_millis_opt(ms as i64).unwrap();
    format!("{:02}:{:02}:{:02}.{:03}", t.hour(), t.minute(), t.second(), t.nanosecond() / 1_000_000)
}

/// `yyyyMMdd-HHmmss-mmm`（本地时间，日志文件名时间戳）
fn fmt_file_stamp(ms: u64) -> String {
    use chrono::{TimeZone, Timelike};
    let t = chrono::Local.timestamp_millis_opt(ms as i64).unwrap();
    format!("{}-{:02}{:02}{:02}-{:03}", t.format("%Y%m%d"), t.hour(), t.minute(), t.second(), t.nanosecond() / 1_000_000)
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use smt_core::ProcessState;

    fn task(command: &str, auto_start: bool) -> TaskDef {
        TaskDef {
            id: "t1".to_string(),
            name: "probe".to_string(),
            folder_id: None,
            command: command.to_string(),
            workdir: None,
            env: Default::default(),
            auto_start,
            auto_attach: false,
            save_log: true,
        }
    }

    #[derive(Default)]
    struct TestSink {
        events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl EventSink for TestSink {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events.lock().unwrap().push((event.to_string(), payload));
        }
    }

    fn sink() -> Arc<dyn EventSink> {
        Arc::new(TestSink::default())
    }

    fn wait_until(ms: u64, mut f: impl FnMut() -> bool) -> bool {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(ms);
        while std::time::Instant::now() < deadline {
            if f() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        f()
    }

    #[test]
    fn start_captures_output_and_runs() {
        set_log_dir(std::env::temp_dir().join("smt-test-logs"));
        let pm = ProcessManager::default();
        let status = pm.start(sink(), task("echo smt-probe-123", false)).unwrap();
        assert!(status.pid.is_some());

        let got = wait_until(3000, || {
            pm.attach_console("t1")
                .map(|(_, text, _)| text.contains("smt-probe-123"))
                .unwrap_or(false)
        });
        assert!(got, "output line should reach the log file");

        let _ = pm.stop(sink(), "t1");
        let stopped = wait_until(5000, || {
            pm.statuses(&["t1".to_string()])["t1"].state == ProcessState::Stopped
        });
        assert!(stopped, "stop should end in Stopped state");
    }

    #[test]
    fn no_log_flag_means_no_file() {
        let pm = ProcessManager::default();
        let mut t = task("echo smt-nolog-456", false);
        t.save_log = false;
        pm.start(sink(), t).unwrap();
        let got = wait_until(3000, || {
            pm.attach_console("t1")
                .map(|(_, text, path)| text.is_empty() && path.is_none())
                .unwrap_or(false)
        });
        assert!(got, "save_log=false should produce no log file");
        let _ = pm.stop(sink(), "t1");
    }

    #[test]
    fn log_file_is_timestamped_and_per_run() {
        set_log_dir(std::env::temp_dir().join("smt-test-logs"));
        let pm = ProcessManager::default();
        pm.start(sink(), task("echo run-one", false)).unwrap();
        let got1 = wait_until(3000, || {
            pm.attach_console("t1")
                .and_then(|(_, _, path)| path)
                .is_some()
        });
        assert!(got1, "first run should create a log file");
        let path1 = pm.attach_console("t1").and_then(|(_, _, p)| p).unwrap();
        assert!(path1.contains(".log"), "log path: {path1}");
        let _ = pm.stop(sink(), "t1");
        let stopped = wait_until(5000, || {
            pm.statuses(&["t1".to_string()])["t1"].state == ProcessState::Stopped
        });
        assert!(stopped);

        pm.start(sink(), task("echo run-two", false)).unwrap();
        let got2 = wait_until(3000, || {
            pm.attach_console("t1")
                .and_then(|(_, _, path)| path)
                .is_some()
        });
        assert!(got2, "second run should create a new log file");
        let path2 = pm.attach_console("t1").and_then(|(_, _, p)| p).unwrap();
        assert_ne!(path1, path2, "each run gets its own file");
        let text2 = wait_until(3000, || {
            pm.attach_console("t1")
                .map(|(_, text, _)| text.contains("run-two"))
                .unwrap_or(false)
        });
        assert!(text2, "second run file should contain new output only");
        let _ = pm.stop(sink(), "t1");
    }

    #[test]
    fn start_twice_rejects() {
        let pm = ProcessManager::default();
        pm.start(sink(), task("ping -n 30 127.0.0.1", false)).unwrap();
        let err = pm.start(sink(), task("ping -n 30 127.0.0.1", false));
        assert!(err.is_err());
        let _ = pm.stop(sink(), "t1");
    }

    #[test]
    fn natural_exit_reports_exited() {
        let pm = ProcessManager::default();
        pm.start(sink(), task("exit 7", false)).unwrap();
        let exited = wait_until(5000, || {
            let s = &pm.statuses(&["t1".to_string()])["t1"];
            s.state == ProcessState::Exited && s.exit_code == Some(7)
        });
        assert!(exited, "natural exit should end in Exited(code)");
    }

    #[test]
    fn kill_all_clears_live_processes() {
        let pm = ProcessManager::default();
        pm.start(sink(), task("ping -n 30 127.0.0.1", false)).unwrap();
        pm.kill_all();
        let gone = wait_until(5000, || {
            pm.statuses(&["t1".to_string()])["t1"].state != ProcessState::Running
        });
        assert!(gone);
    }
}
