import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  language: string;
  onChange: (value: string) => void;
  height?: number;
}

/**
 * 多行脚本编辑器（命令区）。纯 textarea 实现 ——
 * 体积仅为 Monaco 的零头，保证打包体积最小（dist 15MB → <1MB）。
 */
export function ScriptEditor({ value, language, onChange, height = 240 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    textareaRef.current?.focus();
    // WebView2 新弹出模态的首次点击经常被合成器吞掉（首击无效、二击才生效），
    // 打开即聚焦 + 捕获阶段兜底，保证开箱即可输入。
    const ta = textareaRef.current;
    if (!ta) return;
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  // 外部语言切换不改变内容，仅用于无障碍标注
  return (
    <div
      className="rounded border border-border-default overflow-hidden focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/60 transition-colors"
      style={{ height }}
      onMouseDownCapture={() => textareaRef.current?.focus()}
      onPointerDownCapture={() => textareaRef.current?.focus()}
    >
      <textarea
        ref={textareaRef}
        value={value}
        aria-label={`启动脚本（${language}）`}
        spellCheck={false}
        onChange={(e) => onChangeRef.current(e.target.value)}
        className="w-full h-full p-2.5 bg-input-bg text-txt-primary font-mono text-xs leading-5 resize-none outline-none placeholder:text-txt-subtle"
        placeholder="# 在此输入启动命令 / 多行脚本&#10;示例：python -m http.server 8000"
      />
    </div>
  );
}