import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { BareLayout, Layout } from './components/Layout';
import { NotFound, RequireAdmin, RequireAuth, RouteError } from './components/States';

// Route-level code splitting: each page is its own chunk.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});
const named =
  <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  async () => ({ Component: (await load())[name] });

const admin = () => import('./pages/admin/Admin');

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import('./pages/Home')) },
      { path: 'movies/:id', lazy: page(() => import('./pages/MovieDetail')) },
      { path: 'movies/:id/showtimes', lazy: page(() => import('./pages/Showtimes')) },
      { path: 'showtimes/:id/seats', lazy: page(() => import('./pages/SeatMap')) },
      { path: 'login', lazy: named(() => import('./pages/Auth'), 'Login') },
      { path: 'signup', lazy: named(() => import('./pages/Auth'), 'Signup') },
      {
        element: <RequireAuth />,
        children: [
          { path: 'checkout/:bookingId', lazy: page(() => import('./pages/Checkout')) },
          { path: 'bookings', lazy: page(() => import('./pages/Bookings')) },
          { path: 'bookings/:id', lazy: page(() => import('./pages/Ticket')) },
          { path: 'profile', lazy: page(() => import('./pages/Profile')) },
        ],
      },
      {
        path: 'admin',
        element: <RequireAdmin />,
        children: [
          { index: true, lazy: named(admin, 'AdminDashboard') },
          { path: 'theatres', lazy: named(admin, 'AdminTheatres') },
          { path: 'screens', lazy: named(admin, 'AdminScreens') },
          { path: 'showtimes', lazy: named(admin, 'AdminShowtimes') },
          { path: 'bookings', lazy: named(admin, 'AdminBookings') },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    // The fake gateway is deliberately styled as a separate site.
    element: <BareLayout />,
    errorElement: <RouteError />,
    children: [
      {
        element: <RequireAuth />,
        children: [{ path: 'pay/:bookingId', lazy: page(() => import('./pages/Pay')) }],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
