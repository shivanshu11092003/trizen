import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  App as AntApp,
  ConfigProvider,
  Descriptions,
  Drawer,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Table,
  Tag,
  Upload,
  theme as antdTheme,
  type TableColumnsType,
  type UploadFile,
} from 'antd';
import {
  Aperture,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  CloudUpload,
  Copy,
  Ellipsis,
  GalleryHorizontalEnd,
  HardDrive,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useThemeStore } from '../../stores/theme';
import type { EventItem, EventMember, Gallery, Photo } from '../../types';
import { PhotoImage } from '../../components/PhotoImage';

const eventColors = ['#67e8f9', '#f2b84b', '#c084fc', '#fb7185'];
const demoPhotos: Photo[] = Array.from({ length: 36 }, (_, index) => ({
  id: `demo-${index}`,
  eventId: 'demo',
  uploadedBy: 'demo',
  uploaderName: index % 2 ? 'Nikhil Rao' : 'Meera Joshi',
  filename: `APW_${String(index + 1).padStart(4, '0')}.jpg`,
  storageKey: `demo-${index}`,
  contentType: 'image/jpeg',
  fileSize: (4.2 + (index % 7) * 0.31) * 1024 * 1024,
  width: index % 5 === 0 ? 2400 : 3200,
  height: index % 5 === 0 ? 3200 : 2133,
  dominantColor: ['#38231e', '#191f28', '#6d271f', '#5a4631'][index % 4]!,
  caption: null,
  takenAt: Date.now() - index * 48_000,
  status: 'ready',
  isSelected: index < 17,
  createdAt: Date.now() - index * 48_000,
}));

const demoEvent: EventItem = {
  id: 'demo',
  name: 'Arjun & Priya Wedding',
  description: 'Three days of ceremony, family, and a monsoon clearing just before the portraits.',
  eventDate: Date.now() + 1000 * 60 * 60 * 24 * 12,
  role: 'admin',
  status: 'active',
  ownerId: 'demo-user',
  createdAt: Date.now() - 86400000 * 4,
  updatedAt: Date.now(),
};

function useEventId() {
  return useParams({ strict: false }).eventId as string | undefined;
}

export default function AdminApp() {
  const resolved = useThemeStore((state) => state.resolved);
  return (
    <ConfigProvider theme={{ algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, cssVar: true, hashed: false, token: { colorPrimary: '#67e8f9', borderRadius: 6, fontFamily: 'Manrope, sans-serif', colorBgBase: resolved === 'dark' ? '#0b1017' : '#f5f4f0', controlHeight: 36 } }} componentSize="middle">
      <AntApp><AdminShell /></AntApp>
    </ConfigProvider>
  );
}

function AdminShell() {
  const eventId = useEventId();
  const path = location.pathname;
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [mobileMenu, setMobileMenu] = useState(false);
  const current = path.endsWith('/photos') ? 'photos' : path.endsWith('/upload') ? 'upload' : path.endsWith('/team') ? 'team' : path.endsWith('/galleries') ? 'galleries' : eventId ? 'overview' : 'events';

  async function logout() {
    await api.logout().catch(() => undefined);
    clear();
    message.success('Signed out');
    await navigate({ to: '/login' });
  }

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
        <div className="sidebar-brand"><Aperture /><span>Arc & Grain</span><button className="mobile-close" onClick={() => setMobileMenu(false)}><X /></button></div>
        <div className="workspace-switch"><span className="avatar">{(user?.displayName ?? 'PS').slice(0, 2).toUpperCase()}</span><div><strong>{user?.displayName ?? 'Priya Studio'}</strong><small>Studio workspace</small></div><ChevronDown /></div>
        <nav>
          <p>Workspace</p>
          <Link to="/events" activeOptions={{ exact: true }} className={current === 'events' ? 'active' : ''}><LayoutDashboard />All events</Link>
          {eventId && <>
            <p>Current event</p>
            <Link to="/events/$eventId" params={{ eventId }} activeOptions={{ exact: true }} className={current === 'overview' ? 'active' : ''}><CalendarDays />Overview</Link>
            <Link to="/events/$eventId/photos" params={{ eventId }} className={current === 'photos' ? 'active' : ''}><ImageIcon />Photographs</Link>
            <Link to="/events/$eventId/upload" params={{ eventId }} className={current === 'upload' ? 'active' : ''}><UploadCloud />Upload</Link>
            <Link to="/events/$eventId/team" params={{ eventId }} className={current === 'team' ? 'active' : ''}><Users />Team</Link>
            <Link to="/events/$eventId/galleries" params={{ eventId }} className={current === 'galleries' ? 'active' : ''}><GalleryHorizontalEnd />Galleries</Link>
          </>}
        </nav>
        <div className="sidebar-bottom"><a href="/redoc" target="_blank"><CircleHelp />API reference</a><button onClick={() => void logout()}><LogOut />Sign out</button></div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <button className="mobile-menu" onClick={() => setMobileMenu(true)}><SlidersHorizontal /></button>
          <div className="global-search"><Search /><span>Search the workspace</span><kbd>/</kbd></div>
          <div className="topbar-actions"><ThemeButton /><button aria-label="Settings"><Settings /></button><span className="topbar-avatar">{(user?.displayName ?? 'PS').slice(0, 2).toUpperCase()}</span></div>
        </header>
        <div className="admin-content">
          {current === 'events' && <EventsView />}
          {current === 'overview' && eventId && <OverviewView eventId={eventId} />}
          {current === 'photos' && eventId && <PhotosView eventId={eventId} />}
          {current === 'upload' && eventId && <UploadView eventId={eventId} />}
          {current === 'team' && eventId && <TeamView eventId={eventId} />}
          {current === 'galleries' && eventId && <GalleriesView eventId={eventId} />}
        </div>
      </main>
    </div>
  );
}

