import { useState } from 'react';
import { TerminalSquare, Sun, Moon, Settings, FolderPlus, FilePlus } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { SettingsModal } from '@/components/SettingsModal';

interface Props {
  /** 新增任务（打开表单，根目录） */
  onNewTask?: () => void;
  /** 新增文件夹 */
  onNewFolder?: () => void;
}

export function TopNav({ onNewTask, onNewFolder }: Props) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex items-center h-7 px-2 bg-nav border-b border-border-default gap-0.5 select-none shrink-0">
      {/* 品牌 */}
      <div className="flex items-baseline gap-1.5 pr-3 mr-1 border-r border-border-default">
        <TerminalSquare size={14} className="text-accent self-center" />
        <span className="text-[13px] font-bold text-txt-primary tracking-wide">SMT</span>
        <span className="text-[10px] text-txt-subtle font-normal">Task Manager</span>
      </div>

      {/* 左侧：新增操作（task tree 面板标题栏也有，这里放全局快捷入口） */}
      <div className="flex items-center gap-0.5 flex-1">
        <button
          className="flex items-center h-6 px-2 py-1 text-xs text-txt-muted hover:text-txt-primary hover:bg-nav-hover rounded transition-colors"
          onClick={onNewFolder}
        >
          <FolderPlus size={12} className="mr-1" />
          文件夹
        </button>
        <button
          className="flex items-center h-6 px-2 py-1 text-xs text-txt-muted hover:text-txt-primary hover:bg-nav-hover rounded transition-colors"
          onClick={onNewTask}
        >
          <FilePlus size={12} className="mr-1" />
          任务
        </button>
      </div>

      {/* 右侧工具按钮 */}
      <div className="flex items-center gap-0.5">
        <button
          className="icon-btn w-7 h-7"
          title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          className="icon-btn w-7 h-7"
          title="设置（终端字体、字号、配色）"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={14} />
        </button>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}