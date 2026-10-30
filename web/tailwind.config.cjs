/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@langchain/macaw-components/tailwind-preset")],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
};
