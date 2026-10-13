import { useRef, type FormEvent, type KeyboardEvent, type RefObject } from "react";

type Props = { id: string; label: string; value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; disabled: boolean; pending: boolean; inputRef?: RefObject<HTMLTextAreaElement | null> };
export default function ChatComposer({ id, label, value, onChange, onSubmit, disabled, pending, inputRef }: Props) {
  const composing = useRef(false);
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    event.preventDefault();
    if (disabled || !value.trim()) return;
    event.currentTarget.form?.requestSubmit();
  }
  return <form className="chat-composer" onSubmit={onSubmit}><label htmlFor={id}>{label}</label><div className="chat-composer-row"><textarea ref={inputRef} id={id} maxLength={2000} rows={2} value={value} onChange={event => onChange(event.target.value)} onKeyDown={keyDown} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} disabled={disabled} required /><button type="submit" aria-label={pending ? "Sending message" : "Send message"} title="Send message" disabled={disabled || !value.trim()}><span aria-hidden="true">↑</span></button></div></form>;
}
