/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './fan-media/*.html',
    './guides/*.html',
    './news/*.html',
    './events/*.html',
    './js/**/*.js',
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
