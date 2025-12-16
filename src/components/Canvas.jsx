import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import DiceOverlay from './DiceOverlay.jsx';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const Canvas = ({
  images,
  isGM,
  onUploadFiles,
  onShareUrl,
  onMoveImage,
  onRemoveImage,
  roomId,
  diceRoll,
  onSendDiceRoll,
  onDiceResult,
  userName,
}) => {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState({ id: null, pointerId: null });
  const [panning, setPanning] = useState({ active: false, pointerId: null });
  const [localPositions, setLocalPositions] = useState({});
  const [renderImages, setRenderImages] = useState(images);
  const removedIdsRef = useRef(new Set());
  const dragOffset = useRef({ x: 0, y: 0 });
  const livePosition = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  useEffect(() => {
    const nextImages = images.filter((img) => !removedIdsRef.current.has(img.id));
    setRenderImages(nextImages);
    setLocalPositions((prev) => {
      const next = {};
      nextImages.forEach((img) => {
        if (prev[img.id]) {
          next[img.id] = prev[img.id];
        }
      });
      return next;
    });
  }, [images]);

  const toCanvasCoords = (clientX, clientY) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: (clientX - bounds.left - pan.x) / scale,
      y: (clientY - bounds.top - pan.y) / scale,
    };
  };

  const getImagePosition = (image) => localPositions[image.id] || { x: image.x || 0, y: image.y || 0 };

  const handleWheel = (event) => {
    event.preventDefault();
    const delta = -event.deltaY;
    const nextScale = clamp(scale + delta * 0.001, 0.5, 3);
    setScale(nextScale);
  };

  const startPan = (event) => {
    if (event.target.closest('.dice-controls')) return;
    if (dragging.id || panning.active) return;
    panOrigin.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y };
    containerRef.current?.setPointerCapture(event.pointerId);
    setPanning({ active: true, pointerId: event.pointerId });
  };

  const handleCanvasDrop = async (event) => {
    event.preventDefault();
    if (!isGM) return;
    const pos = toCanvasCoords(event.clientX, event.clientY);
    const urlFromDrop = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain');
    if (urlFromDrop) {
      await onShareUrl?.(urlFromDrop.trim(), pos);
      return;
    }
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.size > 0);
    if (files.length) {
      await onUploadFiles?.(files, pos);
    }
  };

  const handlePaste = async (event) => {
    if (!isGM) return;
    const url = event.clipboardData?.getData('text');
    if (url) {
      await onShareUrl?.(url.trim());
    }
  };

  const beginDrag = (image, event) => {
    if (!isGM) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = toCanvasCoords(event.clientX, event.clientY);
    const position = getImagePosition(image);
    dragOffset.current = { x: pointer.x - position.x, y: pointer.y - position.y };
    livePosition.current = position;
    containerRef.current?.setPointerCapture(event.pointerId);
    setDragging({ id: image.id, pointerId: event.pointerId });
  };

  const handlePointerMove = (event) => {
    if (panning.active && panning.pointerId === event.pointerId) {
      const dx = event.clientX - panOrigin.current.x;
      const dy = event.clientY - panOrigin.current.y;
      setPan({ x: panOrigin.current.startX + dx, y: panOrigin.current.startY + dy });
      return;
    }
    if (!dragging.id || dragging.pointerId !== event.pointerId) return;
    const pointer = toCanvasCoords(event.clientX, event.clientY);
    const nextPosition = { x: pointer.x - dragOffset.current.x, y: pointer.y - dragOffset.current.y };
    livePosition.current = nextPosition;
    setLocalPositions((prev) => ({ ...prev, [dragging.id]: nextPosition }));
  };

  const endDrag = async (event) => {
    if (panning.active && panning.pointerId === event.pointerId) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      setPanning({ active: false, pointerId: null });
    }

    if (!dragging.id || dragging.pointerId !== event.pointerId) return;
    containerRef.current?.releasePointerCapture(event.pointerId);
    const finalPosition = livePosition.current;
    const imageId = dragging.id;
    setDragging({ id: null, pointerId: null });
    await onMoveImage?.(imageId, finalPosition);
  };

  const gallery = useMemo(
    () =>
      renderImages.map((image) => {
        const position = getImagePosition(image);
        return (
          <div
            className={`canvas-layer ${image.status ? `canvas-layer--${image.status}` : ''}`}
            key={image.id || image.url}
            data-id={image.id}
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            onPointerDown={(event) => beginDrag(image, event)}
          >
            {isGM && (
              <button
                type="button"
                className="image-remove"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  removedIdsRef.current.add(image.id);
                  setRenderImages((prev) => prev.filter((img) => img.id !== image.id));
                  onRemoveImage?.(image.id);
                }}
              >
                X
              </button>
            )}
            <img
              src={image.url}
              alt={image.name || 'Shared image'}
              loading="lazy"
              draggable={false}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
            {image.status && <span className={`badge badge--${image.status}`}>{image.status}</span>}
          </div>
        );
      }),
    [renderImages, isGM, onRemoveImage, localPositions]
  );

  return (
    <div
      className="canvas"
      ref={containerRef}
      onWheel={handleWheel}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={startPan}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleCanvasDrop}
      onPaste={handlePaste}
      style={{ cursor: dragging.id || panning.active ? 'grabbing' : 'grab' }}
    >
      <DiceOverlay
        roomId={roomId}
        diceRoll={diceRoll}
        onSendDiceRoll={onSendDiceRoll}
        onDiceResult={onDiceResult}
        userName={userName}
      />
      <div className="canvas-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
        {!images.length && isGM && <p className="canvas-hint">Drop images or URLs directly onto the board</p>}
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
    x: PropTypes.number,
    y: PropTypes.number,
  })).isRequired,
  isGM: PropTypes.bool.isRequired,
  onUploadFiles: PropTypes.func,
  onShareUrl: PropTypes.func,
  onMoveImage: PropTypes.func,
  onRemoveImage: PropTypes.func,
  roomId: PropTypes.string,
  diceRoll: PropTypes.shape({
    seed: PropTypes.number,
    count: PropTypes.number,
    sides: PropTypes.number,
  }),
  onSendDiceRoll: PropTypes.func,
  onDiceResult: PropTypes.func,
  userName: PropTypes.string,
};

export default Canvas;
