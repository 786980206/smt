import type { ReactNode } from 'react';

interface Props {
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** 高密度工具按钮（参考项目 InteractiveButton 风格） */
export function InteractiveButton({ title, onClick, disabled, className = '', children }: Props) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center h-6 px-2 text-xs rounded-sm border border-transparent
        hover:bg-nav-hover active:bg-nav-active disabled:opacity-40 disabled:cursor-default
        disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}
