import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Play, Square, RotateCw, Trash2 } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AttachResult, RawOutputEvent } from '@/types';
import { useTaskStore, STATE_LABEL } from '@/stores/taskStore';
import { InteractiveButton } from '@/components/InteractiveButton';

interface Props {
  taskId: string;
}

/** base64 → Uint8Array（与 Rust base64_encode 一致的标准 base64） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 附加的终端黑窗（xterm.js 渲染真实终端）。
 *
 * 数据流（原始字节流协议）：
 * 1. invoke attach_console 读当前运行期的原始终端字节（base64，ANSI 保真）
 *    作为基线，xterm.write(Uint8Array) 一次性重建真实终端画面
 * 2. 订阅 process-output-raw 增量字节事件，直接 write —— 光标、颜色、
 *    进度条、清屏等 ANSI 转义序列全部保真，这就是真实终端
 * 3. 进程（重新）启动时（pid 变化）重新读基线
 * 4. 输入：xterm onData → send_input 命令 → ConPTY
 */
export function ConsoleTab({ taskId }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const disposedRef = useRef(false);
  const baselineReadyRef = useRef(false);
  const [logPath, setLogPath] = useState<string | null>(null);
  const status = useTaskStore((s) => s.statuses[taskId]);
  const ports = useTaskStore((s) => s.ports[taskId]);
  const openBrowser = useTaskStore((s) => s.openBrowser);
  const openLogFolder = useTaskStore((s) => s.openLogFolder);
  const start = useTaskStore((s) => s.start);
  const stop = useTaskStore((s) => s.stop);
  const restart = useTaskStore((s) => s.restart);
  const sendInput = useTaskStore((s) => s.sendInput);

  const statusText = status
    ? `${STATE_LABEL[status.state]}${status.pid != null ? ` · PID ${status.pid}` : ''}${
        status.exitCode != null ? ` · 退出码 ${status.exitCode}` : ''
      }${status.error ? ` · ${status.error}` : ''}`
    : '未知状态';

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', 'Consolas', 'Courier New', monospace",
      theme: {
        background: '#0c0c0c',
        foreground: '#c8d6c8',
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(holder);
    fit.fit();
    termRef.current = term;
    term.focus();

    const syncSize = () => {
      fit.fit();
      const term2 = termRef.current;
      if (term2) {
        void invoke('resize_pty', {
          taskId,
          rows: term2.rows,
          cols: term2.cols,
        }).catch(() => {});
      }
    };
    const onResize = syncSize;
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(syncSize);
    ro.observe(holder);

    const unsubData = term.onData((data) => {
      void sendInput(taskId, data);
    });

    return () => {
      unsubData.dispose();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [taskId, sendInput]);

  // 订阅原始字节事件 + 基线
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    disposedRef.current = false;
    baselineReadyRef.current = false;

    (async () => {
      const un = await listen<RawOutputEvent>('process-output-raw', (e) => {
        if (e.payload.taskId !== taskId) return;
        if (!baselineReadyRef.current) return; // 基线未就绪：丢弃，基线会覆盖
        const term = termRef.current;
        if (!term) return;
        term.write(b64ToBytes(e.payload.data));
      });
      if (disposed) {
        un();
        return;
      }
      unlisten = un;
      const snap = await invoke<AttachResult>('attach_console', { taskId });
      if (disposed) {
        un();
        return;
      }
      const term = termRef.current;
      if (term && snap.text) {
        // 普通任务：text 是原始终端字节（base64）→ 直接写字节重建终端；
        // 提权任务：text 是日志文本（raw=false），按 UTF-8 文本写。
        if (snap.raw) {
          term.write(b64ToBytes(snap.text));
        } else {
          term.write(snap.text);
        }
      }
      setLogPath(snap.logPath);
      baselineReadyRef.current = true;
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [taskId]);

  // 进程（重新）启动 → 全新过程，重读基线
  const prevPid = useRef(status?.pid);
  useEffect(() => {
    if (status?.pid && status.pid !== prevPid.current && status.state === 'starting') {
      baselineReadyRef.current = false;
      const term = termRef.current;
      if (term) term.clear();
      void invoke<AttachResult>('attach_console', { taskId }).then((snap) => {
        const t = termRef.current;
        if (t && snap.text) {
          if (snap.raw) t.write(b64ToBytes(snap.text));
          else t.write(snap.text);
        }
        setLogPath(snap.logPath);
        baselineReadyRef.current = true;
      });
    }
    prevPid.current = status?.pid;
  }, [status?.pid, status?.state, taskId]);

  const canStart = !status || ['stopped', 'exited', 'error'].includes(status.state);
  const canStop = !!status && ['running', 'starting'].includes(status.state);
  const canRestart = !!status && ['running', 'exited', 'error'].includes(status.state);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={holderRef} className="flex-1 min-h-0 overflow-hidden" />
      <div className="flex items-center gap-2 h-8 px-2 border-t border-border-default shrink-0 bg-nav">
        <InteractiveButton
          title="启动"
          variant="success"
          onClick={() => void start(taskId)}
          disabled={!canStart}
        >
          <Play size={12} className="mr-1" />
          启动
        </InteractiveButton>
        <InteractiveButton
          title="停止"
          variant="danger"
          onClick={() => void stop(taskId)}
          disabled={!canStop}
        >
          <Square size={12} className="mr-1" />
          停止
        </InteractiveButton>
        <InteractiveButton
          title="重启"
          variant="accent"
          onClick={() => void restart(taskId)}
          disabled={!canRestart}
        >
          <RotateCw size={12} className="mr-1" />
          重启
        </InteractiveButton>
        <div className="flex-1" />
        <span className="text-xs text-txt-muted font-mono">{statusText || '未知状态'}</span>
        {ports?.length ? (
          <span className="flex items-center gap-1 shrink-0">
            {ports.map((url) => (
              <button
                key={url}
                className="px-1.5 py-0.5 text-[11px] rounded-sm text-accent bg-accent/10 hover:bg-accent/20 font-mono"
                title={`用浏览器打开 ${url}`}
                onClick={() => void openBrowser(url)}
              >
                {url}
              </button>
            ))}
          </span>
        ) : null}
        <InteractiveButton
          title="清屏（仅清显示）"
          onClick={() => termRef.current?.clear()}
        >
          <Trash2 size={12} />
        </InteractiveButton>
        {logPath && (
          <button
            className="text-xs text-txt-subtle font-mono truncate max-w-60 hover:text-accent"
            title={`打开所在文件夹: ${logPath}`}
            onClick={() => void openLogFolder(logPath)}
          >
            日志: {logPath}
          </button>
        )}
      </div>
    </div>
  );
}