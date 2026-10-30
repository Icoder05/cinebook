/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // DEFAULT meets WCAG AA (≥ 4.5:1) under white text and as text on white or brand-light;
        // on-dark is the shade for text on the ink header.
        brand: { DEFAULT: '#D81E43', dark: '#B5173A', light: '#FEE5EA', 'on-dark': '#FF7A90' },
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
