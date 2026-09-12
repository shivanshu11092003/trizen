import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../types';

const observers = new Map<string, IntersectionObserver>();
const callbacks = new WeakMap<Element, () => void>();

function observe(element: Element, rootMargin: string, onEnter: () => void) {
  let observer = observers.get(rootMargin);
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        callbacks.get(entry.target)?.();
        observer!.unobserve(entry.target);
        callbacks.delete(entry.target);
      });
    }, { rootMargin });
    observers.set(rootMargin, observer);
  }
  callbacks.set(element, onEnter);
  observer.observe(element);
  return () => { observer?.unobserve(element); callbacks.delete(element); };
}

export function PhotoImage({ photo, index = 0, demo = false, publicSlug }: { photo: Photo; index?: number; demo?: boolean; publicSlug?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(index < 12);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (load || !holder.current) return;
    return observe(holder.current, '400px 0px', () => setLoad(true));
  }, [load]);

  const col = index % 3;
  const row = Math.floor(index / 3) % 2;
  const src = demo
    ? '/assets/wedding-contact-sheet.png'
    : publicSlug
      ? `/api/v1/public/galleries/${publicSlug}/photos/${photo.id}/image/thumb`
      : `/img/thumb/${photo.storageKey}`;
  return (
    <div
      ref={holder}
      className={`photo-image ${ready ? 'is-ready' : ''} ${demo ? 'demo-crop' : ''}`}
      style={{
        aspectRatio: photo.width && photo.height ? `${photo.width}/${photo.height}` : '3/2',
        backgroundColor: photo.dominantColor ?? '#20252c',
        ...(demo ? { backgroundImage: `url(${src})`, backgroundSize: '300% 200%', backgroundPosition: `${col * 50}% ${row * 100}%` } : {}),
      }}
    >
      {load && !demo && <img src={src} srcSet={publicSlug ? undefined : `/img/thumb/${photo.storageKey} 400w, /img/preview/${photo.storageKey} 1600w`} sizes="(max-width: 700px) 50vw, 25vw" alt={photo.caption || photo.filename} loading={index < 12 ? 'eager' : 'lazy'} fetchPriority={index < 12 ? 'high' : 'auto'} decoding="async" onLoad={(event) => void event.currentTarget.decode().catch(() => undefined).finally(() => setReady(true))} onError={() => setReady(true)} />}
    </div>
  );
}
