/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          950: "#0B0F17",
        },
      },
    },
  },
  plugins: [],
};
