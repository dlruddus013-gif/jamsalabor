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
        // 잠사박물관 자연염 팔레트
        cream: "#FAF6EC",
        surface: "#F4ECD8",
        paper: "#FFFFFF",
        ink: {
          DEFAULT: "#1F1812",
          soft: "#5C4A3A",
          mute: "#8B7A66",
        },
        line: {
          DEFAULT: "#E6DBC2",
          soft: "#EFE7D2",
        },
        accent: {
          DEFAULT: "#B8442C",
          soft: "#E89578",
        },
        gold: "#C28C2C",
        olive: "#6B7A3B",
        sky: "#3F6E8A",
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', "Pretendard", "system-ui", "sans-serif"],
        display: ['"Gowun Batang"', '"Pretendard Variable"', "serif"],
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "rec-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.3)", opacity: "0.4" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "rec-pulse": "rec-pulse 1.5s ease-in-out infinite",
        "slide-up": "slide-up 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
