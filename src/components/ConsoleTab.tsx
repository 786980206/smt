import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Play, Square, RotateCw, Trash2 } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AttachResult, OutputEvent } from '@/types';
import { useTaskStore, STATE_LABEL } from '@/stores/taskStore';
import { InteractiveButton } from '@/components/InteractiveButton';

interface Props {
  taskId: string;
}

/**
 * 附加的终端黑窗（xterm.js 渲染真实终端）。
 *
 * 数据流：
 * 1. invoke attach_console 读当前运行期的日志文件全文作为基线（未开日志则为空）
 * 2. 订阅 process-output 增量事件，按行喂给 xterm（行事件是行式协议，
 *    与 xterm 的字节流写不同：每行补 \n 还原）
 * 3. 进程（重新）启动时（pid 变化）重新读基线
 * 4. 输入：xterm onData → send_input 命令 → ConPTY
 */
export function ConsoleTab({ taskId }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
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
    fitRef.current = fit;
    term.focus();

    const unsubData = term.onData((data) => {
      void sendInput(taskId, data);
    });

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

    // 标签页切换到可见时 holder 才有真实尺寸，随时跟随
    const ro = new ResizeObserver(syncSize);
    ro.observe(holder);

    return () => {
      unsubData.dispose();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [taskId, sendInput]);

  // 基线 + 增量事件
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false; // 本 effect 实例自己的标志（StrictMode 双挂载时互不干扰）
    disposedRef.current = false;
    baselineReadyRef.current = false;

    (async () => {
      const un = await listen<OutputEvent>('process-output', (e) => {
        if (e.payload.taskId !== taskId) return;
        if (!baselineReadyRef.current) return; // 基线未就绪：丢弃，基线会覆盖
        const term = termRef.current;
        if (!term) return;
        for (const l of e.payload.lines) {
          // 完整行补回换行；部分行（提示符如 `>>> `）不补，否则光标被顶到行首
          term.write(l.text + (l.eol ? '\r\n' : ''));
        }
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
        // 基线的原始缓冲可能截断在任意字节处（环形缓冲被裁剪），
        // 截断处若落在多字节字符中间会出乱码 —— 容忍即可，增量会继续补
        term.write(snap.text);
      }
      setLogPath(snap.logPath);
      baselineReadyRef.current = true;
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [taskId]);

  // 进程（重新）启动 → 全新过程，重读基线（每次启动都是新日志文件）
  const prevPid = useRef(status?.pid);
  useEffect(() => {
    if (status?.pid && status.pid !== prevPid.current && status.state === 'starting') {
      baselineReadyRef.current = false;
      const term = termRef.current;
      if (term) term.clear();
      void invoke<AttachResult>('attach_console', { taskId }).then((snap) => {
        const t = termRef.current;
        if (t && snap.text) {
          t.write(snap.text);
        }
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
      <div ref={holderRef} className="flex-1 min-h-0 overflow-hidden bg-[#0c0c0c]" />
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
