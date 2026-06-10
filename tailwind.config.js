/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './admin/*.html',
    './fan-media/*.html',
    './functions/**/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans JP', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
