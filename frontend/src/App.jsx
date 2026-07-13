import { useEffect } from 'react'
import { useTheme } from './components/theme-provider'
import { useAuth } from './hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Moon, Sun } from 'lucide-react'
import QuoteTool from '@/components/QuoteTool'
import api from '@/services/ApiService'

const DEV_NO_AUTH = import.meta.env.VITE_DEV_NO_AUTH === 'true'

function App() {
  const { resolvedTheme, setTheme } = useTheme()
  const { isAuthenticated, login, logout, getUser, getAccessToken } = useAuth()
  const user = getUser()

  useEffect(() => {
    api.setTokenProvider(getAccessToken)
  }, [getAccessToken])

  // Login page
  if (!isAuthenticated && !DEV_NO_AUTH) {
    return (
      <div className="min-h-screen bg-background flex justify-center items-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="flex justify-center">
              <img
                src={resolvedTheme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
                alt="Arcline"
                className="h-12"
              />
            </div>
            <div>
              <CardTitle className="text-2xl text-primary">Anillo Quote Tool</CardTitle>
              <CardDescription className="mt-2">Sign in to continue</CardDescription>
            </div>
            <Button onClick={login} size="lg" className="w-full">
              Sign in with Microsoft
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Main application
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <img
              src={resolvedTheme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
              alt="Arcline"
              className="h-8"
            />
            <div className="h-8 w-px bg-border"></div>
            <h1 className="text-xl font-semibold text-foreground">Anillo Quote Tool</h1>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
            {user && (
              <span className="text-sm text-muted-foreground hidden md:block">{user.name}</span>
            )}
            {!DEV_NO_AUTH && (
              <Button variant="outline" size="sm" onClick={logout}>
                Logout
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">
        <div className="container mx-auto max-w-[1400px] px-4 py-6">
          <QuoteTool />
        </div>
      </main>
    </div>
  )
}

export default App
