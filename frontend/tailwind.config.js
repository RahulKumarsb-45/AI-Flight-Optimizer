/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0B1220',
          50: '#F4F5F7',
          100: '#E3E6EC',
          200: '#C3C9D6',
          300: '#98A2B8',
          // Darkened from #6B7691 to meet WCAG AA (4.5:1) for normal text on
          // both the white and paper backgrounds this token is used against
          // — the original measured 4.27:1 on paper. Same hue, minimal shift.
          400: '#67728C',
          500: '#4A5470',
          600: '#374057',
          700: '#262E42',
          800: '#161C2C',
          900: '#0B1220',
          950: '#060A12',
        },
        paper: {
          DEFAULT: '#F7F8FA',
          soft: '#FBFBFC',
          muted: '#EEF0F4',
        },
        horizon: {
          DEFAULT: '#1F2A52',
          50: '#EEF0F7',
          100: '#D6DBEA',
          200: '#AEB8D5',
          300: '#8593BE',
          400: '#5D6EA8',
          500: '#3C4B85',
          600: '#2A3768',
          700: '#1F2A52',
          800: '#161D3B',
          900: '#0E1226',
        },
        amber: {
          DEFAULT: '#F5A623',
          50: '#FFF7E8',
          100: '#FEE9C2',
          200: '#FDD68A',
          300: '#FAC158',
          400: '#F7B23D',
          500: '#F5A623',
          600: '#D68A0F',
          700: '#A9690B',
          800: '#7A4C08',
          900: '#4D3005',
        },
        route: {
          DEFAULT: '#2BB673',
          50: '#E8F8EF',
          100: '#C6EEDA',
          400: '#41C787',
          500: '#2BB673',
          600: '#1E9760',
          700: '#16794D',
        },
        danger: {
          DEFAULT: '#E5484D',
          50: '#FDECEC',
          500: '#E5484D',
          600: '#C53338',
        },
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
        'display-lg': ['3.5rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-md': ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        'display-sm': ['1.875rem', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '10px',
        lg: '16px',
        xl: '22px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(11,18,32,0.04), 0 8px 24px -8px rgba(11,18,32,0.10)',
        card: '0 1px 3px rgba(11,18,32,0.06), 0 12px 32px -12px rgba(11,18,32,0.14)',
        'glow-amber': '0 0 0 1px rgba(245,166,35,0.25), 0 8px 24px -8px rgba(245,166,35,0.35)',
      },
      spacing: {
        13: '3.25rem',
        18: '4.5rem',
        22: '5.5rem',
        30: '7.5rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'route-draw': {
          '0%': { strokeDashoffset: 1200 },
          '100%': { strokeDashoffset: 0 },
        },
        'plane-travel': {
          '0%': { offsetDistance: '0%', opacity: 0 },
          '10%': { opacity: 1 },
          '90%': { opacity: 1 },
          '100%': { offsetDistance: '100%', opacity: 0 },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s ease-out forwards',
        'route-draw': 'route-draw 1.4s ease-out forwards',
        'plane-travel': 'plane-travel 3s linear infinite',
      },
    },
  },
  plugins: [],
};
