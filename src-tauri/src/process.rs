//! Managed subprocess framework.
//!
//! Every task definition maps to at most one managed child process:
//!
//! - Windows 上经 `cmd.exe /C <command>` 启动（PATH 解析 + BAT 脚本支持；
//!   所有 stdio 重定向，无控制台闪烁）
//! - stdin 置空（黑窗是只读输出视图）
//! - stdout/stderr 由独立 reader 线程读入环形缓冲
//! - 行按 ~50ms 批量 flush 到前端（避免逐行 IPC）
//! - 停止用 `taskkill /PID <pid> /T /F` 杀整个进程树
//! - reaper 线程只负责等待退出并更新最终状态，绝不主动杀进程
//!   （长运行的后台服务不能被超时误杀）
//! - reader 线程比控制台窗口活得久：关标签页只是停止前端订阅，
//!   进程与缓冲继续

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use smt_core::{ConsoleLine, ConsoleStream, ProcessStatus, RingBuffer, TaskDef};
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

struct ManagedProc {
    child: Mutex<Option<Child>>,
    status: Mutex<ProcessStatus>,
    ring: Mutex<RingBuffer>,
    /// desired == Stopped means a user requested stop (→ Stopped status);
    /// otherwise a natural exit is reported as Exited(code).
    desired_stop: Mutex<bool>,
    /// fed by reader threads, drained by the flush thread
    tx: Mutex<Option<Sender<ConsoleLine>>>,
}

impl ManagedProc {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(ProcessStatus::default()),
            ring: Mutex::new(RingBuffer::default()),
            desired_stop: Mutex::new(false),
            tx: Mutex::new(None),
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

    /// Snapshot for console attach: status + full ring buffer replay.
    pub fn attach_console(
        &self,
        task_id: &str,
    ) -> Option<(ProcessStatus, Vec<ConsoleLine>, bool)> {
        let p = self.proc(task_id)?;
        let status = p.status.lock().unwrap().clone();
        let ring = p.ring.lock().unwrap();
        Some((status, ring.snapshot(), ring.truncated))
    }

    pub fn clear_console(&self, task_id: &str) -> bool {
        if let Some(p) = self.proc(task_id) {
            p.ring.lock().unwrap().clear();
            return true;
        }
        false
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
        p.ring.lock().unwrap().clear();
        emit_status(&sink, &task.id, &p.status.lock().unwrap());
        p.status.lock().unwrap().running();
        emit_status(&sink, &task.id, &p.status.lock().unwrap());

        let (tx, rx) = mpsc::channel::<ConsoleLine>();
        *p.tx.lock().unwrap() = Some(tx);
        let sink2 = sink.clone();
        let task_id2 = task.id.clone();
        std::thread::spawn(move || run_flush(sink2, task_id2, rx));

        if let Some(stream) = p.child.lock().unwrap().as_mut().unwrap().stdout.take() {
            spawn_reader(task.id.clone(), stream, ConsoleStream::Stdout, p.clone());
        }
        if let Some(stream) = p.child.lock().unwrap().as_mut().unwrap().stderr.take() {
            spawn_reader(task.id.clone(), stream, ConsoleStream::Stderr, p.clone());
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

/// Reader thread: drain a pipe into the ring buffer + IPC channel.
/// Bytes are split on `\n` and decoded with UTF-8 lossy fallback (GBK output
/// from user scripts degrades to replacement chars instead of crashing).
fn spawn_reader(
    task_id: String,
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
                push_line(&task_id, kind, &carry[start..start + rel], &proc);
                start += rel + 1;
            }
            carry.drain(..start);
            if carry.len() > READ_BUFFER_SIZE * 4 {
                // pathological single "line" (binary output): force flush
                push_line(&task_id, kind, &carry, &proc);
                carry.clear();
            }
        }
        if !carry.is_empty() {
            push_line(&task_id, kind, &carry, &proc);
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

fn push_line(_task_id: &str, kind: ConsoleStream, bytes: &[u8], proc: &ManagedProc) {
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
    proc.ring.lock().unwrap().push(line.clone());
    if let Some(tx) = proc.tx.lock().unwrap().as_ref() {
        let _ = tx.send(line);
    }
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
        let pm = ProcessManager::default();
        let status = pm.start(sink(), task("echo smt-probe-123", false)).unwrap();
        assert!(status.pid.is_some());

        let got = wait_until(3000, || {
            pm.attach_console("t1")
                .map(|(_, lines, _)| lines.iter().any(|l| l.text.contains("smt-probe-123")))
                .unwrap_or(false)
        });
        assert!(got, "output line should reach the ring buffer");

        let _ = pm.stop(sink(), "t1");
        let stopped = wait_until(5000, || {
            pm.statuses(&["t1".to_string()])["t1"].state == ProcessState::Stopped
        });
        assert!(stopped, "stop should end in Stopped state");
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
