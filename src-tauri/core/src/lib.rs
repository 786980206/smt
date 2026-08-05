//! Pure-logic core for SMT Task Manager.
//!
//! No tauri dependency — everything here is unit-testable with `cargo test`.

pub mod ring;
pub mod state;
pub mod tree;

pub use ring::{ConsoleLine, ConsoleStream};
pub use state::{ProcessState, ProcessStatus};
pub use tree::{FolderDef, TaskDef, TaskInput, TaskTree, TreeError};
