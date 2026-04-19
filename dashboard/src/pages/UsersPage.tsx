/**
 * pages/UsersPage.tsx — Redirect stub.
 *
 * In single-tenant mode, Users == Auth Keys. The /v1/users endpoint does not
 * exist on the server. SSO-backed user identities will return with Phase 3.
 * Until then, any request for /users redirects to /auth/keys and surfaces a
 * dismissible banner explaining the mental model.
 *
 * The route itself is redirected at the router level in App.tsx; this file
 * remains as a safety net for direct imports and preserves lazy-load parity.
 */

import { Navigate } from 'react-router-dom';

export default function UsersPage() {
  return <Navigate to="/auth/keys" replace state={{ usersRedirect: true }} />;
}
