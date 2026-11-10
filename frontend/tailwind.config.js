/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        f1red: "#E10600",
        f1dark: "#0B0D13",
        f1card: "#131722",
        f1border: "#222838",
      },
      fontFamily: {
        persian: ["Vazirmatn", "Tahoma", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Titillium Web", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};