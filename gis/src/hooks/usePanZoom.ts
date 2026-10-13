import { useRef, useState, useCallback, useEffect } from 'react';

interface PanZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

export function usePanZoom(minScale = 0.2, maxScale = 5) {
  const [transform, setTransform] = useState<PanZoomState>({
    scale: 1, translateX: 0, translateY: 0,
  });
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => {
      const newScale = Math.min(maxScale, Math.max(minScale, prev.scale * delta));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return prev;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const newTranslateX = mouseX - (mouseX - prev.translateX) * (newScale / prev.scale);
      const newTranslateY = mouseY - (mouseY - prev.translateY) * (newScale / prev.scale);
      return { scale: newScale, translateX: newTranslateX, translateY: newTranslateY };
    });
  }, [minScale, maxScale]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1 && !e.altKey) return;
    isPanning.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({
      ...prev,
      translateX: prev.translateX + dx,
      translateY: prev.translateY + dy,
    }));
  }, []);

  const onMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.min(maxScale, prev.scale * 1.25),
    }));
  }, [maxScale]);

  const zoomOut = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.max(minScale, prev.scale * 0.8),
    }));
  }, [minScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const cssTransform = `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`;

  return {
    containerRef,
    cssTransform,
    transform,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    resetTransform,
    zoomIn,
    zoomOut,
  };
}
