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
      fontSize: {
        '2xs': '0.625rem',   /* 10px — for tiny badges */
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans JP', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
