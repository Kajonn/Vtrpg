import { useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const Canvas = ({ images }) => {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [draggingPointer, setDraggingPointer] = useState(null);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map());
  const pinchDistance = useRef(null);

  const handleWheel = (event) => {
    event.preventDefault();
    const delta = -event.deltaY;
    const nextScale = clamp(scale + delta * 0.001, 0.25, 3);
    setScale(nextScale);
  };

  const handlePointerDown = (event) => {
    containerRef.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      setDraggingPointer(event.pointerId);
      setLastPos({ x: event.clientX, y: event.clientY });
    }
    if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values());
      pinchDistance.current = Math.hypot(second.x - first.x, second.y - first.y);
    }
  };

  const handlePointerUp = (event) => {
    containerRef.current?.releasePointerCapture(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (draggingPointer === event.pointerId) {
      setDraggingPointer(null);
    }
    if (pointers.current.size < 2) {
      pinchDistance.current = null;
    }
  };

  const handlePointerMove = (event) => {
    if (!pointers.current.has(event.pointerId)) return;
    const previous = pointers.current.get(event.pointerId);
    const updated = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, updated);

    if (pointers.current.size === 2 && pinchDistance.current) {
      const [first, second] = Array.from(pointers.current.values());
      const nextDistance = Math.hypot(second.x - first.x, second.y - first.y);
      const delta = nextDistance / pinchDistance.current;
      setScale((prev) => clamp(prev * delta, 0.25, 3));
      pinchDistance.current = nextDistance;
      return;
    }

    if (draggingPointer === event.pointerId) {
      const dx = updated.x - previous.x;
      const dy = updated.y - previous.y;
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPos(updated);
    }
  };

  const gallery = useMemo(
    () =>
      images.map((image) => (
        <div
          className={`canvas-layer ${image.status ? `canvas-layer--${image.status}` : ''}`}
          key={image.id || image.url}
        >
          <img
            src={image.url}
            alt={image.name || 'Shared image'}
            loading="lazy"
            draggable={false}
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
          {image.status && <span className={`badge badge--${image.status}`}>{image.status}</span>}
        </div>
      )),
    [images]
  );

  return (
    <div
      className="canvas"
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerMove={handlePointerMove}
      style={{ cursor: draggingPointer ? 'grabbing' : 'grab' }}
    >
      <div
        className="canvas-inner"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
      >
        {gallery}
      </div>
    </div>
  );
};

Canvas.propTypes = {
  images: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    url: PropTypes.string,
    status: PropTypes.string,
  })).isRequired,
};

export default Canvas;
