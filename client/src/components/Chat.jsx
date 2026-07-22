import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
      setUnread((n) => (open ? n : n + 1));
    };
    socket.on('chat:message', onMessage);
    return () => socket.off('chat:message', onMessage);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    getSocket().emit('chat:send', { text });
    setText('');
  }

  return (
    <div className="panel chat">
      <h3
        onClick={() => setOpen((o) => {
          if (!o) setUnread(0);
          return !o;
        })}
        className="collapsible"
      >
        Chat {unread > 0 && <span className="badge">{unread}</span>} {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 && <p className="muted">No messages yet.</p>}
            {messages.map((m) => (
              <div key={m.id} className="chat-message">
                <span className={m.isTeacher ? 'chat-author teacher' : 'chat-author'}>
                  {m.name}
                </span>
                <span className="chat-text">{m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={send} className="chat-input">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say something…"
            />
            <button type="submit">Send</button>
          </form>
        </>
      )}
    </div>
  );
}
