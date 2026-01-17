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
  onResizeImage,
  onRemoveImage,
  onToggleHidden,
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
  const [resizing, setResizing] = useState({ id: null, pointerId: null });
  const [localPositions, setLocalPositions] = useState({});
  const [renderImages, setRenderImages] = useState(images);
  const [imageDimensions, setImageDimensions] = useState({});
  const [imageAspectRatios, setImageAspectRatios] = useState({});
  const removedIdsRef = useRef(new Set());

  const BASE_SIZE = 320; // Base size for calculating frame dimensions
  const MIN_SIZE = 50; // Minimum frame dimension
  const dragOffset = useRef({ x: 0, y: 0 });
  const livePosition = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ width: 0, height: 0, clientX: 0, clientY: 0 });
  const panOrigin = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const [diceDebugMode, setDiceDebugMode] = useState(false);

  useEffect(() => {
    // Filter hidden images for players
    const filteredImages = isGM 
      ? images 
      : images.filter((img) => img.hidden !== true);
    const nextImages = filteredImages.filter((img) => !removedIdsRef.current.has(img.id));
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

    // Sync image dimensions from server (for multiplayer)
    setImageDimensions((prev) => {
      const next = { ...prev };
      nextImages.forEach((img) => {
        // Only update from server if not actively resizing this image
        if (resizing.id !== img.id && img.width > 0 && img.height > 0) {
          next[img.id] = { width: img.width, height: img.height };
        }
      });
      return next;
    });
  }, [images, dragging.id, resizing.id, isGM]);

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

  const handleImageLoad = useCallback((imageId, event, serverWidth, serverHeight) => {
    const img = event.target;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    if (naturalWidth && naturalHeight) {
      const aspectRatio = naturalWidth / naturalHeight;
      
      // Always store the aspect ratio
      setImageAspectRatios(prev => ({
        ...prev,
        [imageId]: aspectRatio
      }));
      
      // Use server dimensions if available, otherwise calculate from natural size
      if (serverWidth > 0 && serverHeight > 0) {
        setImageDimensions(prev => ({
          ...prev,
          [imageId]: { width: serverWidth, height: serverHeight }
        }));
      } else if (!imageDimensions[imageId]) {
        // Only set default dimensions if we don't already have them
        let frameWidth, frameHeight;
        if (aspectRatio >= 1) {
          // Landscape or square: height (smallest) is base size
          frameHeight = BASE_SIZE;
          frameWidth = BASE_SIZE * aspectRatio;
        } else {
          // Portrait: width (smallest) is base size
          frameWidth = BASE_SIZE;
          frameHeight = BASE_SIZE / aspectRatio;
        }
        setImageDimensions(prev => ({
          ...prev,
          [imageId]: { width: frameWidth, height: frameHeight }
        }));
      }
    }
  }, [imageDimensions]);

  const getFrameDimensions = useCallback((imageId, serverWidth, serverHeight) => {
    // First check if we have local dimensions (from resize or image load)
    if (imageDimensions[imageId]) {
      return imageDimensions[imageId];
    }
    // Fall back to server dimensions if available
    if (serverWidth > 0 && serverHeight > 0) {
      return { width: serverWidth, height: serverHeight };
    }
    // Default size
    return { width: BASE_SIZE, height: BASE_SIZE };
  }, [imageDimensions]);

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

  const beginResize = useCallback((image, event) => {
    if (!isGM) return;
    event.preventDefault();
    event.stopPropagation();
    const currentDimensions = getFrameDimensions(image.id, image.width, image.height);
    resizeStart.current = {
      width: currentDimensions.width,
      height: currentDimensions.height,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    containerRef.current?.setPointerCapture(event.pointerId);
    setResizing({ id: image.id, pointerId: event.pointerId });
  }, [isGM, getFrameDimensions]);

  const handlePointerMove = useCallback((event) => {
    if (panning.active && panning.pointerId === event.pointerId) {
      const dx = event.clientX - panOrigin.current.x;
      const dy = event.clientY - panOrigin.current.y;
      setPan({ x: panOrigin.current.startX + dx, y: panOrigin.current.startY + dy });
      return;
    }
    if (resizing.id && resizing.pointerId === event.pointerId) {
      const dx = (event.clientX - resizeStart.current.clientX) / scale;
      const dy = (event.clientY - resizeStart.current.clientY) / scale;
      const aspectRatio = imageAspectRatios[resizing.id] || 1;
      
      // Use the larger delta to determine new size, maintaining aspect ratio
      const deltaSize = Math.max(dx, dy);
      let newWidth, newHeight;
      
      if (aspectRatio >= 1) {
        // Landscape: width drives the size
        newWidth = Math.max(MIN_SIZE * aspectRatio, resizeStart.current.width + deltaSize);
        newHeight = newWidth / aspectRatio;
      } else {
        // Portrait: height drives the size
        newHeight = Math.max(MIN_SIZE / aspectRatio, resizeStart.current.height + deltaSize);
        newWidth = newHeight * aspectRatio;
      }
      
      setImageDimensions(prev => ({
        ...prev,
        [resizing.id]: { width: newWidth, height: newHeight }
      }));
      return;
    }
    if (!dragging.id || dragging.pointerId !== event.pointerId) return;
    const pointer = toCanvasCoords(event.clientX, event.clientY);
    const nextPosition = { x: pointer.x - dragOffset.current.x, y: pointer.y - dragOffset.current.y };
    livePosition.current = nextPosition;
    setLocalPositions((prev) => ({ ...prev, [dragging.id]: nextPosition }));
  }, [panning, dragging, resizing, toCanvasCoords, scale, imageAspectRatios]);

  const endDrag = async (event) => {
    if (panning.active && panning.pointerId === event.pointerId) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      setPanning({ active: false, pointerId: null });
    }

    if (resizing.id && resizing.pointerId === event.pointerId) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      const finalDimensions = imageDimensions[resizing.id];
      const imageId = resizing.id;
      setResizing({ id: null, pointerId: null });
      if (finalDimensions) {
        await onResizeImage?.(imageId, { width: finalDimensions.width, height: finalDimensions.height });
      }
      return;
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
        const isHidden = image.hidden === true;
        const frameDimensions = getFrameDimensions(image.id, image.width, image.height);
        return (
          <div
            className={`canvas-layer ${image.status ? `canvas-layer--${image.status}` : ''} ${isHidden ? 'canvas-layer--hidden' : ''}`}
            key={image.id || image.url}
            data-id={image.id}
            style={{ 
              transform: `translate(${position.x}px, ${position.y}px)`,
              cursor: isGM ? (isDragging ? 'grabbing' : 'grab') : 'default',
              userSelect: 'none',
              opacity: isHidden && isGM ? 0.4 : 1,
              width: `${frameDimensions.width}px`,
              height: `${frameDimensions.height}px`,
            }}
            onPointerDown={(event) => beginDrag(image, event)}
            onDragStart={(event) => event.preventDefault()}
          >
            {isGM && (
              <>
                <button
                  type="button"
                  className="image-hide"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleHidden?.(image.id, !isHidden);
                  }}
                  title={isHidden ? 'Show image to players' : 'Hide image from players'}
                >
                  {isHidden ? '👁' : '🙈'}
                </button>
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
              </>
            )}
            <img
              src={image.url}
              alt={image.name || 'Shared image'}
              loading="lazy"
              draggable={false}
              onLoad={(event) => handleImageLoad(image.id, event, image.width, image.height)}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
            {image.status && image.status !== 'done' && <span className={`badge badge--${image.status}`}>{image.status}</span>}
            {isGM && (
              <div
                className="image-resize-handle"
                onPointerDown={(event) => beginResize(image, event)}
              />
            )}
          </div>
        );
      }),
    [renderImages, isGM, onRemoveImage, onToggleHidden, getImagePosition, getFrameDimensions, beginDrag, beginResize, dragging, handleImageLoad]
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
      style={{ cursor: resizing.id ? 'nwse-resize' : (dragging.id || panning.active ? 'grabbing' : 'grab') }}
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
    width: PropTypes.number,
    height: PropTypes.number,
    hidden: PropTypes.bool,
  })).isRequired,
  isGM: PropTypes.bool.isRequired,
  onUploadFiles: PropTypes.func,
  onShareUrl: PropTypes.func,
  onMoveImage: PropTypes.func,
  onResizeImage: PropTypes.func,
  onRemoveImage: PropTypes.func,
  onToggleHidden: PropTypes.func,
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
