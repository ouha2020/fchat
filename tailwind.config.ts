import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f8f7f3",
        ink: "#293029",
        brand: {
          50: "#f2f8e8",
          100: "#eaf5d5",
          200: "#d8edb3",
          300: "#c4e697",
          400: "#acd568",
          500: "#b5de75",
          600: "#52752d",
          700: "#3f5d24",
          800: "#354d22",
          900: "#2e431d",
          950: "#293d1d",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
