import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { OTPInput, REGEXP_ONLY_DIGITS } from 'input-otp';
import { ArrowDown, ArrowLeft, Download, Images, LockKeyhole, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import type { Photo } from '../../types';
import { PhotoImage } from '../../components/PhotoImage';

const demoPhotos: Photo[] = Array.from({ length: 30 }, (_, index) => ({
  id: `gallery-demo-${index}`,
  eventId: 'demo',
  uploadedBy: 'demo',
  filename: `Arjun-Priya-${String(index + 1).padStart(3, '0')}.jpg`,
  storageKey: `demo-${index}`,
  contentType: 'image/jpeg',
  fileSize: 4_800_000,
  width: index % 5 === 0 ? 2400 : 3200,
  height: index % 5 === 0 ? 3200 : 2133,
  dominantColor: '#241914',
  caption: ['Quiet preparations', 'Mehendi, just before noon', 'Garlands for the ceremony', 'Blue hour on the west lawn', 'The dance floor opens', 'Light for the new beginning'][index % 6]!,
  takenAt: Date.now() - index * 60000,
  status: 'ready',
  isSelected: true,
  createdAt: Date.now() - index * 60000,
}));

export default function GalleryApp() {
  const { slug = '' } = useParams({ strict: false }) as { slug?: string };
  const isDemo = slug === 'arjun-priya-demo';
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(isDemo && sessionStorage.getItem(`gallery:${slug}`) === 'open');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const teaser = useQuery({ queryKey: ['gallery-teaser', slug], queryFn: () => isDemo ? Promise.resolve({ title: 'Arjun & Priya', photoCount: 600, allowDownload: true, expiresAt: Date.now() + 18 * 86400000, unlocked }) : api.teaser(slug), retry: false });

  useEffect(() => {
    if (location.pathname.endsWith('/view') || teaser.data?.unlocked) setUnlocked(true);
  }, [teaser.data?.unlocked]);

  async function unlock(value = pin) {
    if (value.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      if (isDemo) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        if (value !== '274913') throw new ApiError(401, 'PIN_INVALID', 'That PIN doesn’t match. Try 274913 for the demo.');
        sessionStorage.setItem(`gallery:${slug}`, 'open');
      } else await api.unlock(slug, value);
      setUnlocked(true);
      await navigate({ to: '/gallery/$slug/view', params: { slug } });
    } catch (caught) {
      setPin('');
      setError(caught instanceof Error ? caught.message : 'That PIN does not match.');
    } finally { setBusy(false); }
  }

  if (teaser.isError && !isDemo) return <GalleryExpired />;
  if (!unlocked) return <PinGate title={teaser.data?.title ?? 'Private gallery'} count={teaser.data?.photoCount ?? 0} pin={pin} busy={busy} error={error} onChange={(value) => { setPin(value); if (value.length === 6) void unlock(value); }} onSubmit={() => void unlock()} />;
  return <GalleryView slug={slug} title={teaser.data?.title ?? 'Arjun & Priya'} count={teaser.data?.photoCount ?? 0} isDemo={isDemo} lightbox={lightbox} setLightbox={setLightbox} />;
}

function PinGate({ title, count, pin, busy, error, onChange, onSubmit }: { title: string; count: number; pin: string; busy: boolean; error: string; onChange: (value: string) => void; onSubmit: () => void }) {
  return <main className="pin-page">
    <div className="pin-photo pin-photo-main" />
    <div className="pin-photo pin-photo-detail" />
    <section className="pin-card">
      <div className="gallery-mark"><span>A</span><i /> <span>G</span></div>
      <p className="private-label"><LockKeyhole />Private collection</p>
      <h1>{title}</h1>
      <p className="gallery-subtitle">A story in {count || 600} photographs</p>
      <div className="pin-form">
        <label>Enter the six-digit PIN from your photographer</label>
        <OTPInput
          maxLength={6}
          value={pin}
          onChange={onChange}
          inputMode="numeric"
          pattern={REGEXP_ONLY_DIGITS}
          autoFocus
          disabled={busy}
          containerClassName="otp-group"
          render={({ slots }) => <>{slots.map((slot, index) => <div key={index} data-input-otp-slot data-active={slot.isActive || undefined}>{slot.char}{slot.hasFakeCaret && <span className="fake-caret" />}</div>)}</>}
        />
        {error && <p className="pin-error" role="alert">{error}</p>}
        <button onClick={onSubmit} disabled={busy || pin.length !== 6}>{busy ? 'Opening…' : 'Enter gallery'}<ArrowDown /></button>
      </div>
      <p className="pin-help">This gallery is private. Your PIN is never shared or stored in this browser.</p>
    </section>
    <footer className="gallery-credit">Photographed with care · Delivered by Arc & Grain</footer>
  </main>;
}

function GalleryView({ slug, title, count, isDemo, lightbox, setLightbox }: { slug: string; title: string; count: number; isDemo: boolean; lightbox: Photo | null; setLightbox: (photo: Photo | null) => void }) {
  const query = useInfiniteQuery({ queryKey: ['public-gallery', slug], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => isDemo ? Promise.resolve({ data: demoPhotos, pageInfo: { nextCursor: null, prevCursor: null, hasNextPage: false, hasPrevPage: false, limit: 48 } }) : api.galleryPhotos(slug, pageParam), getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined });
  const photos = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  return <main className="gallery-page">
    <header className="gallery-header"><div className="gallery-mark"><span>A</span><i /><span>G</span></div><div><p>The wedding of</p><h1>{title}</h1></div><div className="gallery-actions"><span>{count || photos.length} photographs</span><button onClick={() => toast.success('Your download is being prepared')}><Download />Download all</button></div></header>
    <section className="gallery-intro"><div className="intro-number">01</div><blockquote>“And suddenly, all the waiting became a day we could hold.”</blockquote><p>Bengaluru · 18 August 2026</p></section>
    <section className="masonry" aria-label="Wedding gallery">{photos.map((photo, index) => <button key={photo.id} className={`masonry-item item-${index % 7}`} onClick={() => setLightbox(photo)}><PhotoImage photo={photo} index={index} demo={isDemo} publicSlug={slug} /><span>{photo.caption}</span></button>)}</section>
    {query.hasNextPage && <button className="gallery-more" onClick={() => void query.fetchNextPage()}><Images />Show more photographs</button>}
    <footer className="gallery-footer"><div className="gallery-mark"><span>A</span><i /><span>G</span></div><p>Made private for Arjun & Priya</p><button onClick={() => { sessionStorage.removeItem(`gallery:${slug}`); location.assign(`/gallery/${slug}`); }}><LockKeyhole />Lock gallery</button></footer>
    {lightbox && <div className="lightbox" role="dialog" aria-modal="true" aria-label={lightbox.caption ?? lightbox.filename}><button className="lightbox-close" onClick={() => setLightbox(null)}><X /></button><button className="lightbox-back" onClick={() => setLightbox(null)}><ArrowLeft />Back to gallery</button><PhotoImage photo={lightbox} index={Number(lightbox.id.split('-').pop()) || 0} demo={isDemo} publicSlug={slug} /><div className="lightbox-caption"><span>{lightbox.caption}</span><button onClick={() => toast.success('Download started')}><Download />Original</button></div></div>}
  </main>;
}

function GalleryExpired() {
  return <main className="expired-page"><div className="gallery-mark"><span>A</span><i /><span>G</span></div><LockKeyhole /><h1>This gallery is no longer available.</h1><p>It may have expired or been unpublished. Ask your photographer for a fresh link.</p></main>;
}
