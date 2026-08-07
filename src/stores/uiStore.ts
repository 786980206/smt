import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';
/** 终端展示模式：深色/浅色 */
export type TerminalTheme = 'dark' | 'light';

export const TERMINAL_FONTS: { label: string; family: string }[] = [
  { label: 'JetBrains Mono', family: "'JetBrains Mono', 'Consolas', 'Courier New', monospace" },
  { label: 'Cascadia Mono', family: "'Cascadia Mono', 'Consolas', 'Courier New', monospace" },
  { label: 'Consolas', family: "'Consolas', 'Courier New', monospace" },
  { label: '中文字体 (等线/微软雅黑)', family: "'Segoe UI', 'Microsoft YaHei', 'Consolas', monospace" },
];

interface UIState {
  theme: Theme;
  toggleTheme: () => void;
  /** 左侧任务树宽度（px） */
  treeWidth: number;
  setTreeWidth: (w: number) => void;
  /** 已折叠的文件夹 id 集合 */
  collapsed: Record<string, boolean>;
  toggleCollapsed: (id: string) => void;
  /** 附加终端样式 */
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalTheme: TerminalTheme;
  setTerminalFontSize: (v: number) => void;
  setTerminalFontFamily: (v: string) => void;
  setTerminalTheme: (v: TerminalTheme) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'light',
      toggleTheme: () =>
        set((s) => {
          const theme = s.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.classList.toggle('dark', theme === 'dark');
          return { theme };
        }),
      treeWidth: 240,
      setTreeWidth: (w) => set({ treeWidth: Math.min(500, Math.max(160, w)) }),
      collapsed: {},
      toggleCollapsed: (id) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      terminalFontSize: 12,
      terminalFontFamily: TERMINAL_FONTS[0].family,
      terminalTheme: 'dark',
      setTerminalFontSize: (v) => set({ terminalFontSize: Math.min(20, Math.max(10, v)) }),
      setTerminalFontFamily: (v) => set({ terminalFontFamily: v }),
      setTerminalTheme: (v) => set({ terminalTheme: v }),
    }),
    { name: 'smt-ui-v2' },
  ),
);