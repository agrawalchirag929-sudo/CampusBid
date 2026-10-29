import { createBrowserRouter, RouterProvider } from 'react-router';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SiteLayout } from './components/SiteLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MePage } from './pages/MePage';
import { SignupPage } from './pages/SignupPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <SiteLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'signup', element: <SignupPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      {
        path: 'me',
        element: (
          <ProtectedRoute>
            <MePage />
          </ProtectedRoute>
        ),
      },
      {
        path: '*',
        element: (
          <section className="campus-card mx-auto max-w-xl rounded-3xl p-8 text-center">
            <h1 className="font-display text-4xl font-bold">
              That path wandered off
            </h1>
            <p className="mt-3 opacity-75">
              The campus map does not have that stop.
            </p>
          </section>
        ),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
