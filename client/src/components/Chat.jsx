import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (msg) => setMessages((prev) => [...prev, msg]);
    socket.on('chat:message', onMessage);
    return () => socket.off('chat:message', onMessage);
  }, []);

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
      <h3>Chat</h3>
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
    </div>
  );
}
