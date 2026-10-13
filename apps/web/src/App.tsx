import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HistoryPage from "@/pages/HistoryPage";
import LoginPage from "@/pages/LoginPage";
import NewTicketPage from "@/pages/NewTicketPage";
import TicketDetailPage from "@/pages/TicketDetailPage";
import ChatPage from "@/pages/ChatPage";
import TransfersPage from "@/pages/TransfersPage";
import ConversationPage from "@/pages/ConversationPage";
import SupportInboxPage from "@/pages/SupportInboxPage";
import SupportConversationPage from "@/pages/SupportConversationPage";
import { SessionProvider, useSession } from "@/session";

function ProtectedPages({ role }: { role: "customer" | "support" }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user?.role !== role) return <Navigate to={session.user?.role === "support" ? "/support" : "/chat"} replace />;
  return <main className="mx-auto min-h-screen max-w-6xl space-y-6 px-4 py-6 md:px-8">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <h1 className="text-xl font-semibold">Support Ticket AI</h1>
      <nav aria-label="Account and tickets" className="flex flex-wrap items-center gap-4 text-sm">
        {role === "customer" ? <><Link to="/chat">Chat</Link><Link to="/tickets/new">New ticket</Link><Link to="/tickets">Tickets</Link><Link to="/transfers">Demo transfers</Link></> : <Link to="/support">Support inbox</Link>}
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
    <Route element={<ProtectedPages role="customer" />}>
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/transfers" element={<TransfersPage />} />
      <Route path="/chat/:id" element={<ConversationPage />} />
      <Route path="/tickets/new" element={<NewTicketPage />} />
      <Route path="/tickets" element={<HistoryPage />} />
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
    </Route>
    <Route element={<ProtectedPages role="support" />}>
      <Route path="/support" element={<SupportInboxPage />} />
      <Route path="/support/:id" element={<SupportConversationPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/chat" replace />} />
  </Routes></SessionProvider>;
}
export default function App() { return <BrowserRouter><AppRoutes /></BrowserRouter>; }
