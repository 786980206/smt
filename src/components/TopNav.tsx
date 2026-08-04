import { TerminalSquare, Sun, Moon, Settings } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

export function TopNav() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <div className="flex items-center h-7 px-3 bg-nav border-b border-border-default shrink-0">
      <div className="flex items-center gap-2">
        <TerminalSquare size={14} className="text-accent" />
        <span className="text-xs font-semibold tracking-wide">SMT Task Manager</span>
      </div>
      <div className="flex-1" />
      <button
        className="flex items-center justify-center w-6 h-6 rounded-sm text-txt-muted hover:bg-nav-hover hover:text-txt-primary"
        title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
      </button>
      <button
        className="flex items-center justify-center w-6 h-6 rounded-sm text-txt-muted hover:bg-nav-hover hover:text-txt-primary"
        title="设置"
      >
        <Settings size={13} />
      </button>
    </div>
  );
}
