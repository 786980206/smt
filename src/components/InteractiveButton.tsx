import type { ReactNode } from 'react';

interface Props {
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'success' | 'danger' | 'accent';
  children: ReactNode;
}

const VARIANT_CLS: Record<NonNullable<Props['variant']>, string> = {
  default: '',
  success: 'text-financial-up hover:bg-financial-up/10',
  danger: 'text-financial-down hover:bg-financial-down/10',
  accent: 'text-accent hover:bg-accent/10',
};

/** 高密度工具按钮（参考项目 InteractiveButton 风格） */
export function InteractiveButton({ title, onClick, disabled, className = '', variant = 'default', children }: Props) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center h-6 px-2 text-xs rounded-sm border border-transparent
        hover:bg-nav-hover active:bg-nav-active disabled:opacity-40 disabled:cursor-default
        disabled:hover:bg-transparent ${VARIANT_CLS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
