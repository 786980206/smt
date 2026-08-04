/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        ui: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        xs: ['var(--font-xs)', { lineHeight: 'var(--lh-tight)' }],
        sm: ['var(--font-sm)', { lineHeight: 'var(--lh-tight)' }],
        base: ['var(--font-base)', { lineHeight: 'var(--lh-normal)' }],
      },
      height: {
        'row-sm': 'var(--size-row-sm)',
        'row-md': 'var(--size-row-md)',
        'row-lg': 'var(--size-row-lg)',
        'panel-header': 'var(--size-panel-header)',
      },
      colors: {
        page: 'var(--bg-page)',
        nav: 'var(--bg-nav)',
        surface: 'var(--bg-surface)',
        'nav-hover': 'var(--bg-hover)',
        'nav-active': 'var(--bg-active)',
        'input-bg': 'var(--bg-input)',
        'txt-primary': 'var(--text-primary)',
        'txt-secondary': 'var(--text-secondary)',
        'txt-muted': 'var(--text-muted)',
        'txt-subtle': 'var(--text-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        financial: {
          up: 'rgb(var(--color-up) / <alpha-value>)',
          down: 'rgb(var(--color-down) / <alpha-value>)',
          unchanged: 'rgb(var(--color-unchanged) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