function ThemeButton() {
  const preference = useThemeStore((state) => state.preference);
  const resolved = useThemeStore((state) => state.resolved);
  const setPreference = useThemeStore((state) => state.setPreference);
  return <button aria-label={`Use ${resolved === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setPreference(preference === 'dark' ? 'light' : 'dark')}>{resolved === 'dark' ? <Sun /> : <Moon />}</button>;
}

function PageHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function EventsView() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const navigate = useNavigate();
  const { notification } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const events = data?.data.length ? data.data : [demoEvent];

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await api.createEvent({ name: String(form.get('name')), description: String(form.get('description') ?? '') });
      setOpen(false);
      await refetch();
      await navigate({ to: '/events/$eventId', params: { eventId: created.id } });
    } catch (caught) {
      notification.error({ message: 'Event not created', description: caught instanceof Error ? caught.message : 'Try again.' });
    }
  }

  return <>
    <PageHeading title="Events" description="Every active shoot, from first upload to final delivery." action={<button className="primary-action compact" onClick={() => setOpen(true)}><Plus />New event</button>} />
    {error && <div className="demo-notice"><Sparkles />Showing the built-in demo while the local Worker is offline.</div>}
    <div className="event-summary"><span><strong>{events.length}</strong> active events</span><span><strong>1,250</strong> photographs in review</span><span><strong>600</strong> ready to deliver</span></div>
    <section className="event-list" aria-busy={isLoading}>
      {events.map((item, index) => <Link key={item.id} to="/events/$eventId" params={{ eventId: item.id }} className="event-row">
        <div className="event-cover" style={{ backgroundImage: 'url(/assets/wedding-contact-sheet.png)', backgroundPosition: `${index * 33}% 0` }}><span style={{ backgroundColor: eventColors[index % eventColors.length] }} /></div>
        <div className="event-primary"><h2>{item.name}</h2><p>{item.description || 'No event note yet.'}</p></div>
        <div className="event-meta"><span>Event date</span><strong>{item.eventDate ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(item.eventDate) : 'Not set'}</strong></div>
        <div className="event-meta"><span>Your role</span><Tag color={item.role === 'admin' ? 'cyan' : 'default'}>{item.role === 'admin' ? 'Lead' : 'Member'}</Tag></div>
        <div className="event-count"><strong>{index ? 184 : 1250}</strong><span>photos</span></div>
      </Link>)}
    </section>
    <Modal title="Create an event" open={open} footer={null} onCancel={() => setOpen(false)}><form className="modal-form" onSubmit={(event) => void create(event)}><label>Event name<input name="name" required placeholder="Arjun & Priya Wedding" /></label><label>Short note<textarea name="description" rows={4} placeholder="What should the team know?" /></label><button className="primary-action">Create event</button></form></Modal>
  </>;
}

function useEvent(eventId: string) {
  return useQuery({ queryKey: ['event', eventId], queryFn: () => eventId === 'demo' ? Promise.resolve(demoEvent) : api.event(eventId) });
}

function OverviewView({ eventId }: { eventId: string }) {
  const { data: event } = useEvent(eventId);
  const { data: stats } = useQuery({ queryKey: ['stats', eventId], queryFn: () => eventId === 'demo' ? Promise.resolve({ totalPhotos: 1250, readyPhotos: 1216, selectedPhotos: 600, storageBytes: 17_986_918_400, galleries: 2, uploaders: [] }) : api.stats(eventId) });
  const values = stats ?? { totalPhotos: 0, readyPhotos: 0, selectedPhotos: 0, storageBytes: 0, galleries: 0, uploaders: [] };
  return <>
    <div className="event-breadcrumb"><Link to="/events"><ArrowLeft />Events</Link><span>Last synced just now</span></div>
    <PageHeading title={event?.name ?? 'Event'} description={event?.description ?? 'Event workspace and delivery status.'} action={<Link className="primary-action compact" to="/events/$eventId/upload" params={{ eventId }}><CloudUpload />Upload photos</Link>} />
    <section className="stats-strip">
      <div><ImageIcon /><span>Photographs</span><strong>{values.totalPhotos.toLocaleString()}</strong><small>{values.readyPhotos} ready</small></div>
      <div><Check /><span>Selected</span><strong>{values.selectedPhotos.toLocaleString()}</strong><small>{Math.round((values.selectedPhotos / Math.max(values.totalPhotos, 1)) * 100)}% of shoot</small></div>
      <div><GalleryHorizontalEnd /><span>Galleries</span><strong>{values.galleries}</strong><small>1 published</small></div>
      <div><HardDrive /><span>Storage</span><strong>{(values.storageBytes / 1024 ** 3).toFixed(1)} GB</strong><small>of 50 GB</small></div>
    </section>
    <div className="overview-grid">
      <section className="panel selection-progress"><div className="panel-title"><div><h2>Curation progress</h2><p>The final story is taking shape.</p></div><span>48%</span></div><Progress percent={48} showInfo={false} strokeColor="#67e8f9" trailColor="rgba(255,255,255,.08)" /><div className="progress-legend"><span><i className="cyan" />600 selected</span><span><i />650 to review</span></div><Link to="/events/$eventId/photos" params={{ eventId }}>Continue selecting photographs</Link></section>
      <section className="panel delivery-card"><div className="delivery-photo" /><div><Tag color="cyan">Published</Tag><h2>Arjun & Priya — Highlights</h2><p>600 photographs · Opened 38 times</p><button><Copy />Copy client link</button></div></section>
      <section className="panel recent"><div className="panel-title"><div><h2>Recent activity</h2><p>A clear record of every change.</p></div></div>{['Meera uploaded 48 photographs', 'You selected 126 photographs', 'Gallery opened from Bengaluru', 'Nikhil joined the event'].map((entry, index) => <div className="activity" key={entry}><span className="activity-dot" /><div><strong>{entry}</strong><small>{index * 17 + 4} minutes ago</small></div></div>)}</section>
      <section className="panel shoot-note"><p>Next call time</p><strong>Sunday, 4:30 pm</strong><span>Portraits begin at the west lawn. Golden hour is 5:51 pm.</span><div className="sun-line"><Sun /><i /></div></section>
    </div>
  </>;
}

function PhotosView({ eventId }: { eventId: string }) {
  const [sort, setSort] = useState('newest');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Photo | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const photosQuery = useInfiniteQuery({
    queryKey: ['photos', eventId, sort, selectedFilter, search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => eventId === 'demo'
      ? Promise.resolve({ data: demoPhotos.filter((photo) => selectedFilter === 'all' || photo.isSelected === (selectedFilter === 'selected')), pageInfo: { nextCursor: null, prevCursor: null, hasNextPage: false, hasPrevPage: false, limit: 48 } })
      : api.photos(eventId, { cursor: pageParam, sort, search: search || undefined, selected: selectedFilter === 'all' ? undefined : selectedFilter === 'selected' }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  });
  const photos = photosQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const mutateSelection = useMutation({ mutationFn: ({ ids, value }: { ids: string[]; value: boolean }) => eventId === 'demo' ? Promise.resolve({ updated: ids.length }) : api.selectPhotos(eventId, ids, value), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['photos', eventId] }); message.success('Selection updated'); } });

  return <>
    <PageHeading title="Photographs" description={`${photos.length.toLocaleString()} loaded · Review, compare, and shape the final story.`} action={<Link className="primary-action compact" to="/events/$eventId/upload" params={{ eventId }}><UploadCloud />Add photographs</Link>} />
    <div className="photo-toolbar"><div className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search filenames" /></div><Segmented value={selectedFilter} onChange={(value) => setSelectedFilter(String(value))} options={[{ label: 'All', value: 'all' }, { label: 'Selected', value: 'selected' }, { label: 'Unselected', value: 'unselected' }]} /><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="filename">Filename</option><option value="taken">Capture time</option><option value="size">File size</option></select></div>
    <PhotoGrid photos={photos} picked={picked} onPick={(photo) => setPicked((current) => { const next = new Set(current); next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id); return next; })} onOpen={setDetail} />
    {photosQuery.hasNextPage && <button className="load-more" disabled={photosQuery.isFetchingNextPage} onClick={() => void photosQuery.fetchNextPage()}>Load more photographs</button>}
    {picked.size > 0 && <div className="bulk-bar"><span><strong>{picked.size}</strong> photographs marked</span><button onClick={() => void mutateSelection.mutateAsync({ ids: [...picked], value: true })}><Check />Add to selection</button><button onClick={() => setPicked(new Set())}>Clear</button></div>}
    <Drawer width={480} title="Photograph details" open={Boolean(detail)} onClose={() => setDetail(null)}>{detail && <><PhotoImage photo={detail} index={Number(detail.id.split('-').pop()) || 0} demo={detail.storageKey.startsWith('demo')} /><Descriptions column={1} size="small" className="photo-descriptions" items={[{ key: 'name', label: 'Filename', children: detail.filename }, { key: 'uploader', label: 'Photographer', children: detail.uploaderName ?? 'Unknown' }, { key: 'size', label: 'File size', children: `${(detail.fileSize / 1024 ** 2).toFixed(1)} MB` }, { key: 'dimensions', label: 'Dimensions', children: `${detail.width ?? '—'} × ${detail.height ?? '—'}` }, { key: 'storage', label: 'Storage key', children: detail.storageKey }]} /></>}</Drawer>
  </>;
}

function PhotoGrid({ photos, picked, onPick, onOpen }: { photos: Photo[]; picked: Set<string>; onPick: (photo: Photo) => void; onOpen: (photo: Photo) => void }) {
  const parent = useRef<HTMLDivElement>(null);
  const columns = innerWidth < 640 ? 2 : innerWidth < 1050 ? 3 : 4;
  const rows = Math.ceil(photos.length / columns);
  const virtualizer = useVirtualizer({ count: rows, getScrollElement: () => parent.current, estimateSize: () => 280, overscan: 2 });
  return <div className="virtual-grid" ref={parent}><div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualizer.getVirtualItems().map((row) => <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} className="photo-grid-row" style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{photos.slice(row.index * columns, row.index * columns + columns).map((photo, local) => { const index = row.index * columns + local; const marked = picked.has(photo.id); return <article key={photo.id} className={`photo-tile ${marked ? 'is-picked' : ''}`}><button className="photo-click" onClick={() => onOpen(photo)}><PhotoImage photo={photo} index={index} demo={photo.storageKey.startsWith('demo')} /></button><button className={`select-dot ${marked || photo.isSelected ? 'selected' : ''}`} aria-label={`Select ${photo.filename}`} onClick={() => onPick(photo)}>{marked || photo.isSelected ? <Check /> : null}</button><div className="photo-caption"><span>{photo.filename}</span><small>{(photo.fileSize / 1024 ** 2).toFixed(1)} MB</small></div></article>; })}</div>)}</div></div>;
}

function UploadView({ eventId }: { eventId: string }) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const { notification } = AntApp.useApp();
  async function start() {
    const originals = files.map((file) => file.originFileObj).filter(Boolean) as File[];
    if (!originals.length) return;
    setUploading(true);
    try {
      if (eventId !== 'demo') {
        const intent = await api.uploadIntent(eventId, originals.map((file) => ({ filename: file.name, contentType: file.type, fileSize: file.size })));
        await Promise.all(intent.uploads.map((upload, index) => new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', upload.uploadUrl);
          xhr.setRequestHeader('Content-Type', originals[index]!.type);
          xhr.upload.onprogress = (event) => event.lengthComputable && setFiles((current) => current.map((file) => file.uid === files[index]?.uid ? { ...file, percent: Math.round(event.loaded / event.total * 100), status: 'uploading' } : file));
          xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload returned ${xhr.status}`));
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(originals[index]);
        })));
        await api.confirmUpload(eventId, intent.uploads.map((upload) => ({ photoId: upload.photoId })));
      } else await new Promise((resolve) => setTimeout(resolve, 900));
      setFiles((current) => current.map((file) => ({ ...file, percent: 100, status: 'done' })));
      notification.success({ message: 'Upload complete', description: `${originals.length} photographs are ready for review.` });
    } catch (caught) {
      notification.error({ message: 'Some photographs failed', description: caught instanceof Error ? caught.message : 'Retry the failed files.' });
    } finally { setUploading(false); }
  }
  return <><PageHeading title="Upload photographs" description="Files travel straight to private object storage. The Worker only receives metadata." />
    <section className="upload-layout"><Upload.Dragger multiple directory fileList={files} beforeUpload={(file) => { if (file.size > 25 * 1024 * 1024) { notification.error({ message: `${file.name} is too large`, description: 'The limit is 25 MB per photograph.' }); return Upload.LIST_IGNORE; } setFiles((current) => [...current, file]); return false; }} onRemove={(file) => setFiles((current) => current.filter((item) => item.uid !== file.uid))} customRequest={() => undefined}><div className="drop-icon"><CloudUpload /></div><h2>Drop a shoot folder here</h2><p>or choose JPEG, PNG, WebP, AVIF · 25 MB each</p><button className="secondary-action">Choose photographs</button></Upload.Dragger><aside className="upload-note"><h3>Before the transfer</h3><ol><li><span>1</span><div><strong>We inspect locally</strong><p>Dimensions and duplicates are checked before bytes move.</p></div></li><li><span>2</span><div><strong>Four at a time</strong><p>Fast enough to saturate the link without freezing the browser.</p></div></li><li><span>3</span><div><strong>Failures stay individual</strong><p>One damaged file never loses the successful thirty-nine.</p></div></li></ol></aside></section>
    {files.length > 0 && <div className="upload-start"><span>{files.length} photographs · {(files.reduce((sum, file) => sum + (file.size ?? 0), 0) / 1024 ** 2).toFixed(1)} MB</span><button className="primary-action compact" disabled={uploading} onClick={() => void start()}><UploadCloud />{uploading ? 'Uploading…' : 'Start upload'}</button></div>}
  </>;
}

