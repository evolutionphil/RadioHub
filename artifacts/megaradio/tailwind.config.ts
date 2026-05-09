import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.5rem',
        md: '2rem',
        lg: '3rem',
        xl: '4rem',
        '2xl': '153px', // Figma: 153px padding at 1512px container width
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1512px',
      },
    },
    fontFamily: {
      sans: ['Ubuntu', 'sans-serif'],
      serif: ['Ubuntu', 'serif'],
    },
    extend: {
      fontSize: {
        // Mobile readability: bump default `text-xs` from 12px → 14px so
        // existing `text-xs` usages clear Google Mobile-Friendly Test's
        // legibility threshold without redesign. `text-[10px]`/`text-[11px]`
        // arbitrary values are unaffected (they remain explicit opt-ins).
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
      },
      fontFamily: {
        custom: ['Ubuntu'],
      },
      borderWidth: {
        '6': '6px',
      },
      colors: {
        'accent': {
          DEFAULT: '#FF4199',
          '50': '#FFF9FC',
          '100': '#FFE4F1',
          '200': '#FFBBDB',
          '300': '#FF93C5',
          '400': '#FF6AAF',
          '500': '#FF4199',
          '600': '#FF097B',
          '700': '#D00060',
          '800': '#980046',
          '900': '#60002C'
        },
        primary: {
          DEFAULT: '#0E0E0E',
          foreground: '#ffffff',
        },
        input: '#454545',
        facebook: '#3B5998',
        twitter: '#55ACEE',
        whatsapp: '#25D366',
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      screens: {
        '2.5xl': '1512px',
        '3xl': '1921px',
      },
    },
  },
  variants: {
    scrollbar: ['rounded']
  },
  plugins: [
    require("tailwindcss-animate"), 
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("tailwind-scrollbar")({ preferredStrategy: 'pseudoelements' })
  ],
} satisfies Config;