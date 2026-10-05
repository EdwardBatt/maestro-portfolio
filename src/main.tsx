import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import './lib/i18n'
import { applyLocale } from './lib/i18n'
// ADR-0114: Inter is carried in the build, never fetched from a font service.
import '@fontsource-variable/inter'
import './index.css'
import { AuthProvider } from './app/auth-context'
import { DevPreviewProvider } from './app/dev-preview'
import { PermissionsProvider } from './app/permissions'
import { router } from './app/router'

applyLocale('en')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DevPreviewProvider>
          <PermissionsProvider>
            <RouterProvider router={router} />
          </PermissionsProvider>
        </DevPreviewProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
