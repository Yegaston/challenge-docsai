import { useState, type ReactNode } from "react";

export default function ChatHistory({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="chat-history-toggle" aria-expanded={open} aria-controls="chat-history" onClick={() => setOpen(!open)}>{open ? "Hide history" : "Show history"}</button><aside id="chat-history" className={`chat-sidebar ${open ? "chat-history-open" : ""}`} aria-label="Conversation history">{children}</aside></>;
}
