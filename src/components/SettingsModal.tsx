import { Modal } from '@/components/Modal';
import { TERMINAL_FONTS, useUIStore } from '@/stores/uiStore';

/** 终端展示样式设置（右上角齿轮）。全部即时应用并持久化。 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const fontSize = useUIStore((s) => s.terminalFontSize);
  const fontFamily = useUIStore((s) => s.terminalFontFamily);
  const termTheme = useUIStore((s) => s.terminalTheme);
  const setFontSize = useUIStore((s) => s.setTerminalFontSize);
  const setFontFamily = useUIStore((s) => s.setTerminalFontFamily);
  const setTermTheme = useUIStore((s) => s.setTerminalTheme);

  return (
    <Modal title="设置" onClose={onClose} width={420}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-txt-secondary">终端字体</span>
          <select
            className="h-7 px-2 rounded-sm bg-input-bg text-txt-primary border border-transparent focus:border-accent"
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
              className="flex-1 accent-[rgb(var(--color-accent))]"
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
            <span className="w-7 text-right text-xs font-mono text-txt-primary">{fontSize}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-txt-secondary">终端配色</span>
          <div className="flex gap-2">
            <button
              className={`flex-1 h-7 rounded-sm text-xs border ${
                termTheme === 'dark'
                  ? 'border-accent text-txt-primary bg-accent/10'
                  : 'border-border-default text-txt-muted hover:bg-nav-hover'
              }`}
              onClick={() => setTermTheme('dark')}
            >
              深色（黑窗）
            </button>
            <button
              className={`flex-1 h-7 rounded-sm text-xs border ${
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

        <p className="text-[11px] text-txt-subtle leading-relaxed">
          设置全局保存到本地，仅影响新建/已打开终端标签的显示，不影响进程本身。
        </p>
      </div>
    </Modal>
  );
}