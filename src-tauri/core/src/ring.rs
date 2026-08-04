//! Ring buffer for console output lines.
//!
//! Bounded by both line count and total bytes so a chatty process cannot
//! blow up memory (5000 lines cap / 10MB cap by default).

use std::collections::VecDeque;

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

#[derive(Debug)]
pub struct RingBuffer {
    buf: VecDeque<ConsoleLine>,
    cap_lines: usize,
    cap_bytes: usize,
    bytes: usize,
    /// true when entries were dropped (frontend shows a truncation marker)
    pub truncated: bool,
}

impl Default for RingBuffer {
    fn default() -> Self {
        Self::new(5000, 10 * 1024 * 1024)
    }
}

impl RingBuffer {
    pub fn new(cap_lines: usize, cap_bytes: usize) -> Self {
        Self {
            buf: VecDeque::new(),
            cap_lines,
            cap_bytes,
            bytes: 0,
            truncated: false,
        }
    }

    pub fn push(&mut self, line: ConsoleLine) {
        self.bytes += line.text.len();
        self.buf.push_back(line);
        while self.buf.len() > self.cap_lines || self.bytes > self.cap_bytes {
            if let Some(front) = self.buf.pop_front() {
                self.bytes = self.bytes.saturating_sub(front.text.len());
                self.truncated = true;
            } else {
                break;
            }
        }
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// Snapshot copy for console attach replay.
    pub fn snapshot(&self) -> Vec<ConsoleLine> {
        self.buf.iter().cloned().collect()
    }

    pub fn clear(&mut self) {
        self.buf.clear();
        self.bytes = 0;
        self.truncated = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: usize, text: &str) -> ConsoleLine {
        ConsoleLine {
            at: n as u64,
            stream: ConsoleStream::Stdout,
            text: text.to_string(),
        }
    }

    #[test]
    fn caps_by_line_count() {
        let mut rb = RingBuffer::new(3, 1024);
        for i in 0..10 {
            rb.push(line(i, "x"));
        }
        assert_eq!(rb.len(), 3);
        assert!(rb.truncated);
        let snap = rb.snapshot();
        assert_eq!(snap[0].at, 7);
    }

    #[test]
    fn caps_by_total_bytes() {
        let mut rb = RingBuffer::new(100, 6);
        rb.push(line(1, "aaaa"));
        rb.push(line(2, "bbbb"));
        assert_eq!(rb.len(), 1);
        assert_eq!(rb.snapshot()[0].text, "bbbb");
        assert!(rb.truncated);
    }

    #[test]
    fn clear_resets() {
        let mut rb = RingBuffer::new(3, 1024);
        rb.push(line(1, "a"));
        rb.clear();
        assert!(rb.is_empty());
        assert!(!rb.truncated);
    }
}
