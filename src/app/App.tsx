import { useEffect, useCallback } from 'react';
import { TopNav } from '@/components/TopNav';
import { StatusBar } from '@/components/StatusBar';
import { TaskTreePanel } from '@/components/TaskTreePanel';
import { Workspace } from '@/components/Workspace';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';

export default function App() {
  const load = useTaskStore((s) => s.load);
  const setTreeWidth = useUIStore((s) => s.setTreeWidth);

  useEffect(() => {
    void load();
  }, [load]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const onMove = (ev: MouseEvent) => setTreeWidth(ev.clientX);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      void startX;
    },
    [setTreeWidth],
  );

  return (
    <div className="flex flex-col h-full bg-page text-txt-primary">
      <TopNav />
      <div className="flex flex-1 min-h-0">
        <TaskTreePanel />
        <div
          className="w-1 hover:w-1 cursor-col-resize shrink-0 bg-border-default hover:bg-accent transition-colors"
          onMouseDown={onResizeStart}
        />
        <div className="relative flex-1 min-w-0">
          <Workspace />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
