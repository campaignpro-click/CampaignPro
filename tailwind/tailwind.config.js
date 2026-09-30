/** Tailwind config for campaignpro.click
 *  Rebuild after changing classes in any .html file:
 *  npx tailwindcss@3 -c tailwind/tailwind.config.js -i tailwind/input.css -o assets/styles.css --minify
 */
module.exports = {
  content: ['./*.html', './assets/*.js'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#315CFF', light: '#8FA8FF', dark: '#2447D6' },
        ink: '#111111',
        page: '#F8F8F5',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        float: '0 20px 60px rgba(49,92,255,0.10)',
      },
    },
  },
  plugins: [],
};
