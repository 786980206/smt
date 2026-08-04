import { useEffect, useState } from 'react';
import { useTaskStore } from '@/stores/taskStore';

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toTimeString().slice(0, 8);
}

export function StatusBar() {
  const statuses = useTaskStore((s) => s.statuses);
  const clock = useClock();

  let running = 0;
  let stopped = 0;
  let exited = 0;
  let error = 0;
  let transitional = 0;
  for (const st of Object.values(statuses)) {
    if (st.state === 'running') running++;
    else if (st.state === 'stopped') stopped++;
    else if (st.state === 'exited') exited++;
    else if (st.state === 'error') error++;
    else transitional++;
  }
  const total = Object.keys(statuses).length;

  return (
    <div className="flex items-center h-6 px-2 gap-3 bg-nav border-t border-border-default shrink-0 text-xs text-txt-muted">
      <span className="flex items-center gap-1">
        <span className={`status-dot ${running > 0 ? 'status-dot-running' : 'status-dot-stopped'}`} />
        {running} 运行中
      </span>
      {transitional > 0 && <span>{transitional} 转换中</span>}
      <span>{stopped} 已停止</span>
      {(exited > 0 || error > 0) && (
        <span className="text-financial-down">
          {error > 0 ? `${error} 异常` : ''}
          {error > 0 && exited > 0 ? ' · ' : ''}
          {exited > 0 ? `${exited} 已退出` : ''}
        </span>
      )}
      <span>共 {total} 个任务</span>
      <div className="flex-1" />
      <span className="font-mono">{clock}</span>
    </div>
  );
}
