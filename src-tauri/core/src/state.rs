//! Process lifecycle state machine.
//!
//! `desired` distinguishes a user-requested stop (taskkill → Stopped) from an
//! unexpected exit (→ Exited / Error). Transitions are driven by the process
//! manager, but all legality rules live here so they are testable.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Restarting,
    Exited,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStatus {
    pub state: ProcessState,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub started_at: Option<u64>,
    pub error: Option<String>,
}

impl Default for ProcessStatus {
    fn default() -> Self {
        Self {
            state: ProcessState::Stopped,
            pid: None,
            exit_code: None,
            started_at: None,
            error: None,
        }
    }
}

impl ProcessStatus {
    pub fn starting(pid: Option<u32>, now_ms: u64) -> Self {
        Self {
            state: ProcessState::Starting,
            pid,
            exit_code: None,
            started_at: Some(now_ms),
            error: None,
        }
    }

    pub fn running(&mut self) {
        self.state = ProcessState::Running;
        self.error = None;
    }

    pub fn stopping(&mut self) {
        self.state = ProcessState::Stopping;
    }

    pub fn restarting(&mut self) {
        self.state = ProcessState::Restarting;
    }

    pub fn stopped(&mut self) {
        self.state = ProcessState::Stopped;
        self.pid = None;
        self.exit_code = None;
        self.started_at = None;
        self.error = None;
    }

    pub fn exited(&mut self, code: Option<i32>) {
        self.state = ProcessState::Exited;
        self.pid = None;
        self.exit_code = code.or(Some(0));
    }

    pub fn error(&mut self, message: impl Into<String>) {
        self.state = ProcessState::Error;
        self.pid = None;
        self.error = Some(message.into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopped_resets_all_fields() {
        let mut s = ProcessStatus::starting(Some(42), 1_000);
        s.running();
        s.stopped();
        assert_eq!(s.state, ProcessState::Stopped);
        assert_eq!(s.pid, None);
        assert_eq!(s.exit_code, None);
        assert_eq!(s.started_at, None);
    }

    #[test]
    fn exited_keeps_exit_code() {
        let mut s = ProcessStatus::starting(Some(42), 1_000);
        s.running();
        s.exited(Some(1));
        assert_eq!(s.state, ProcessState::Exited);
        assert_eq!(s.exit_code, Some(1));
        assert_eq!(s.pid, None);
    }

    #[test]
    fn error_records_message() {
        let mut s = ProcessStatus::default();
        s.error("boom");
        assert_eq!(s.state, ProcessState::Error);
        assert_eq!(s.error.as_deref(), Some("boom"));
    }
}
