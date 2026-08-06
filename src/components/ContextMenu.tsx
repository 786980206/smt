import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** 文字颜色（如 rgb(var(--color-up))） */
  color?: string;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** 通用右键菜单（点击外部 / Esc 关闭） */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const menuW = 150;
  const menuH = Math.min(320, items.length * 26 + 8);
  const left = Math.min(x, viewport.w - menuW - 4);
  const top = Math.min(y, viewport.h - menuH - 4);

  return (
    <div ref={ref} className="ctx-menu" style={{ left: Math.max(4, left), top: Math.max(4, top) }}>
      {items.map((item, i) =>
        item.label === '' ? (
          <div key={i} className="ctx-menu-separator" />
        ) : (
          <button
            key={i}
            className="ctx-menu-item"
            disabled={item.disabled}
            style={item.danger ? { color: 'rgb(var(--color-down))' } : item.color ? { color: item.color } : undefined}
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
