const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        ink: token('ink'),
        muted: token('muted'),
        line: token('line'),
        brand: token('brand'),
        onbrand: token('onbrand'),
        inc: token('inc'),
        exp: token('exp'),
        trf: token('trf'),
      },
      fontFamily: {
        sans: ['ui-rounded', 'SF Pro Rounded', 'Nunito', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        float1: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(30px,40px) scale(1.15)' } },
        float2: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(-40px,30px) scale(1.1)' } },
        float3: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(20px,-40px) scale(1.2)' } },
      },
      animation: {
        float1: 'float1 18s ease-in-out infinite',
        float2: 'float2 22s ease-in-out infinite',
        float3: 'float3 26s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
