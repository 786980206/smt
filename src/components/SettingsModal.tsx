import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Modal } from '@/components/Modal';
import { TERMINAL_FONTS, useUIStore } from '@/stores/uiStore';

const selectCls =
  'w-full h-7 px-2 rounded bg-input-bg border border-border-default text-txt-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-colors';

/** 终端展示样式设置（右上角齿轮）。全部即时应用，持久化到 smt.yaml。 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const fontSize = useUIStore((s) => s.terminalFontSize);
  const fontFamily = useUIStore((s) => s.terminalFontFamily);
  const termTheme = useUIStore((s) => s.terminalTheme);
  const setFontSize = useUIStore((s) => s.setTerminalFontSize);
  const setFontFamily = useUIStore((s) => s.setTerminalFontFamily);
  const setTermTheme = useUIStore((s) => s.setTerminalTheme);
  const closeToTray = useUIStore((s) => s.closeToTray);
  const setCloseToTray = useUIStore((s) => s.setCloseToTray);
  const [configPath, setConfigPath] = useState('');

  useEffect(() => {
    invoke<string>('config_path')
      .then(setConfigPath)
      .catch(() => setConfigPath(''));
  }, []);

  return (
    <Modal title="设置" onClose={onClose} width={420}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-txt-secondary">终端字体</span>
          <select
            className={selectCls}
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
          >
            {TERMINAL_FONTS.map((f) => (
              <option key={f.family} value={f.family}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-txt-secondary">字体大小（10–20px，当前 {fontSize}px）</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={20}
              step={1}
              value={fontSize}
              className="flex-1"
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
            <span className="w-7 text-right text-xs font-mono text-txt-primary">{fontSize}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-txt-secondary">终端配色</span>
          <div className="flex gap-2">
            <button
              className={`flex-1 h-7 rounded text-xs border transition-colors ${
                termTheme === 'dark'
                  ? 'border-accent text-txt-primary bg-accent/10'
                  : 'border-border-default text-txt-muted hover:bg-nav-hover'
              }`}
              onClick={() => setTermTheme('dark')}
            >
              深色（黑窗）
            </button>
            <button
              className={`flex-1 h-7 rounded text-xs border transition-colors ${
                termTheme === 'light'
                  ? 'border-accent text-txt-primary bg-accent/10'
                  : 'border-border-default text-txt-muted hover:bg-nav-hover'
              }`}
              onClick={() => setTermTheme('light')}
            >
              浅色（白底）
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-txt-secondary">窗口行为</span>
          <label className="flex items-start gap-2 px-2 py-1.5 rounded bg-input-bg border border-border-default cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={closeToTray}
              onChange={(e) => setCloseToTray(e.target.checked)}
            />
            <span className="text-xs text-txt-secondary leading-5">
              关闭窗口时最小化到托盘
              <span className="block text-[11px] text-txt-subtle">
                勾选后点击右上角 × 只隐藏到系统托盘，后台任务继续运行；取消勾选则直接退出
              </span>
            </span>
          </label>
        </div>

        {configPath && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-txt-secondary">配置文件</span>
            <div className="px-2 py-1.5 rounded bg-input-bg border border-border-default">
              <span className="font-mono text-[10px] text-txt-muted break-all" title={configPath}>
                {configPath}
              </span>
            </div>
          </div>
        )}

        <p className="text-[11px] text-txt-subtle leading-relaxed">
          设置写入 smt.yaml（与可执行文件同目录，便携模式），仅影响新建/已打开终端标签的显示，不影响进程本身。
        </p>
      </div>
    </Modal>
  );
}