import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface UIState {
  theme: Theme;
  toggleTheme: () => void;
  /** 左侧任务树宽度（px） */
  treeWidth: number;
  setTreeWidth: (w: number) => void;
  /** 已折叠的文件夹 id 集合 */
  collapsed: Record<string, boolean>;
  toggleCollapsed: (id: string) => void;
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
    }),
    { name: 'smt-ui-v2' },
  ),
);
