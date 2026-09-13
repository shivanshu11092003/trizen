import { Suspense, lazy, useEffect } from 'react';
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Navigate,
} from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { api } from './lib/api';
import { useAuthStore } from './stores/auth';

const AuthPage = lazy(() => import('./routes/AuthPage'));
const AdminApp = lazy(() => import('./routes/admin/AdminApp'));
const GalleryApp = lazy(() => import('./routes/gallery/GalleryApp'));

function TeamPage() {
  const status = useAuthStore((state) => state.status);
  if (status === 'unknown')
    return (
      <div className="page-loader" role="status">
        Checking your session…
      </div>
    );
  if (status === 'anon') return <Navigate to="/login" />;
  return <AdminApp />;
}

function Root() {
  const setSession = useAuthStore((state) => state.setSession);
  const clear = useAuthStore((state) => state.clear);

  useEffect(() => {
    void api.me().then(setSession).catch(clear);
  }, [clear, setSession]);

  return (
    <Suspense
      fallback={
        <div className="page-loader">
          <LoaderCircle aria-hidden="true" />
          <span>Preparing your workspace</span>
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}

const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: useAuthStore.getState().status === 'authed' ? '/events' : '/login' });
  },
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => <AuthPage mode="login" />,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: () => <AuthPage mode="register" />,
});
const eventsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/events', component: TeamPage });
const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId',
  component: TeamPage,
});
const photosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/photos',
  component: TeamPage,
});
const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/upload',
  component: TeamPage,
});
const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/team',
  component: TeamPage,
});
const galleriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events/$eventId/galleries',
  component: TeamPage,
});
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gallery/$slug',
  component: GalleryApp,
});
const galleryViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gallery/$slug/view',
  component: GalleryApp,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  eventsRoute,
  eventRoute,
  photosRoute,
  uploadRoute,
  teamRoute,
  galleriesRoute,
  galleryRoute,
  galleryViewRoute,
]);
const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return <RouterProvider router={router} />;
}