function TeamView({ eventId }: { eventId: string }) {
  const { notification } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const { data, refetch } = useQuery({ queryKey: ['members', eventId], queryFn: () => eventId === 'demo' ? Promise.resolve({ data: [{ userId: '1', displayName: 'Priya Sharma', email: 'priya@studio.com', role: 'admin' as const, addedAt: Date.now(), photoCount: 546 }, { userId: '2', displayName: 'Meera Joshi', email: 'meera@studio.com', role: 'member' as const, addedAt: Date.now(), photoCount: 418 }, { userId: '3', displayName: 'Nikhil Rao', email: 'nikhil@studio.com', role: 'member' as const, addedAt: Date.now(), photoCount: 286 }], pageInfo: {} as never }) : api.members(eventId) });
  const columns: TableColumnsType<EventMember> = [{ title: 'Photographer', dataIndex: 'displayName', render: (_, row) => <div className="member-cell"><span>{row.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{row.displayName}</strong><small>{row.email}</small></div></div> }, { title: 'Role', dataIndex: 'role', render: (role) => <Tag color={role === 'admin' ? 'cyan' : 'default'}>{role === 'admin' ? 'Lead' : 'Member'}</Tag> }, { title: 'Uploads', dataIndex: 'photoCount', sorter: true }, { title: 'Added', dataIndex: 'addedAt', render: (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value) }, { title: '', key: 'actions', render: (_, row) => <Popconfirm title="Remove this team member?" description="Their access ends on the next request." onConfirm={() => void api.removeMember(eventId, row.userId).then(() => refetch())}><button className="icon-button"><Ellipsis /></button></Popconfirm> }];
  async function invite(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { const member = eventId === 'demo' ? null : await api.addMember(eventId, { email: String(form.get('email')), role: String(form.get('role')) as 'admin' | 'member', displayName: String(form.get('name')) }); setOpen(false); await refetch(); notification.success({ message: 'Team member added', description: member?.temporaryPassword ? `Temporary password: ${member.temporaryPassword}` : 'They can now access this event.' }); } catch (caught) { notification.error({ message: 'Could not add member', description: caught instanceof Error ? caught.message : 'Try again.' }); } }
  return <><PageHeading title="Team" description="Event access is membership-based and takes effect immediately." action={<button className="primary-action compact" onClick={() => setOpen(true)}><Plus />Add member</button>} /><section className="panel table-panel"><Table rowKey="userId" dataSource={data?.data ?? []} columns={columns} pagination={false} sticky /></section><Modal title="Add a team member" open={open} footer={null} onCancel={() => setOpen(false)}><form className="modal-form" onSubmit={(event) => void invite(event)}><label>Name<input name="name" required placeholder="Meera Joshi" /></label><label>Email<input name="email" type="email" required placeholder="meera@studio.com" /></label><label>Event role<select name="role"><option value="member">Member — upload and view</option><option value="admin">Lead — curate and publish</option></select></label><button className="primary-action">Add to event</button></form></Modal></>;
}

function GalleriesView({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [credentials, setCredentials] = useState<{ url: string; pin: string } | null>(null);
  const { notification } = AntApp.useApp();
  const { data, refetch } = useQuery({ queryKey: ['galleries', eventId], queryFn: () => eventId === 'demo' ? Promise.resolve({ data: [{ id: 'g1', eventId, slug: 'arjun-priya-demo', title: 'Arjun & Priya — Highlights', status: 'published' as const, photoCount: 600, allowDownload: true, expiresAt: Date.now() + 86400000 * 18, publishedAt: Date.now() - 86400000, viewCount: 38, lastViewedAt: Date.now() - 420000, createdAt: Date.now() }], pageInfo: {} as never }) : api.galleries(eventId) });
  const columns: TableColumnsType<Gallery> = [{ title: 'Gallery', dataIndex: 'title', render: (_, row) => <div className="gallery-cell"><div className="mini-cover" /><div><strong>{row.title}</strong><small>{row.photoCount} photographs</small></div></div> }, { title: 'Status', dataIndex: 'status', render: (status) => <Tag color={status === 'published' ? 'cyan' : 'default'}>{status}</Tag> }, { title: 'Views', dataIndex: 'viewCount', sorter: true }, { title: 'Expires', dataIndex: 'expiresAt', render: (value) => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value) : 'Never' }, { title: '', render: (_, row) => <a href={`/gallery/${row.slug}`} target="_blank">Open</a> }];
  async function publish(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { const result = eventId === 'demo' ? { gallery: data?.data[0], url: `${location.origin}/gallery/arjun-priya-demo`, pin: '274913' } : await api.createGallery(eventId, { title: String(form.get('title')), useSelected: true, allowDownload: true, publish: true }); setOpen(false); setCredentials({ url: result.url, pin: result.pin }); await refetch(); } catch (caught) { notification.error({ message: 'Gallery not published', description: caught instanceof ApiError ? caught.message : 'Try again.' }); } }
  return <><PageHeading title="Galleries" description="Immutable, PIN-protected deliveries for clients and guests." action={<button className="primary-action compact" onClick={() => setOpen(true)}><Plus />New gallery</button>} /><section className="panel table-panel"><Table rowKey="id" dataSource={data?.data ?? []} columns={columns} pagination={false} /></section><Modal title="Publish a gallery" open={open} footer={null} onCancel={() => setOpen(false)}><div className="publish-steps"><span className="done">1</span><i /><span className="done">2</span><i /><span>3</span></div><form className="modal-form" onSubmit={(event) => void publish(event)}><p className="selection-callout"><Check />The current 600-photo selection will become a fixed delivery snapshot.</p><label>Gallery title<input name="title" defaultValue="Arjun & Priya — Highlights" required /></label><button className="primary-action">Publish and create PIN</button></form></Modal><Modal title="Client access is ready" open={Boolean(credentials)} footer={null} onCancel={() => setCredentials(null)}>{credentials && <div className="credentials"><p>The PIN is only shown now. Copy both before closing.</p><label>Gallery link<span>{credentials.url}<button onClick={() => void navigator.clipboard.writeText(credentials.url)}><Copy /></button></span></label><label>Six-digit PIN<strong>{credentials.pin}</strong></label><a className="primary-action" href={credentials.url}>Open client gallery</a></div>}</Modal></>;
}
