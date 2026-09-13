import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../types';

const observers = new Map<string, IntersectionObserver>();
const callbacks = new WeakMap<Element, () => void>();

function observe(element: Element, rootMargin: string, onEnter: () => void) {
  let observer = observers.get(rootMargin);
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          callbacks.get(entry.target)?.();
          observer!.unobserve(entry.target);
          callbacks.delete(entry.target);
        });
      },
      { rootMargin },
    );
    observers.set(rootMargin, observer);
  }
  callbacks.set(element, onEnter);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    callbacks.delete(element);
  };
}

export function PhotoImage({
  photo,
  index = 0,
  demo = false,
  publicSlug,
  variant = 'thumb',
  aspectRatio,
}: {
  photo: Photo;
  index?: number;
  demo?: boolean;
  publicSlug?: string;
  variant?: 'thumb' | 'preview';
  aspectRatio?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState(index < 12);
  const [imageState, setImageState] = useState<{ src: string; status: 'ready' | 'error' }>();
  useEffect(() => {
    if (load || !holder.current) return;
    return observe(holder.current, '400px 0px', () => setLoad(true));
  }, [load]);

  const col = index % 3;
  const row = Math.floor(index / 3) % 2;
  const storagePath = photo.storageKey.split('/').map(encodeURIComponent).join('/');
  const src = demo
    ? '/assets/wedding-contact-sheet.png'
    : publicSlug
      ? `/api/v1/public/galleries/${publicSlug}/photos/${photo.id}/image/${variant}`
      : `/img/${variant}/${storagePath}`;
  const ready = imageState?.src === src && imageState.status === 'ready';
  const failed = imageState?.src === src && imageState.status === 'error';
  return (
    <div
      ref={holder}
      className={`photo-image ${ready ? 'is-ready' : ''} ${demo ? 'demo-crop' : ''}`}
      style={{
        aspectRatio: aspectRatio ?? (photo.width && photo.height ? `${photo.width}/${photo.height}` : '3/2'),
        backgroundColor: photo.dominantColor ?? '#20252c',
        ...(demo
          ? {
              backgroundImage: `url(${src})`,
              backgroundSize: '300% 200%',
              backgroundPosition: `${col * 50}% ${row * 100}%`,
            }
          : {}),
      }}
    >
      {load && !demo && !failed && (
        <img
          src={src}
          srcSet={
            publicSlug || variant === 'preview'
              ? undefined
              : `/img/thumb/${storagePath} 480w, /img/preview/${storagePath} 1600w`
          }
          sizes="(max-width: 700px) 50vw, 25vw"
          alt={photo.caption || photo.filename}
          loading={index < 12 ? 'eager' : 'lazy'}
          fetchPriority={index < 12 ? 'high' : 'auto'}
          decoding="async"
          onLoad={(event) =>
            void event.currentTarget
              .decode()
              .then(() => setImageState({ src, status: 'ready' }))
              .catch(() => setImageState({ src, status: 'error' }))
          }
          onError={() => setImageState({ src, status: 'error' })}
        />
      )}
      {failed && (
        <span className="photo-image-error" role="img" aria-label={`Image unavailable: ${photo.filename}`}>
          Image unavailable
        </span>
      )}
    </div>
  );
}
