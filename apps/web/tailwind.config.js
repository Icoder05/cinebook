/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#F84464', dark: '#DC3558', light: '#FEE5EA' },
        ink: { DEFAULT: '#333545', 2: '#1F2533', muted: '#666666' },
        surface: '#F5F5F5',
      },
      fontFamily: {
        sans: ['Roboto', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: { card: '0 1px 4px rgba(0,0,0,0.08)' },
    },
  },
  plugins: [],
};
