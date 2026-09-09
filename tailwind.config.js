/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,css}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        sprygen: {
          black: "#000000",
          dark: "#080808",
          panel: "#0A0A0C",
          surface: "#111111",
          border: "rgba(255,255,255,0.12)",
          accent: "#E0002A",
          silver: "#E0E0E0",
          muted: "#666666",
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"Space Grotesk"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', "monospace"],
        display: ['"Syne"', '"Inter"', "sans-serif"],
      },
      animation: {
        "spin-slow": "spin 20s linear infinite",
        "spin-reverse-slow": "spin 12s linear infinite reverse",
        "spin-fast": "spin 1.5s linear infinite",
        "spin-medium": "spin 4s linear infinite",
        "spin-reverse": "spin 6s linear infinite reverse",
      },
      keyframes: {
        pulsecore: {
          "0%, 100%": { opacity: "0.9", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(1.15)" },
        },
      },
    },
  },
  plugins: [],
};
