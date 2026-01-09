import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import DiceOverlay from './DiceOverlay.jsx';
import DiceDebug from './DiceDebug.jsx';

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
  const [diceDebugMode, setDiceDebugMode] = useState(false);

  useEffect(() => {
    const nextImages = images.filter((img) => !removedIdsRef.current.has(img.id));
    setRenderImages(nextImages);
    
    // Clean up removedIdsRef: remove IDs that are no longer in the source images
    const currentIds = new Set(images.map(img => img.id));
    removedIdsRef.current.forEach(id => {
      if (!currentIds.has(id)) {
        removedIdsRef.current.delete(id);
      }
    });
    
    setLocalPositions((prev) => {
      const next = {};
      nextImages.forEach((img) => {
        // Only preserve local position if we're actively dragging this image
        // Otherwise, accept updates from server (for multiplayer sync)
        if (prev[img.id] && dragging.id === img.id) {
          next[img.id] = prev[img.id];
        } else {
          next[img.id] = { x: img.x || 0, y: img.y || 0 };
        }
      });
      return next;
    });
  }, [images, dragging.id]);

  const toCanvasCoords = useCallback((clientX, clientY) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    // Use center-relative coordinates to match handleWheel's pan coordinate space
    const screenX = clientX - bounds.left - bounds.width / 2;
    const screenY = clientY - bounds.top - bounds.height / 2;
    return {
      x: (screenX - pan.x) / scale,
      y: (screenY - pan.y) / scale,
    };
  }, [pan, scale]);

  const getImagePosition = useCallback((image) => {
    return localPositions[image.id] || { x: image.x || 0, y: image.y || 0 };
  }, [localPositions]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    
    const mouseX = (event.clientX - bounds.left)-(bounds.width)/2;
    const mouseY = (event.clientY - bounds.top)-(bounds.height)/2;
    
    const delta = -event.deltaY;
    const nextScale = clamp(scale + delta * 0.001, 0.2, 5);
    
    // Adjust pan to keep zoom centered on mouse position
    const scaleFactor = nextScale / scale;
    const newPanX = mouseX - (mouseX - pan.x) * scaleFactor;
    const newPanY = mouseY - (mouseY - pan.y) * scaleFactor;
    
    setScale(nextScale);
    setPan({ x: newPanX, y: newPanY });
  }, [scale, pan]);

  // Add wheel listener with passive: false to allow preventDefault in Edge
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  const startPan = (event) => {
    if (event.target.closest('.dice-controls')) return;
    if (dragging.id || panning.active) return;
    event.preventDefault();
    panOrigin.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y };
    containerRef.current?.setPointerCapture(event.pointerId);
    setPanning({ active: true, pointerId: event.pointerId });
  };

  const handleCanvasDrop = useCallback(async (event) => {
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
  }, [isGM, toCanvasCoords, onShareUrl, onUploadFiles]);

  const handlePaste = async (event) => {
    if (!isGM) return;
    const url = event.clipboardData?.getData('text');
    if (url) {
      await onShareUrl?.(url.trim());
    }
  };

  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const beginDrag = useCallback((image, event) => {
    if (!isGM) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = toCanvasCoords(event.clientX, event.clientY);
    const position = getImagePosition(image);
    dragOffset.current = { x: pointer.x - position.x, y: pointer.y - position.y };
    livePosition.current = position;
    containerRef.current?.setPointerCapture(event.pointerId);
    setDragging({ id: image.id, pointerId: event.pointerId });
  }, [isGM, toCanvasCoords, getImagePosition]);

  const handlePointerMove = useCallback((event) => {
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
  }, [panning, dragging, toCanvasCoords]);

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
        const isDragging = dragging.id === image.id;
        return (
          <div
            className={`canvas-layer ${image.status ? `canvas-layer--${image.status}` : ''}`}
            key={image.id || image.url}
            data-id={image.id}
            style={{ 
              transform: `translate(${position.x}px, ${position.y}px)`,
              cursor: isGM ? (isDragging ? 'grabbing' : 'grab') : 'default',
              userSelect: 'none'
            }}
            onPointerDown={(event) => beginDrag(image, event)}
            onDragStart={(event) => event.preventDefault()}
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
            {image.status && image.status !== 'done' && <span className={`badge badge--${image.status}`}>{image.status}</span>}
          </div>
        );
      }),
    [renderImages, isGM, onRemoveImage, getImagePosition, beginDrag, dragging]
  );

  return (
    <div
      className="canvas"
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={startPan}
      onDragStart={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleCanvasDrop}
      onPaste={handlePaste}
      style={{ cursor: dragging.id || panning.active ? 'grabbing' : 'grab' }}
    >
      <button
        type="button"
        className="reset-view-button"
        style={{ 
          position: 'absolute', 
          top: '10px', 
          left: '10px', 
          zIndex: 1000, 
          pointerEvents: 'auto',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          padding: '8px 12px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '500'
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          resetView();
        }}
      >
        Reset View
      </button>
      <div 
        className="dice-debug-toggle" 
        style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 1000, pointerEvents: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <label style={{ 
          background: 'rgba(0, 0, 0, 0.7)', 
          color: 'white', 
          padding: '8px 12px', 
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'inline-block',
          userSelect: 'none'
        }}>
          <input
            type="checkbox"
            checked={diceDebugMode}
            onChange={(e) => setDiceDebugMode(e.target.checked)}
            style={{ cursor: 'pointer', marginRight: '6px' }}
          />
          Debug Dice Normals
        </label>
      </div>
      {diceDebugMode ? (
        <DiceDebug />
      ) : (
        <DiceOverlay
          roomId={roomId}
          diceRoll={diceRoll}
          onSendDiceRoll={onSendDiceRoll}
          onDiceResult={onDiceResult}
          userName={userName}
        />
      )}
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
