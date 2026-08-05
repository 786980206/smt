import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Play, Square, RotateCw, Eraser } from 'lucide-react';
import type { AttachResult, ConsoleLine, OutputEvent } from '@/types';
import { useTaskStore, STATE_LABEL } from '@/stores/taskStore';
import { InteractiveButton } from '@/components/InteractiveButton';

interface Props {
  taskId: string;
}

/** `HH:MM:SS.mmm` —— 与日志文件行前缀一致 */
function fmtTime(at: number): string {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}]`;
}

function formatLine(l: ConsoleLine): string {
  const stream = l.stream === 'stderr' ? '[stderr] ' : '';
  return `${fmtTime(l.at)} ${stream}${l.text}\n`;
}

/**
 * 附加的 CMD 黑窗标签页。
 *
 * 简单协议：
 * 1. 订阅 process-output 增量事件
 * 2. invoke attach_console 读当前运行期的日志文件全文作为基线（未开日志则为空）
 * 3. 基线应用后，增量事件顺序追加
 * 4. 进程（重新）启动时（pid 变化）重新读基线 —— 每次启动都是全新过程
 */
export function ConsoleTab({ taskId }: Props) {
  const [text, setText] = useState('');
  const [logPath, setLogPath] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef('');
  const baselineReadyRef = useRef(false);
  const disposedRef = useRef(false);
  const status = useTaskStore((s) => s.statuses[taskId]);
  const ports = useTaskStore((s) => s.ports[taskId]);
  const openBrowser = useTaskStore((s) => s.openBrowser);
  const openLogFolder = useTaskStore((s) => s.openLogFolder);
  const start = useTaskStore((s) => s.start);
  const stop = useTaskStore((s) => s.stop);
  const restart = useTaskStore((s) => s.restart);

  const statusText = status
    ? `${STATE_LABEL[status.state]}${status.pid != null ? ` · PID ${status.pid}` : ''}${
        status.exitCode != null ? ` · 退出码 ${status.exitCode}` : ''
      }${status.error ? ` · ${status.error}` : ''}`
    : '未知状态';

  const append = useCallback((lines: ConsoleLine[]) => {
    let out = '';
    for (const l of lines) out += formatLine(l);
    if (!out) return;
    textRef.current += out;
    setText(textRef.current);
  }, []);

  const loadBaseline = useCallback(async () => {
    const snap = await invoke<AttachResult>('attach_console', { taskId });
    if (disposedRef.current) return;
    textRef.current = snap.text ?? '';
    setText(textRef.current);
    setLogPath(snap.logPath);
  }, [taskId]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false; // 本 effect 实例自己的标志（StrictMode 双挂载时互不干扰）
    disposedRef.current = false;
    baselineReadyRef.current = false;

    (async () => {
      const un = await listen<OutputEvent>('process-output', (e) => {
        if (e.payload.taskId !== taskId) return;
        if (!baselineReadyRef.current) return; // 基线未就绪：丢弃，基线会覆盖
        append(e.payload.lines);
      });
      if (disposed) {
        un();
        return;
      }
      unlisten = un;
      await loadBaseline();
      if (disposed) {
        un();
        return;
      }
      baselineReadyRef.current = true;
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [taskId, append, loadBaseline]);

  // 进程（重新）启动 → 全新过程，重读基线（每次启动都是新日志文件）
  const prevPid = useRef(status?.pid);
  useEffect(() => {
    if (status?.pid && status.pid !== prevPid.current && status.state === 'starting') {
      baselineReadyRef.current = false;
      textRef.current = '';
      setText('');
      void loadBaseline().then(() => {
        baselineReadyRef.current = true;
      });
    }
    prevPid.current = status?.pid;
  }, [status?.pid, status?.state, loadBaseline]);

  // 自动滚动到底（用户上滚查看历史时不打扰）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [text]);

  const clearScreen = useCallback(() => {
    textRef.current = '';
    setText('');
  }, []);

  const canStart = !status || ['stopped', 'exited', 'error'].includes(status.state);
  const canStop = !!status && ['running', 'starting'].includes(status.state);
  const canRestart = !!status && ['running', 'exited', 'error'].includes(status.state);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={scrollRef} className="console-scroll flex-1 min-h-0 overflow-y-auto">
        {text}
        <span className="inline-block w-2 h-4 bg-[#c8d6c8] align-middle animate-pulse" />
      </div>
      <div className="flex items-center gap-2 h-8 px-2 border-t border-border-default shrink-0 bg-nav">
        <InteractiveButton
          title="启动"
          onClick={() => void start(taskId)}
          disabled={!canStart}
        >
          <Play size={12} className="mr-1" />
          启动
        </InteractiveButton>
        <InteractiveButton
          title="停止"
          onClick={() => void stop(taskId)}
          disabled={!canStop}
        >
          <Square size={12} className="mr-1" />
          停止
        </InteractiveButton>
        <InteractiveButton
          title="重启"
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
        {logPath && (
          <button
            className="text-xs text-txt-subtle font-mono truncate max-w-60 hover:text-accent"
            title={`打开所在文件夹: ${logPath}`}
            onClick={() => void openLogFolder(logPath)}
          >
            日志: {logPath}
          </button>
        )}
        <InteractiveButton title="清屏（仅清显示）" onClick={() => clearScreen()}>
          <Eraser size={12} />
        </InteractiveButton>
      </div>
    </div>
  );
}
