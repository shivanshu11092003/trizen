import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  Segmented,
  Table,
  Tag,
  theme as antdTheme,
  type TableColumnsType,
} from 'antd';
import {
  Aperture,
  ArrowLeft,
  CalendarDays,
  Check,
  CloudUpload,
  GalleryHorizontalEnd,
  HardDrive,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useThemeStore } from '../../stores/theme';
import type { EventMember, Photo } from '../../types';
import { formatBytes } from '../../lib/format';
import { PhotoImage } from '../../components/PhotoImage';
import { UploadView } from './UploadView';
import { GalleriesView } from './GalleriesView';

function useEventId() {
  return useParams({ strict: false }).eventId as string | undefined;
}

export default function AdminApp() {
  const resolved = useThemeStore((state) => state.resolved);
  return (
    <ConfigProvider
      theme={{
        algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: true,
        hashed: false,
        token: {
          colorPrimary: '#67e8f9',
          borderRadius: 6,
          fontFamily: 'Manrope, sans-serif',
          colorBgBase: resolved === 'dark' ? '#0b1017' : '#f5f4f0',
          controlHeight: 36,
        },
      }}
      componentSize="middle"
    >
      <AntApp>
        <AdminShell />
      </AntApp>
    </ConfigProvider>
  );
}

function AdminShell() {
  const eventId = useEventId();
  const path = location.pathname;
  const eventQuery = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.event(eventId!),
    enabled: Boolean(eventId),
    retry: false,
  });
  const isLead = eventQuery.data?.role === 'admin';
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [mobileMenu, setMobileMenu] = useState(false);
  const current = path.endsWith('/photos')
    ? 'photos'
    : path.endsWith('/upload')
      ? 'upload'
      : path.endsWith('/team')
        ? 'team'
        : path.endsWith('/galleries')
          ? 'galleries'
          : eventId
            ? 'overview'
            : 'events';

  useEffect(() => setMobileMenu(false), [path]);
  async function logout() {
    try {
      await api.logout();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        message.error('Could not sign out. Please try again.');
        return;
      }
    }
    queryClient.clear();
    clear();
    message.success('Signed out');
    await navigate({ to: '/login' });
  }

  return (
    <div className="admin-shell">
      <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <Aperture />
          <span>Arc & Grain</span>
          <button aria-label="Close navigation" className="mobile-close" onClick={() => setMobileMenu(false)}>
            <X />
          </button>
        </div>
        <div className="workspace-identity">
          <span className="avatar">{(user?.displayName ?? 'PS').slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{user?.displayName ?? 'Priya Studio'}</strong>
            <small>Studio workspace</small>
          </div>
        </div>
        <nav aria-label="Workspace navigation">
          <p>Workspace</p>
          <Link to="/events" activeOptions={{ exact: true }} className={current === 'events' ? 'active' : ''}>
            <LayoutDashboard />
            All events
          </Link>
          {eventId && (
            <>
              <p>Current event</p>
              <Link
                to="/events/$eventId"
                params={{ eventId }}
                activeOptions={{ exact: true }}
                className={current === 'overview' ? 'active' : ''}
              >
                <CalendarDays />
                Overview
              </Link>
              <Link
                to="/events/$eventId/photos"
                params={{ eventId }}
                className={current === 'photos' ? 'active' : ''}
              >
                <ImageIcon />
                Photographs
              </Link>
              <Link
                to="/events/$eventId/upload"
                params={{ eventId }}
                className={current === 'upload' ? 'active' : ''}
              >
                <UploadCloud />
                Upload
              </Link>
              {isLead && (
                <Link
                  to="/events/$eventId/team"
                  params={{ eventId }}
                  className={current === 'team' ? 'active' : ''}
                >
                  <Users />
                  Team
                </Link>
              )}
              {isLead && (
                <Link
                  to="/events/$eventId/galleries"
                  params={{ eventId }}
                  className={current === 'galleries' ? 'active' : ''}
                >
                  <GalleryHorizontalEnd />
                  Galleries
                </Link>
              )}
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => void logout()}>
            <LogOut />
            Sign out
          </button>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="sidebar-backdrop"
          aria-label="Dismiss navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <main className="admin-main">
        <header className="admin-topbar">
          <button
            aria-label="Open navigation"
            aria-expanded={mobileMenu}
            className="mobile-menu"
            onClick={() => setMobileMenu(true)}
          >
            <SlidersHorizontal />
          </button>
          <span className="topbar-title">{eventQuery.data?.name ?? 'Your workspace'}</span>
          <div className="topbar-actions">
            <ThemeButton />
            <span className="topbar-avatar">{(user?.displayName ?? 'PS').slice(0, 2).toUpperCase()}</span>
          </div>
        </header>
        <div className="admin-content">
          {eventId && eventQuery.isPending ? (
            <p role="status">Loading event…</p>
          ) : eventQuery.isError ? (
            <p role="alert">{eventQuery.error.message}</p>
          ) : (
            <>
              {current === 'events' && <EventsView />}
              {current === 'overview' && eventId && <OverviewView eventId={eventId} />}
              {current === 'photos' && eventId && <PhotosView eventId={eventId} canCurate={isLead} />}
              {current === 'upload' && eventId && <UploadView key={eventId} eventId={eventId} />}
              {current === 'team' &&
                eventId &&
                (isLead ? (
                  <TeamView eventId={eventId} />
                ) : (
                  <p role="alert">Only the event lead can manage the team.</p>
                ))}
              {current === 'galleries' &&
                eventId &&
                (isLead ? (
                  <GalleriesView eventId={eventId} />
                ) : (
                  <p role="alert">Only the event lead can manage galleries.</p>
                ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ThemeButton() {
  const resolved = useThemeStore((state) => state.resolved);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <button
      aria-label={`Use ${resolved === 'dark' ? 'light' : 'dark'} theme`}
      onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </button>
  );
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function EventsView() {
  const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['events'],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => api.events(pageParam),
      getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    });
  const navigate = useNavigate();
  const { notification } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const events = data?.pages.flatMap((page) => page.data) ?? [];
  const canCreate = useAuthStore((state) => state.user?.isPlatformAdmin);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const created = await api.createEvent({
        name: String(form.get('name')),
        description: String(form.get('description') ?? ''),
        eventDate: form.get('date') ? new Date(`${form.get('date')}T12:00:00`).getTime() : undefined,
      });
      setOpen(false);
      await refetch();
      await navigate({ to: '/events/$eventId', params: { eventId: created.id } });
    } catch (caught) {
      notification.error({
        message: 'Event not created',
        description: caught instanceof Error ? caught.message : 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Events"
        description="Every active shoot, from first upload to final delivery."
        action={
          canCreate && (
            <button className="primary-action compact" onClick={() => setOpen(true)}>
              <Plus />
              New event
            </button>
          )
        }
      />
      {error && (
        <p role="alert">
          {error.message} <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      {!isLoading && !error && events.length === 0 && (
        <p>
          {canCreate
            ? 'Create your first event to invite photographers and upload photos.'
            : 'No events assigned yet. Ask your lead to add you to an event.'}
        </p>
      )}
      <div className="event-summary">
        <span>
          <strong>{events.length}</strong> {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>
      <section className="event-list" aria-busy={isLoading}>
        {events.map((item) => (
          <Link key={item.id} to="/events/$eventId" params={{ eventId: item.id }} className="event-row">
            <div className="event-cover" aria-hidden="true">
              <CalendarDays />
            </div>
            <div className="event-primary">
              <h2>{item.name}</h2>
              <p>{item.description || 'No event note yet.'}</p>
            </div>
            <div className="event-meta event-date">
              <span>Event date</span>
              <strong>
                {item.eventDate
                  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(item.eventDate)
                  : 'Not set'}
              </strong>
            </div>
            <div className="event-meta event-role">
              <span>Your role</span>
              <Tag color={item.role === 'admin' ? 'cyan' : 'default'}>
                {item.role === 'admin' ? 'Lead' : 'Member'}
              </Tag>
            </div>
            <div className="event-count">
              <span>Open event →</span>
            </div>
          </Link>
        ))}
      </section>
      {hasNextPage && (
        <button className="load-more" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Load more events
        </button>
      )}
      <Modal title="Create an event" open={open} footer={null} onCancel={() => setOpen(false)}>
        <form className="modal-form" onSubmit={(event) => void create(event)}>
          <label>
            Event name
            <input name="name" required placeholder="Arjun & Priya Wedding" />
          </label>
          <label>
            Short note
            <textarea name="description" rows={4} placeholder="What should the team know?" />
          </label>
          <label>
            Event date
            <input name="date" type="date" />
          </label>
          <button className="primary-action" disabled={saving}>
            {saving ? 'Creating…' : 'Create event'}
          </button>
        </form>
      </Modal>
    </>
  );
}

function useEvent(eventId: string) {
  return useQuery({ queryKey: ['event', eventId], queryFn: () => api.event(eventId) });
}

function OverviewView({ eventId }: { eventId: string }) {
  const { data: event } = useEvent(eventId);
  const { data: stats, error } = useQuery({
    queryKey: ['stats', eventId],
    queryFn: () => api.stats(eventId),
  });
  const isLead = event?.role === 'admin';
  const values = stats ?? {
    totalPhotos: 0,
    readyPhotos: 0,
    selectedPhotos: 0,
    storageBytes: 0,
    galleries: 0,
    uploaders: [],
  };
  const percent = Math.round((values.selectedPhotos / Math.max(values.readyPhotos, 1)) * 100);
  return (
    <>
      <div className="event-breadcrumb">
        <Link to="/events">
          <ArrowLeft />
          Events
        </Link>
      </div>
      <PageHeading
        title={event?.name ?? 'Event'}
        description={event?.description ?? 'Event workspace'}
        action={
          <Link className="primary-action compact" to="/events/$eventId/upload" params={{ eventId }}>
            <CloudUpload />
            Upload photos
          </Link>
        }
      />
      {error && <p role="alert">{error.message}</p>}
      <section className="stats-strip">
        <div>
          <ImageIcon />
          <span>{isLead ? 'Team photographs' : 'Your photographs'}</span>
          <strong>{values.readyPhotos.toLocaleString()}</strong>
          <small>Uploaded and ready</small>
        </div>
        <div>
          <Check />
          <span>Selected</span>
          <strong>{values.selectedPhotos.toLocaleString()}</strong>
          <small>{percent}% of ready photographs</small>
        </div>
        <div>
          <HardDrive />
          <span>Storage</span>
          <strong>{formatBytes(values.storageBytes)}</strong>
          <small>Private originals</small>
        </div>
      </section>
      <section className="panel selection-progress">
        <h2>{isLead ? 'Review the team’s photographs' : 'Your assigned event'}</h2>
        <p>
          {isLead
            ? 'Select photographs, then publish a gallery with a link and PIN.'
            : 'Upload photographs and review your own submissions. Your lead handles the final selection.'}
        </p>
        <Link to="/events/$eventId/photos" params={{ eventId }}>
          Browse photographs →
        </Link>
        {isLead && (
          <p>
            <Link to="/events/$eventId/galleries" params={{ eventId }}>
              Manage galleries →
            </Link>
          </p>
        )}
      </section>
    </>
  );
}

function PhotosView({ eventId, canCurate }: { eventId: string; canCurate: boolean }) {
  const [sort, setSort] = useState('newest');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Photo | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deletion, setDeletion] = useState<{ ids: string[]; filename?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const userId = useAuthStore((state) => state.user?.id);
  const canDelete = (photo: Photo) =>
    canCurate || (photo.uploadedBy === userId && Date.now() - photo.createdAt < 15 * 60 * 1000);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const photosQuery = useInfiniteQuery({
    queryKey: ['photos', eventId, sort, selectedFilter, search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.photos(eventId, {
        cursor: pageParam,
        sort,
        search: search || undefined,
        selected: selectedFilter === 'all' ? undefined : selectedFilter === 'selected',
      }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  });
  const photos = photosQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const mutateSelection = useMutation({
    mutationFn: ({ ids, value }: { ids: string[]; value: boolean }) => api.selectPhotos(eventId, ids, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['photos', eventId] });
      void queryClient.invalidateQueries({ queryKey: ['stats', eventId] });
      setPicked(new Set());
      message.success('Selection updated');
    },
  });

  async function confirmDeletion() {
    if (!deletion || deleting) return;
    setDeleting(true);
    try {
      if (deletion.filename) await api.deletePhoto(deletion.ids[0]!);
      else await api.deletePhotos(eventId, deletion.ids);
      const removed = new Set(deletion.ids);
      setPicked((current) => new Set([...current].filter((id) => !removed.has(id))));
      if (detail && removed.has(detail.id)) setDetail(null);
      setDeletion(null);
      await Promise.all([
        ...['photos', 'stats', 'galleries', 'members'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key, eventId] }),
        ),
        queryClient.invalidateQueries({ queryKey: ['gallery-teaser'] }),
        queryClient.invalidateQueries({ queryKey: ['public-gallery'] }),
      ]);
      message.success(
        deletion.ids.length === 1 ? 'Photograph deleted' : `${deletion.ids.length} photographs deleted`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not delete photographs. Try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Photographs"
        description={`${photos.length.toLocaleString()} loaded · Review, compare, and shape the final story.`}
        action={
          <Link className="primary-action compact" to="/events/$eventId/upload" params={{ eventId }}>
            <UploadCloud />
            Add photographs
          </Link>
        }
      />
      <div className="photo-toolbar">
        <div className="search-box">
          <Search />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search filenames"
            placeholder="Search filenames"
          />
        </div>
        <Segmented
          value={selectedFilter}
          onChange={(value) => setSelectedFilter(String(value))}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Selected', value: 'selected' },
            { label: 'Unselected', value: 'unselected' },
          ]}
        />
        <select aria-label="Sort photographs" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="filename">Filename</option>
          <option value="taken">Capture time</option>
          <option value="size">File size</option>
        </select>
      </div>
      {photosQuery.isError && <p role="alert">{photosQuery.error.message}</p>}
      {!photosQuery.isPending && !photosQuery.isError && photos.length === 0 && (
        <p>No photographs match. Upload photos to get started.</p>
      )}
      {photos.some(canDelete) && (
        <div className="photo-mark-actions">
          <button
            disabled={deleting || mutateSelection.isPending}
            onClick={() =>
              setPicked(
                new Set(
                  photos
                    .filter(canDelete)
                    .slice(0, 500)
                    .map((photo) => photo.id),
                ),
              )
            }
          >
            Mark all loaded
          </button>
          <span>Mark up to 500 photographs at a time.</span>
        </div>
      )}
      <PhotoGrid
        canCurate={canCurate}
        canMark={canDelete}
        disabled={deleting || mutateSelection.isPending}
        photos={photos}
        picked={picked}
        onPick={(photo) => {
          if (!picked.has(photo.id) && picked.size >= 500) {
            message.info('Mark up to 500 photographs at a time.');
            return;
          }
          setPicked((current) => {
            const next = new Set(current);
            next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
            return next;
          });
        }}
        onOpen={setDetail}
      />
      {photosQuery.hasNextPage && (
        <button
          className="load-more"
          disabled={photosQuery.isFetchingNextPage}
          onClick={() => void photosQuery.fetchNextPage()}
        >
          Load more photographs
        </button>
      )}
      {picked.size > 0 && (
        <div className="bulk-bar">
          <span>
            <strong>{picked.size}</strong> photographs marked
          </span>
          {canCurate && (
            <button
              disabled={mutateSelection.isPending || deleting}
              onClick={() =>
                mutateSelection.mutate(
                  { ids: [...picked], value: true },
                  { onError: (error) => message.error(error.message) },
                )
              }
            >
              <Check />
              Add to selection
            </button>
          )}
          {canCurate && (
            <button
              disabled={mutateSelection.isPending || deleting}
              onClick={() =>
                mutateSelection.mutate(
                  { ids: [...picked], value: false },
                  { onError: (error) => message.error(error.message) },
                )
              }
            >
              Deselect
            </button>
          )}
          <button
            className="danger-action"
            disabled={deleting || mutateSelection.isPending}
            onClick={() => setDeletion({ ids: [...picked] })}
          >
            <Trash2 />
            Delete marked
          </button>
          <button disabled={deleting} onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      <Modal
        title={deletion?.filename ? 'Delete photograph?' : `Delete ${deletion?.ids.length ?? 0} photographs?`}
        open={Boolean(deletion)}
        okText="Delete"
        okButtonProps={{ danger: true, 'aria-label': 'Delete' }}
        confirmLoading={deleting}
        cancelButtonProps={{ disabled: deleting }}
        closable={!deleting}
        maskClosable={!deleting}
        keyboard={!deleting}
        onCancel={() => {
          if (!deleting) setDeletion(null);
        }}
        onOk={() => void confirmDeletion()}
      >
        {deletion?.filename && <p className="delete-filename">{deletion.filename}</p>}
        <p>
          This removes the photographs from the event and all customer galleries. You cannot undo this in the
          app.
        </p>
      </Modal>
      <Drawer width={480} title="Photograph details" open={Boolean(detail)} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <PhotoImage photo={detail} variant="preview" />
            {canDelete(detail) ? (
              <button
                className="delete-photo-action"
                disabled={deleting || mutateSelection.isPending}
                onClick={() => setDeletion({ ids: [detail.id], filename: detail.filename })}
              >
                <Trash2 />
                Delete photograph
              </button>
            ) : (
              !canCurate && (
                <p className="muted">
                  Members can delete their own uploads within 15 minutes. Ask your lead to remove older
                  photographs.
                </p>
              )
            )}
            <Descriptions
              column={1}
              size="small"
              className="photo-descriptions"
              items={[
                { key: 'name', label: 'Filename', children: detail.filename },
                { key: 'uploader', label: 'Photographer', children: detail.uploaderName ?? 'Unknown' },
                {
                  key: 'size',
                  label: 'File size',
                  children: formatBytes(detail.fileSize),
                },
                {
                  key: 'dimensions',
                  label: 'Dimensions',
                  children: `${detail.width ?? '—'} × ${detail.height ?? '—'}`,
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </>
  );
}

function PhotoGrid({
  photos,
  picked,
  onPick,
  onOpen,
  canCurate,
  canMark,
  disabled,
}: {
  canCurate: boolean;
  canMark: (photo: Photo) => boolean;
  disabled: boolean;
  photos: Photo[];
  picked: Set<string>;
  onPick: (photo: Photo) => void;
  onOpen: (photo: Photo) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!parent.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(parent.current);
    return () => observer.disconnect();
  }, []);
  const columns = width < 600 ? 2 : width < 900 ? 3 : 4;
  const rows = Math.ceil(photos.length / columns);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parent.current,
    estimateSize: () => (((width - (columns - 1) * 8) / columns) * 2) / 3 + 44,
    overscan: 2,
  });
  return (
    <div className="virtual-grid" ref={parent}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            className="photo-grid-row"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {photos.slice(row.index * columns, row.index * columns + columns).map((photo, local) => {
              const index = row.index * columns + local;
              const marked = picked.has(photo.id);
              return (
                <article key={photo.id} className={`photo-tile ${marked ? 'is-picked' : ''}`}>
                  <button
                    aria-label={`Open ${photo.filename}`}
                    className="photo-click"
                    onClick={() => onOpen(photo)}
                  >
                    <PhotoImage photo={photo} index={index} aspectRatio="3/2" />
                  </button>
                  {canMark(photo) && (
                    <button
                      disabled={disabled}
                      className={`${canCurate ? 'select-dot' : 'mark-dot'} ${marked || (canCurate && photo.isSelected) ? 'selected' : ''}`}
                      aria-label={`${canCurate ? 'Select' : 'Mark'} ${photo.filename}`}
                      aria-pressed={marked}
                      onClick={() => onPick(photo)}
                    >
                      {marked || (canCurate && photo.isSelected) ? <Check /> : null}
                    </button>
                  )}
                  <div className="photo-caption">
                    <span>{photo.filename}</span>
                    <small>{formatBytes(photo.fileSize)}</small>
                  </div>
                </article>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamView({ eventId }: { eventId: string }) {
  const { notification } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const userId = useAuthStore((state) => state.user?.id);
  const [memberAccess, setMemberAccess] = useState<{ email: string; password: string } | null>(null);
  const { data, refetch, isPending, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['members', eventId],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => api.members(eventId, pageParam),
      getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    });
  const columns: TableColumnsType<EventMember> = [
    {
      title: 'Photographer',
      dataIndex: 'displayName',
      render: (_, row) => (
        <div className="member-cell">
          <span>{row.displayName.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{row.displayName}</strong>
            <small>{row.email}</small>
          </div>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (role) => (
        <Tag color={role === 'admin' ? 'cyan' : 'default'}>{role === 'admin' ? 'Lead' : 'Member'}</Tag>
      ),
    },
    { title: 'Uploads', dataIndex: 'photoCount', sorter: (a, b) => a.photoCount - b.photoCount },
    {
      title: 'Added',
      dataIndex: 'addedAt',
      render: (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) =>
        row.userId === userId ? (
          <span className="muted">You</span>
        ) : (
          <Popconfirm
            title="Remove this team member?"
            description="Their access ends on the next request."
            onConfirm={() =>
              api
                .removeMember(eventId, row.userId)
                .then(() => refetch())
                .catch((error) => notification.error({ message: error.message }))
            }
          >
            <button className="remove-member" aria-label={`Remove ${row.displayName}`}>
              Remove
            </button>
          </Popconfirm>
        ),
    },
  ];
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const member = await api.addMember(eventId, {
        email: String(form.get('email')),
        role: String(form.get('role')) as 'admin' | 'member',
        displayName: String(form.get('name')),
      });
      setOpen(false);
      if (member.temporaryPassword)
        setMemberAccess({ email: member.email, password: member.temporaryPassword });
      await refetch();
      notification.success({
        message: 'Team member added',
        description: member?.temporaryPassword
          ? `Temporary password: ${member.temporaryPassword}`
          : 'They can now access this event.',
      });
    } catch (caught) {
      notification.error({
        message: 'Could not add member',
        description: caught instanceof Error ? caught.message : 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Team"
        description="Event access is membership-based and takes effect immediately."
        action={
          <button className="primary-action compact" onClick={() => setOpen(true)}>
            <Plus />
            Add member
          </button>
        }
      />
      {error && (
        <p role="alert">
          {error.message} <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      <section className="panel table-panel">
        <Table
          rowKey="userId"
          dataSource={data?.pages.flatMap((page) => page.data) ?? []}
          columns={columns}
          pagination={false}
          loading={isPending}
          scroll={{ x: 650 }}
        />
      </section>
      {hasNextPage && (
        <button className="load-more" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Load more members
        </button>
      )}
      <Modal title="Add a team member" open={open} footer={null} onCancel={() => setOpen(false)}>
        <form className="modal-form" onSubmit={(event) => void invite(event)}>
          <label>
            Name
            <input name="name" required placeholder="Meera Joshi" />
          </label>
          <label>
            Email
            <input name="email" type="email" required placeholder="meera@studio.com" />
          </label>
          <label>
            Event role
            <select name="role">
              <option value="member">Member — upload and view</option>
              <option value="admin">Lead — curate and publish</option>
            </select>
          </label>
          <button className="primary-action" disabled={saving}>
            {saving ? 'Adding…' : 'Add to event'}
          </button>
        </form>
      </Modal>
      <Modal
        title="Member sign-in details"
        open={Boolean(memberAccess)}
        onCancel={() => setMemberAccess(null)}
        footer={null}
      >
        {memberAccess && (
          <div className="credentials member-credentials">
            <p>Share these details with the member. The password is shown only now.</p>
            <label>
              Email<strong>{memberAccess.email}</strong>
            </label>
            <label>
              Temporary password<strong>{memberAccess.password}</strong>
            </label>
            <button
              className="primary-action"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${memberAccess.email}\n${memberAccess.password}`)
                  .then(() => notification.success({ message: 'Copied' }))
                  .catch(() => notification.error({ message: 'Select and copy the details manually.' }))
              }
            >
              Copy sign-in details
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
