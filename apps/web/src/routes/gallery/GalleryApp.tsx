import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { OTPInput, REGEXP_ONLY_DIGITS } from 'input-otp';
import { ArrowDown, ArrowLeft, Download, Images, LockKeyhole, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import type { Photo } from '../../types';
import { PhotoImage } from '../../components/PhotoImage';

export default function GalleryApp() {
  const { slug = '' } = useParams({ strict: false }) as { slug?: string };
  return <CustomerGallery key={slug} slug={slug} />;
}

function CustomerGallery({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const teaser = useQuery({
    queryKey: ['gallery-teaser', slug],
    queryFn: () => api.teaser(slug),
    retry: false,
    refetchOnWindowFocus: true,
  });

  async function unlock(value = pin) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.unlock(slug, value);
      await teaser.refetch();
      await navigate({ to: '/gallery/$slug/view', params: { slug } });
    } catch (caught) {
      setPin('');
      setError(caught instanceof Error ? caught.message : 'Could not open the gallery.');
    } finally {
      setBusy(false);
    }
  }
  async function lock() {
    try {
      await api.lock(slug);
      setLightbox(null);
      await teaser.refetch();
      await navigate({ to: '/gallery/$slug', params: { slug } });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not lock the gallery.');
    }
  }
  if (teaser.isPending)
    return (
      <main className="expired-page" role="status">
        Loading private gallery…
      </main>
    );
  if (teaser.isError) return <GalleryExpired message={teaser.error.message} />;
  if (!teaser.data.unlocked)
    return (
      <PinGate
        title={teaser.data.title}
        count={teaser.data.photoCount}
        pin={pin}
        busy={busy}
        error={error}
        onChange={setPin}
        onSubmit={() => void unlock()}
      />
    );
  return (
    <GalleryView
      slug={slug}
      title={teaser.data.title}
      count={teaser.data.photoCount}
      allowDownload={teaser.data.allowDownload}
      lightbox={lightbox}
      setLightbox={setLightbox}
      onLock={() => void lock()}
      onSessionEnded={() => void teaser.refetch()}
    />
  );
}

function PinGate({
  title,
  count,
  pin,
  busy,
  error,
  onChange,
  onSubmit,
}: {
  title: string;
  count: number;
  pin: string;
  busy: boolean;
  error: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main className="pin-page">
      <div className="pin-photo pin-photo-main" />
      <div className="pin-photo pin-photo-detail" />
      <section className="pin-card">
        <div className="gallery-mark">
          <span>A</span>
          <i /> <span>G</span>
        </div>
        <p className="private-label">
          <LockKeyhole />
          Private collection
        </p>
        <h1>{title}</h1>
        <p className="gallery-subtitle">A story in {count} photographs</p>
        <form
          className="pin-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label htmlFor="gallery-pin">Enter the six-digit PIN from your photographer</label>
          <OTPInput
            id="gallery-pin"
            maxLength={6}
            value={pin}
            onChange={onChange}
            inputMode="numeric"
            pattern={REGEXP_ONLY_DIGITS}
            autoFocus
            disabled={busy}
            containerClassName="otp-group"
            render={({ slots }) => (
              <>
                {slots.map((slot, index) => (
                  <div key={index} data-input-otp-slot data-active={slot.isActive || undefined}>
                    {slot.char}
                    {slot.hasFakeCaret && <span className="fake-caret" />}
                  </div>
                ))}
              </>
            )}
          />
          {error && (
            <p className="pin-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || pin.length !== 6}>
            {busy ? 'Opening…' : 'Enter gallery'}
            <ArrowDown />
          </button>
        </form>
        <p className="pin-help">
          This gallery is private. Your PIN is never shared or stored in this browser.
        </p>
      </section>
      <footer className="gallery-credit">Photographed with care · Delivered by Arc & Grain</footer>
    </main>
  );
}

function GalleryView({
  slug,
  title,
  count,
  allowDownload,
  lightbox,
  setLightbox,
  onLock,
  onSessionEnded,
}: {
  slug: string;
  title: string;
  count: number;
  allowDownload: boolean;
  lightbox: Photo | null;
  setLightbox: (photo: Photo | null) => void;
  onLock: () => void;
  onSessionEnded: () => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ['public-gallery', slug],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.galleryPhotos(slug, pageParam),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const photos = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  useEffect(() => {
    if (query.error instanceof ApiError && [401, 404, 410].includes(query.error.status)) onSessionEnded();
  }, [query.error]);
  const base = `/api/v1/public/galleries/${encodeURIComponent(slug)}`;
  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <div className="gallery-mark">
          <span>A</span>
          <i />
          <span>G</span>
        </div>
        <div>
          <p>Your private collection</p>
          <h1>{title}</h1>
        </div>
        <div className="gallery-actions">
          <span>{count} photographs</span>
          {allowDownload && (
            <a href={`${base}/download-all`}>
              <Download />
              Download all
            </a>
          )}
        </div>
      </header>
      <section className="gallery-intro">
        <div className="intro-number">01</div>
        <blockquote>Selected moments, shared with you.</blockquote>
        <p>Photographs curated by your event team.</p>
      </section>
      {query.isError && (
        <p role="alert">
          {query.error.message} <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      )}
      <section className="masonry" aria-label="Photo gallery">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            className={`masonry-item item-${index % 7}`}
            onClick={() => setLightbox(photo)}
          >
            <PhotoImage photo={photo} index={index} publicSlug={slug} />
            <span>{photo.caption}</span>
          </button>
        ))}
      </section>
      {query.hasNextPage && (
        <button
          className="gallery-more"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          <Images />
          Show more photographs
        </button>
      )}
      <footer className="gallery-footer">
        <div className="gallery-mark">
          <span>A</span>
          <i />
          <span>G</span>
        </div>
        <p>{title}</p>
        <button onClick={onLock}>
          <LockKeyhole />
          Lock gallery
        </button>
      </footer>
      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.caption ?? lightbox.filename}
        >
          <button className="lightbox-close" aria-label="Close photograph" onClick={() => setLightbox(null)}>
            <X />
          </button>
          <button className="lightbox-back" onClick={() => setLightbox(null)}>
            <ArrowLeft />
            Back to gallery
          </button>
          <PhotoImage photo={lightbox} publicSlug={slug} variant="preview" />
          <div className="lightbox-caption">
            <span>{lightbox.caption || lightbox.filename}</span>
            {allowDownload && (
              <a href={`${base}/photos/${lightbox.id}/image/full?download=1`}>
                <Download />
                Original
              </a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function GalleryExpired({ message }: { message: string }) {
  return (
    <main className="expired-page">
      <div className="gallery-mark">
        <span>A</span>
        <i />
        <span>G</span>
      </div>
      <LockKeyhole />
      <h1>Gallery unavailable</h1>
      <p role="alert">{message}</p>
      <p>Ask your photographer for the current link and PIN.</p>
    </main>
  );
}
