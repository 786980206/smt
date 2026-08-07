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
    /// 是否以换行收尾的完整行。false 表示「部分行」（交互提示符等未换行输出），
    /// 前端不应在其后补换行，否则光标会被顶到下一行行首。
    pub eol: bool,
}
