/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // ── Brand palette (Flutter app uyğunluğu) ────────────────────
      colors: {
        // Brand
        brand: {
          50:  '#EFF4FF',
          100: '#E0EAFF',
          200: '#BAD2FF',
          300: '#90B5FF',
          400: '#5C8FFF',
          500: '#3B82F6',
          600: '#2563EB', // primary
          700: '#1D4ED8', // primary-dark
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // Accent (cyan)
        accent: {
          50:  '#ECFEFF',
          100: '#CFFAFE',
          200: '#A5F3FC',
          300: '#67E8F9',
          400: '#22D3EE',
          500: '#06B6D4', // primary accent
          600: '#0891B2',
          700: '#0E7490',
        },
        // Surface
        ink: '#0A0F1E',
        'ink-soft': '#374151',
        muted: '#9CA3AF',
        surface: '#FFFFFF',
        'surface-alt': '#F8FAFF',
        'surface-bg': '#F0F5FF',
        border: '#E5E9F2',

        // Status
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#DC2626',
        info: '#0EA5E9',
      },

      // ── Typography ────────────────────────────────────────────────
      fontFamily: {
        sans: [
          'Inter',
          'Nunito',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        display: ['Nunito', 'Inter', 'system-ui', 'sans-serif'],
      },

      // ── Border radius (Flutter-style soft corners) ────────────────
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },

      // ── Box shadows (matching Flutter shadow stack) ──────────────
      boxShadow: {
        card: '0 4px 14px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
        'card-lg':
          '0 16px 40px rgba(37,99,235,0.06), 0 4px 10px rgba(0,0,0,0.04)',
        brand: '0 6px 16px rgba(37,99,235,0.38)',
        'brand-soft': '0 8px 24px rgba(37,99,235,0.18)',
      },

      // ── Custom gradients ─────────────────────────────────────────
      backgroundImage: {
        'brand-gradient':
          'linear-gradient(90deg, #2563EB 0%, #3B82F6 50%, #06B6D4 100%)',
        'brand-radial':
          'radial-gradient(circle at top right, rgba(37,99,235,0.07), transparent 50%)',
        'auth-bg':
          'linear-gradient(135deg, #F0F5FF 0%, #FAFCFF 50%, #F7F9FF 100%)',
      },

      // ── Animations ────────────────────────────────────────────────
      animation: {
        'fade-in': 'fadeIn 300ms ease-out',
        'slide-up': 'slideUp 350ms cubic-bezier(0.4, 0, 0.2, 1)',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        slideUp: {
          from: { opacity: 0, transform: 'translateY(12px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: 0.6 },
          '50%': { opacity: 1 },
        },
      },

      // ── Spacing helpers ──────────────────────────────────────────
      spacing: {
        13: '3.25rem', // 52px — button height
        15: '3.75rem',
      },
    },
  },
  plugins: [],
};
