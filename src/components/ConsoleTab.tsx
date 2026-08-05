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

/**
 * 附加的 CMD 黑窗标签页。
 *
 * 协议（不丢行、不重复）：
 * 1. 先订阅 process-output 增量事件（快照应用前到达的事件直接丢弃，
 *    它们已被快照覆盖）
 * 2. 再 invoke attach_console 取环形缓存快照 —— 快照为权威基线
 * 3. 快照应用后，增量事件顺序追加
 *
 * 关闭标签（卸载）仅 unlisten，后台进程与 Rust 侧缓存不受影响。
 */
export function ConsoleTab({ taskId }: Props) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef('');
  const appliedRef = useRef(false);
  const status = useTaskStore((s) => s.statuses[taskId]);
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
    for (const l of lines) {
      out += (l.stream === 'stderr' ? '[stderr] ' : '') + l.text + '\n';
    }
    textRef.current += out;
    setText(textRef.current);
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    (async () => {
      const un = await listen<OutputEvent>('process-output', (e) => {
        if (e.payload.taskId !== taskId) return;
        if (!appliedRef.current) return; // 快照前的增量丢弃，快照覆盖
        append(e.payload.lines);
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
      appliedRef.current = true;
      textRef.current = '';
      let out = '';
      if (snap.truncated) out += '[输出缓存已达上限，最早的部分已被丢弃]\n';
      for (const l of snap.lines) {
        out += (l.stream === 'stderr' ? '[stderr] ' : '') + l.text + '\n';
      }
      textRef.current = out;
      setText(out);
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [taskId, append]);

  // 进程重启时清空旧文本（通过 pid 变化检测新进程）
  const prevPid = useRef(status?.pid);
  useEffect(() => {
    if (status?.pid !== prevPid.current && status?.state === 'starting') {
      appliedRef.current = false;
      textRef.current = '';
      setText('');
    }
    prevPid.current = status?.pid;
  }, [status?.pid, status?.state]);

  // 自动滚动到底（用户上滚查看历史时不打扰）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [text]);

  const clearScreen = useCallback(async () => {
    textRef.current = '';
    setText('');
    try {
      await invoke('clear_console', { taskId });
    } catch {
      /* ignore */
    }
  }, [taskId]);

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
        <InteractiveButton title="清屏（仅清显示，缓存保留）" onClick={() => void clearScreen()}>
          <Eraser size={12} />
        </InteractiveButton>
      </div>
    </div>
  );
}
