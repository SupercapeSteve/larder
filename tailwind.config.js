/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  future: {
    // Wraps every `hover:` variant in `@media (hover: hover)`. Without it,
    // tapping a button on iOS leaves its hover style stuck until you tap
    // elsewhere, which reads as the UI being frozen mid-press.
    hoverOnlyWhenSupported: true,
  },
  // Class-based, not media: the user can override the OS from Settings, and
  // PreferencesProvider is what toggles `dark` on <html>.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Defined against CSS variables so the whole app can be re-themed by
        // reassigning eleven custom properties. `<alpha-value>` keeps opacity
        // modifiers (bg-larder-600/40) working. Defaults live in index.css and
        // the pre-paint script in index.html; src/lib/themes.ts owns the ramps.
        larder: {
          50: 'rgb(var(--c-50) / <alpha-value>)',
          100: 'rgb(var(--c-100) / <alpha-value>)',
          200: 'rgb(var(--c-200) / <alpha-value>)',
          300: 'rgb(var(--c-300) / <alpha-value>)',
          400: 'rgb(var(--c-400) / <alpha-value>)',
          500: 'rgb(var(--c-500) / <alpha-value>)',
          600: 'rgb(var(--c-600) / <alpha-value>)',
          700: 'rgb(var(--c-700) / <alpha-value>)',
          800: 'rgb(var(--c-800) / <alpha-value>)',
          900: 'rgb(var(--c-900) / <alpha-value>)',
          950: 'rgb(var(--c-950) / <alpha-value>)',
        },
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      minHeight: {
        tap: '44px',
      },
      minWidth: {
        tap: '44px',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'toast-in': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        'page-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'row-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
        'sheet-in': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'dialog-in': {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(8px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'backdrop-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 160ms ease-out',
        'fade-in': 'fade-in 140ms ease-out',
        'toast-in': 'toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.4s linear infinite',
        page: 'page-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'row-in': 'row-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        pop: 'pop 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        'sheet-in': 'sheet-in 300ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-in': 'dialog-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'backdrop-in': 'backdrop-in 200ms ease-out',
      },
    },
  },
  plugins: [],
}
