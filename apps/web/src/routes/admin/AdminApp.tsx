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
  ChevronDown,
  CircleHelp,
  CloudUpload,
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
  Sun,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useThemeStore } from '../../stores/theme';
import type { EventMember, Photo } from '../../types';
import { PhotoImage } from '../../components/PhotoImage';
import { UploadView } from './UploadView';
import { GalleriesView } from './GalleriesView';

const eventColors = ['#67e8f9', '#f2b84b', '#c084fc', '#fb7185'];
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

  async function logout() {
    await api.logout().catch(() => undefined);
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
          <button className="mobile-close" onClick={() => setMobileMenu(false)}>
            <X />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="avatar">{(user?.displayName ?? 'PS').slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{user?.displayName ?? 'Priya Studio'}</strong>
            <small>Studio workspace</small>
          </div>
          <ChevronDown />
        </div>
        <nav>
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
          <a href="/redoc" target="_blank">
            <CircleHelp />
            API reference
          </a>
          <button onClick={() => void logout()}>
            <LogOut />
            Sign out
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <button className="mobile-menu" onClick={() => setMobileMenu(true)}>
            <SlidersHorizontal />
          </button>
          <div className="global-search">
            <Search />
            <span>Search the workspace</span>
            <kbd>/</kbd>
          </div>
          <div className="topbar-actions">
            <ThemeButton />
            <button aria-label="Settings">
              <Settings />
            </button>
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
  const preference = useThemeStore((state) => state.preference);
  const resolved = useThemeStore((state) => state.resolved);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <button
      aria-label={`Use ${resolved === 'dark' ? 'light' : 'dark'} theme`}
      onClick={() => setPreference(preference === 'dark' ? 'light' : 'dark')}
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
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const navigate = useNavigate();
  const { notification } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const events = data?.data ?? [];
  const canCreate = useAuthStore((state) => state.user?.isPlatformAdmin);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await api.createEvent({
        name: String(form.get('name')),
        description: String(form.get('description') ?? ''),
      });
      setOpen(false);
      await refetch();
      await navigate({ to: '/events/$eventId', params: { eventId: created.id } });
    } catch (caught) {
      notification.error({
        message: 'Event not created',
        description: caught instanceof Error ? caught.message : 'Try again.',
      });
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
          <strong>{events.length}</strong> active events
        </span>
      </div>
      <section className="event-list" aria-busy={isLoading}>
        {events.map((item, index) => (
          <Link key={item.id} to="/events/$eventId" params={{ eventId: item.id }} className="event-row">
            <div
              className="event-cover"
              style={{
                backgroundImage: 'url(/assets/wedding-contact-sheet.png)',
                backgroundPosition: `${index * 33}% 0`,
              }}
            >
              <span style={{ backgroundColor: eventColors[index % eventColors.length] }} />
            </div>
            <div className="event-primary">
              <h2>{item.name}</h2>
              <p>{item.description || 'No event note yet.'}</p>
            </div>
            <div className="event-meta">
              <span>Event date</span>
              <strong>
                {item.eventDate
                  ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(item.eventDate)
                  : 'Not set'}
              </strong>
            </div>
            <div className="event-meta">
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
          <button className="primary-action">Create event</button>
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
          <strong>{(values.storageBytes / 1024 ** 2).toFixed(1)} MB</strong>
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
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
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
      <PhotoGrid
        canCurate={canCurate}
        photos={photos}
        picked={picked}
        onPick={(photo) =>
          setPicked((current) => {
            const next = new Set(current);
            next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
            return next;
          })
        }
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
      {canCurate && picked.size > 0 && (
        <div className="bulk-bar">
          <span>
            <strong>{picked.size}</strong> photographs marked
          </span>
          <button
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
          <button
            onClick={() =>
              mutateSelection.mutate(
                { ids: [...picked], value: false },
                { onError: (error) => message.error(error.message) },
              )
            }
          >
            Deselect
          </button>
          <button onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      <Drawer width={480} title="Photograph details" open={Boolean(detail)} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <PhotoImage photo={detail} index={Number(detail.id.split('-').pop()) || 0} />
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
                  children: `${(detail.fileSize / 1024 ** 2).toFixed(1)} MB`,
                },
                {
                  key: 'dimensions',
                  label: 'Dimensions',
                  children: `${detail.width ?? '—'} × ${detail.height ?? '—'}`,
                },
                { key: 'storage', label: 'Storage key', children: detail.storageKey },
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
}: {
  canCurate: boolean;
  photos: Photo[];
  picked: Set<string>;
  onPick: (photo: Photo) => void;
  onOpen: (photo: Photo) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const columns = innerWidth < 640 ? 2 : innerWidth < 1050 ? 3 : 4;
  const rows = Math.ceil(photos.length / columns);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parent.current,
    estimateSize: () => 280,
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
                  <button className="photo-click" onClick={() => onOpen(photo)}>
                    <PhotoImage photo={photo} index={index} />
                  </button>
                  {canCurate && (
                    <button
                      className={`select-dot ${marked || photo.isSelected ? 'selected' : ''}`}
                      aria-label={`Select ${photo.filename}`}
                      onClick={() => onPick(photo)}
                    >
                      {marked || photo.isSelected ? <Check /> : null}
                    </button>
                  )}
                  <div className="photo-caption">
                    <span>{photo.filename}</span>
                    <small>{(photo.fileSize / 1024 ** 2).toFixed(1)} MB</small>
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
  const [memberAccess, setMemberAccess] = useState<{ email: string; password: string } | null>(null);
  const { data, refetch } = useQuery({ queryKey: ['members', eventId], queryFn: () => api.members(eventId) });
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
    { title: 'Uploads', dataIndex: 'photoCount', sorter: true },
    {
      title: 'Added',
      dataIndex: 'addedAt',
      render: (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value),
    },
    {
      title: '',
      key: 'actions',
      render: (_, row) => (
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
          <button className="icon-button">
            <Ellipsis />
          </button>
        </Popconfirm>
      ),
    },
  ];
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      <section className="panel table-panel">
        <Table rowKey="userId" dataSource={data?.data ?? []} columns={columns} pagination={false} sticky />
      </section>
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
          <button className="primary-action">Add to event</button>
        </form>
      </Modal>
      <Modal
        title="Member sign-in details"
        open={Boolean(memberAccess)}
        onCancel={() => setMemberAccess(null)}
        footer={null}
      >
        {memberAccess && (
          <div className="credentials">
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
