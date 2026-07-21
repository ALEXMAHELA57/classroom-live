import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';

const WIDTH = 480;
const HEIGHT = 300;

export default function Whiteboard({ isTeacher }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b2b31';

    const socket = getSocket();
    const onDraw = (segment) => drawSegment(ctx, segment);
    const onClear = () => ctx.clearRect(0, 0, WIDTH, HEIGHT);
    socket.on('whiteboard:draw', onDraw);
    socket.on('whiteboard:clear', onClear);
    return () => {
      socket.off('whiteboard:draw', onDraw);
      socket.off('whiteboard:clear', onClear);
    };
  }, []);

  function drawSegment(ctx, { x1, y1, x2, y2 }) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * WIDTH,
      y: ((point.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(e) {
    if (!isTeacher) return;
    drawing.current = true;
    last.current = pos(e);
    // Keep receiving pointermove even if the cursor briefly leaves the
    // canvas mid-stroke (common with fast mouse movement or a stylus).
    e.target.setPointerCapture?.(e.pointerId);
  }

  function move(e) {
    if (!isTeacher || !drawing.current) return;
    const p = pos(e);
    const segment = { x1: last.current.x, y1: last.current.y, x2: p.x, y2: p.y };
    drawSegment(canvasRef.current.getContext('2d'), segment);
    getSocket().emit('whiteboard:draw', segment);
    last.current = p;
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    canvasRef.current.getContext('2d').clearRect(0, 0, WIDTH, HEIGHT);
    getSocket().emit('whiteboard:clear');
  }

  return (
    <div className="panel">
      <h3 onClick={() => setOpen((o) => !o)} className="collapsible">
        Whiteboard {open ? '▾' : '▸'}
      </h3>
      {open && (
        <>
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            className="whiteboard-canvas"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
          {isTeacher && (
            <button className="ghost" onClick={clear}>
              Clear board
            </button>
          )}
        </>
      )}
    </div>
  );
}
