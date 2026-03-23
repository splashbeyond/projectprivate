/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        anchor: {
          canvas:    '#FFFFFF',   // main background
          sidebar:   '#F2F2F2',   // sidebar + panels
          brand:     '#4DA6FF',   // primary CTA
          highlight: '#A8D8FF',   // note highlights
          aibg:      '#D6EEFF',   // AI response background
          heading:   '#1A1A2E',   // headings
          body:      '#5A5A72',   // body text / secondary
          border:    '#E0E0E0',   // dividers
          danger:    '#FF4444',   // destructive actions
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
      }
    }
  },
  plugins: []
}
