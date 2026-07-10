# Arcline UX Design System

A comprehensive design system for building modern, professional React applications with consistent Arcline branding. This guide ensures all applications have a sleek, crisp, and modern appearance.

---

## Quick Start for Claude

When a user asks you to implement this design system:

1. Install the required dependencies (see [Dependencies](#dependencies))
2. Set up Tailwind CSS v4 with the Vite plugin
3. Copy the color palette into `src/index.css`
4. Install shadcn/ui components as needed
5. Follow the component patterns below

---

## Table of Contents

- [Branding Assets](#branding-assets)
- [Color Palette](#color-palette)
- [Typography](#typography)
- [Dependencies](#dependencies)
- [Tailwind CSS v4 Setup](#tailwind-css-v4-setup)
- [Dark Mode](#dark-mode)
- [Core Components](#core-components)
- [Layout Patterns](#layout-patterns)
- [Interactive Elements](#interactive-elements)
- [Loading & Feedback States](#loading--feedback-states)
- [Accessibility](#accessibility)

---

## Branding Assets

### Logo Placement

The Arcline logo should be placed in the application:

```
frontend/
├── public/
│   ├── Arcline-Logo-Black.svg    # Logo for light mode
│   ├── Arcline-Logo-White.svg    # Logo for dark mode
│   └── favicon.svg               # SVG favicon
```

### Logo Usage in Header

```jsx
import { useTheme } from 'next-themes';

function Header() {
  const { theme } = useTheme();

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={theme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
            alt="Arcline"
            className="h-8 w-auto"
          />
          <span className="text-lg font-semibold text-foreground">
            App Name
          </span>
        </div>
        {/* Navigation items */}
      </div>
    </header>
  );
}
```

### Favicon

Set the favicon in `index.html`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

---

## Color Palette

### Arcline Brand Colors

| Name | Light Mode | Dark Mode | Usage |
|------|------------|-----------|-------|
| **Primary** | `#234948` | `#3d7c79` | Main actions, links, focus states |
| **Secondary** | `#C9E5E4` | `#2d4d4c` | Backgrounds, secondary buttons |
| **Accent** | `#8CB4AB` | `#3d7c79` | Highlights, hover states |
| **Muted** | `#f0f7f7` | `#1a2928` | Disabled states, backgrounds |
| **Destructive** | `#dc2626` | `#ef4444` | Errors, delete actions |
| **Success** | `#10b981` | `#10b981` | Success states, confirmations |
| **Warning** | `#f59e0b` | `#f59e0b` | Warnings, cautions |

### CSS Variables (index.css)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

@import "tailwindcss";

@theme {
  /* Arcline Brand Colors */
  --color-background: #ffffff;
  --color-foreground: #0a0f0e;
  --color-primary: #234948;
  --color-primary-foreground: #ffffff;
  --color-secondary: #C9E5E4;
  --color-secondary-foreground: #234948;
  --color-muted: #f0f7f7;
  --color-muted-foreground: #5a6c6b;
  --color-accent: #8CB4AB;
  --color-accent-foreground: #234948;
  --color-destructive: #dc2626;
  --color-destructive-foreground: #ffffff;
  --color-success: #10b981;
  --color-success-foreground: #ffffff;
  --color-warning: #f59e0b;
  --color-warning-foreground: #ffffff;
  --color-border: #D9D9D9;
  --color-input: #D9D9D9;
  --color-ring: #234948;
  --color-card: #ffffff;
  --color-card-foreground: #0a0f0e;
  --color-popover: #ffffff;
  --color-popover-foreground: #0a0f0e;

  /* Border Radius */
  --radius-lg: 0.5rem;
  --radius-md: calc(0.5rem - 2px);
  --radius-sm: calc(0.5rem - 4px);
}

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-family: 'Inter', system-ui, sans-serif;
    font-feature-settings: "rlig" 1, "calt" 1;
  }

  /* Dark Mode Overrides */
  .dark {
    --color-background: #0a0f0e;
    --color-foreground: #f0f7f7;
    --color-primary: #3d7c79;
    --color-primary-foreground: #ffffff;
    --color-secondary: #2d4d4c;
    --color-secondary-foreground: #f0f7f7;
    --color-muted: #1a2928;
    --color-muted-foreground: #8a9a99;
    --color-accent: #3d7c79;
    --color-accent-foreground: #f0f7f7;
    --color-destructive: #ef4444;
    --color-destructive-foreground: #ffffff;
    --color-border: #2d4d4c;
    --color-input: #2d4d4c;
    --color-ring: #3d7c79;
    --color-card: #0f1716;
    --color-card-foreground: #f0f7f7;
    --color-popover: #0f1716;
    --color-popover-foreground: #f0f7f7;
  }
}

@layer components {
  html {
    scroll-behavior: smooth;
  }
}
```

---

## Typography

### Font Family

**Inter** is the primary font for all Arcline applications.

```css
font-family: 'Inter', system-ui, sans-serif;
```

### Font Weights

| Weight | Usage |
|--------|-------|
| 400 (Regular) | Body text, descriptions |
| 500 (Medium) | Labels, navigation |
| 600 (Semibold) | Headings, card titles |
| 700 (Bold) | Primary headings, emphasis |

### Text Sizes (Tailwind Classes)

| Class | Size | Usage |
|-------|------|-------|
| `text-xs` | 12px | Captions, badges |
| `text-sm` | 14px | Secondary text, form labels |
| `text-base` | 16px | Body text |
| `text-lg` | 18px | Card titles, subheadings |
| `text-xl` | 20px | Section headings |
| `text-2xl` | 24px | Page titles |
| `text-3xl` | 30px | Hero text |

---

## Dependencies

### Required npm Packages

```bash
# Core Tailwind CSS v4
npm install tailwindcss@^4.0.0 @tailwindcss/vite

# Styling utilities
npm install tailwind-merge clsx class-variance-authority

# UI component foundation (shadcn/ui dependencies)
npm install @radix-ui/react-icons lucide-react

# Theme management
npm install next-themes

# Tailwind plugins
npm install @tailwindcss/typography tailwindcss-animate
```

### Dev Dependencies

```bash
npm install -D @types/node
```

---

## Tailwind CSS v4 Setup

### CRITICAL: Tailwind v4 Breaking Changes

Tailwind CSS v4 uses a completely different setup than v3. Follow these steps exactly.

### vite.config.js

```javascript
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),  // MUST come before react()
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'var(--color-border)',
        input: 'var(--color-input)',
        ring: 'var(--color-ring)',
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          foreground: 'var(--color-primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          foreground: 'var(--color-secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--color-destructive)',
          foreground: 'var(--color-destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          foreground: 'var(--color-accent-foreground)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          foreground: 'var(--color-success-foreground)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          foreground: 'var(--color-warning-foreground)',
        },
        popover: {
          DEFAULT: 'var(--color-popover)',
          foreground: 'var(--color-popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--color-card)',
          foreground: 'var(--color-card-foreground)',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
  ],
}
```

### DO NOT Use (Old v3 Syntax)

```css
/* WRONG - These don't work in v4 */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

---

## Dark Mode

### Theme Provider Setup

Create `src/components/theme-provider.jsx`:

```jsx
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

### Wrap App with Theme Provider

In `src/main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/theme-provider'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
```

### Theme Toggle Button

```jsx
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      className="relative"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
```

---

## Core Components

### Utility Function (Required)

Create `src/lib/utils.js`:

```javascript
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
```

### Button Component

Create `src/components/ui/button.jsx`:

```jsx
import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success text-success-foreground hover:bg-success/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
```

### Card Component

Create `src/components/ui/card.jsx`:

```jsx
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-sm",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
```

### Alert Component

Create `src/components/ui/alert.jsx`:

```jsx
import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive: "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive bg-destructive/10",
        success: "border-success/50 text-success dark:border-success [&>svg]:text-success bg-success/10",
        warning: "border-warning/50 text-warning dark:border-warning [&>svg]:text-warning bg-warning/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
```

### Badge Component

Create `src/components/ui/badge.jsx`:

```jsx
import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
```

### Input Component

Create `src/components/ui/input.jsx`:

```jsx
import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
```

### Progress Component

Create `src/components/ui/progress.jsx`:

```jsx
import * as React from "react"
import { cn } from "@/lib/utils"

const Progress = React.forwardRef(({ className, value, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
      className
    )}
    {...props}
  >
    <div
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </div>
))
Progress.displayName = "Progress"

export { Progress }
```

---

## Layout Patterns

### Application Shell (Header + Content)

```jsx
function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
```

### Header with Navigation

```jsx
import { useTheme } from 'next-themes';
import { Moon, Sun, User, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

function Header({ user, onLogout }) {
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          {/* Logo & App Name */}
          <div className="flex items-center gap-3">
            <img
              src={theme === 'dark' ? '/arcline-logo-dark.png' : '/arcline-logo.png'}
              alt="Arcline"
              className="h-8 w-auto"
            />
            <span className="text-lg font-semibold">App Name</span>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>

            {/* User Menu */}
            {user && (
              <>
                <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{user.name}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={onLogout}>
                  <LogOut className="h-5 w-5" />
                  <span className="sr-only">Log out</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
```

### Responsive Grid

```jsx
function GridLayout({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {children}
    </div>
  );
}
```

### Two-Column Layout (Sidebar + Content)

```jsx
function SidebarLayout({ sidebar, children }) {
  return (
    <div className="flex gap-6">
      <aside className="w-64 shrink-0">
        {sidebar}
      </aside>
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
```

---

## Interactive Elements

### Drag and Drop Zone

```jsx
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

function DropZone({ onDrop, isDragging, accept = ".xlsx,.csv" }) {
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/50"
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Upload className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-lg font-medium">Drop files here</p>
          <p className="text-sm text-muted-foreground">
            or click to browse
          </p>
        </div>
      </div>
      <input
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => onDrop(Array.from(e.target.files))}
      />
    </div>
  );
}
```

### Draggable List Items

```jsx
import { GripVertical } from 'lucide-react';

function DraggableItem({ item, onDragStart, onDragEnd, onDragOver }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      className="flex items-center gap-3 p-3 bg-card border rounded-lg cursor-move hover:shadow-md transition-shadow"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1">{item.label}</span>
    </div>
  );
}
```

### Select Dropdown

```jsx
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function Select({ value, onChange, options, placeholder = "Select..." }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
        )}
      >
        <option value="" disabled>{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}
```

### Checkbox with Label

```jsx
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

function Checkbox({ checked, onChange, label, id }) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 cursor-pointer">
      <div
        className={cn(
          "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
          checked
            ? "bg-primary border-primary"
            : "border-input hover:border-primary"
        )}
      >
        {checked && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
```

---

## Loading & Feedback States

### Loading Spinner

```jsx
import { Loader2 } from 'lucide-react';

function Spinner({ size = "default", className }) {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-6 w-6",
    lg: "h-8 w-8",
  };

  return (
    <Loader2 className={cn("animate-spin text-primary", sizeClasses[size], className)} />
  );
}
```

### Skeleton Loader

```jsx
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

// Usage
function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}
```

### Progress with Label

```jsx
function ProgressWithLabel({ value, label }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <Progress value={value} />
    </div>
  );
}
```

### Toast / Notification Pattern

```jsx
import { CheckCircle, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function Toast({ type = "success", message, onClose }) {
  const icons = {
    success: <CheckCircle className="h-5 w-5 text-success" />,
    error: <AlertCircle className="h-5 w-5 text-destructive" />,
    warning: <AlertCircle className="h-5 w-5 text-warning" />,
  };

  return (
    <div className={cn(
      "fixed bottom-4 right-4 flex items-center gap-3 p-4 rounded-lg shadow-lg bg-card border",
      type === "success" && "border-success/50",
      type === "error" && "border-destructive/50",
      type === "warning" && "border-warning/50"
    )}>
      {icons[type]}
      <span className="text-sm">{message}</span>
      <button onClick={onClose} className="ml-2 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
```

---

## Accessibility

### Always Include

1. **Screen reader text** for icon-only buttons:
   ```jsx
   <Button variant="ghost" size="icon">
     <Settings className="h-4 w-4" />
     <span className="sr-only">Open settings</span>
   </Button>
   ```

2. **Focus visible states** (built into components):
   ```css
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
   ```

3. **Semantic HTML**:
   - Use `<button>` for actions, `<a>` for navigation
   - Use `<header>`, `<main>`, `<nav>`, `<footer>`
   - Use heading hierarchy (`h1` → `h2` → `h3`)

4. **Color contrast**: All Arcline colors meet WCAG AA standards

5. **Keyboard navigation**: All interactive elements must be keyboard accessible

---

## Icon Usage

Use **Lucide React** for all icons. Never use emojis.

```jsx
import {
  FileText,
  Download,
  Upload,
  User,
  Settings,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Info,
  Loader2,
  Moon,
  Sun
} from 'lucide-react';

// Icon in button
<Button>
  <Download className="mr-2 h-4 w-4" />
  Download
</Button>

// Icon badge
<div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
  <FileText className="w-5 h-5 text-primary" />
</div>
```

---

## Checklist for New Applications

- [ ] Logo assets placed in `public/` and `src/assets/`
- [ ] Favicon configured in `index.html`
- [ ] Tailwind CSS v4 configured with Vite plugin
- [ ] Color palette added to `index.css`
- [ ] `tailwind.config.js` created with theme extensions
- [ ] Theme provider wrapping app in `main.jsx`
- [ ] `src/lib/utils.js` created with `cn` function
- [ ] Core UI components installed (button, card, alert, input)
- [ ] Dark mode toggle in header
- [ ] Responsive layouts tested
- [ ] Accessibility audit passed
