//! Console output line types (shared between process manager and frontend).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsoleStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsoleLine {
    /// epoch milliseconds
    pub at: u64,
    pub stream: ConsoleStream,
    pub text: String,
}
