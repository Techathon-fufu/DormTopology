/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FAF8F5',
        surface: '#FFFFFF',
        muted: '#F1EFEA',
        border: '#E5E1D8',
        foreground: '#26292C',
        'muted-foreground': '#5A5F66',
        faint: '#8A8F96',
        primary: {
          DEFAULT: '#0F9D8A',
          hover: '#0C8776',
          soft: '#E6F4F1',
        },
        success: '#2F9E63',
        warning: '#D97706',
        danger: '#D64545',
        info: '#2F6FED',
        cable: {
          power: '#E5484D',
          network: '#3B82F6',
          data: '#8B5CF6',
          charging: '#F59E0B',
        },
        scene: {
          wood: '#D6B98C',
          'wood-dark': '#C9A06A',
          metal: '#3A3F45',
          wall: '#EFECE6',
          floor: '#E9E4DB',
        },
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(20,22,26,.06)',
        sm: '0 1px 3px rgba(20,22,26,.08), 0 1px 2px rgba(20,22,26,.04)',
        md: '0 4px 12px rgba(20,22,26,.10)',
        overlay: '0 12px 32px rgba(20,22,26,.16)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'HarmonyOS Sans SC',
          'PingFang SC',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
