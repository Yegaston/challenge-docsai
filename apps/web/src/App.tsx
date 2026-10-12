import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HistoryPage from "@/pages/HistoryPage";
import LoginPage from "@/pages/LoginPage";
import NewTicketPage from "@/pages/NewTicketPage";
import TicketDetailPage from "@/pages/TicketDetailPage";
import { SessionProvider, useSession } from "@/session";

function ProtectedPages() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  if (!session) return <Navigate to="/login" replace />;
  return <main className="mx-auto min-h-screen max-w-2xl space-y-6 px-6 py-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">Support Ticket AI</h1>
      <nav aria-label="Account and tickets" className="flex flex-wrap items-center gap-4 text-sm">
        <Link to="/tickets/new">New ticket</Link><Link to="/tickets">Tickets</Link>
        {session.user && <span>{session.user.email}</span>}
        <Button variant="outline" size="sm" onClick={() => { logout(); navigate("/login"); }}>Log out</Button>
      </nav>
    </header>
    <Outlet />
  </main>;
}
function AppRoutes() {
  return <SessionProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedPages />}>
      <Route path="/tickets/new" element={<NewTicketPage />} />
      <Route path="/tickets" element={<HistoryPage />} />
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/tickets" replace />} />
  </Routes></SessionProvider>;
}
export default function App() { return <BrowserRouter><AppRoutes /></BrowserRouter>; }
