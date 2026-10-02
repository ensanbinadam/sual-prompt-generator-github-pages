'use client';

import { useRef, useState, type PointerEvent } from 'react';

export type FigureCrop = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

export function FigureCropper({ src, onCapture, onCancel }: {
  src: string;
  onCapture: (crop: FigureCrop) => void;
  onCancel: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<Point>();
  const [cursor, setCursor] = useState<Point>();

  function point(event: PointerEvent<HTMLDivElement>): Point {
    const box = frame.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100)),
    };
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event);
    setOrigin(next);
    setCursor(next);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (origin) setCursor(point(event));
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!origin) return;
    const end = point(event);
    const crop = {
      x: Math.min(origin.x, end.x),
      y: Math.min(origin.y, end.y),
      width: Math.abs(end.x - origin.x),
      height: Math.abs(end.y - origin.y),
    };
    setOrigin(undefined);
    setCursor(undefined);
    if (crop.width < 1 || crop.height < 1) return;
    onCapture(crop);
  }

  const selection = origin && cursor ? {
    left: `${Math.min(origin.x, cursor.x)}%`,
    top: `${Math.min(origin.y, cursor.y)}%`,
    width: `${Math.abs(cursor.x - origin.x)}%`,
    height: `${Math.abs(cursor.y - origin.y)}%`,
  } : undefined;

  return (
    <div className="cropper-panel">
      <div className="cropper-help">
        <strong>اسحب إطارًا حول الرسم المطلوب</strong>
        <span>ابدأ من إحدى زوايا الرسم واترك المؤشر عند الزاوية المقابلة. سيُقص ويُدرج مباشرة بعد الإفلات.</span>
      </div>
      <div ref={frame} className="cropper-frame" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { setOrigin(undefined); setCursor(undefined); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="صفحة المصدر لاختيار الرسم" draggable={false} />
        {selection && <i className="crop-selection" style={selection} />}
      </div>
      <button className="cropper-cancel" type="button" onClick={onCancel}>إلغاء التقاط الرسم</button>
    </div>
  );
}
