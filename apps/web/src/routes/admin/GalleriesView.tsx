import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Modal, Popconfirm, Table, Tag, type TableColumnsType } from 'antd';
import { Copy, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import type { Gallery } from '../../types';

export function GalleriesView({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{ url: string; pin: string } | null>(null);
  const { notification, message } = App.useApp();
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['galleries', eventId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.galleries(eventId, pageParam),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
  });
  const stats = useQuery({ queryKey: ['stats', eventId], queryFn: () => api.stats(eventId) });
  const refresh = () =>
    Promise.all(
      ['galleries', 'stats'].map((key) => queryClient.invalidateQueries({ queryKey: [key, eventId] })),
    );
  const report = (error: unknown) =>
    notification.error({ message: error instanceof Error ? error.message : 'Request failed. Try again.' });
  const urlFor = (gallery: Gallery) => `${location.origin}/gallery/${gallery.slug}`;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      message.success('Copied');
    } catch {
      message.error('Could not copy. Select and copy the link manually.');
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await api.createGallery(eventId, {
        title: String(form.get('title')),
        pin: String(form.get('pin') || '') || undefined,
        useSelected: true,
        allowDownload: form.get('allowDownload') === 'on',
        publish: form.get('publish') === 'on',
      });
      setOpen(false);
      setCredentials({ url: result.url, pin: result.pin });
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<Gallery> = [
    {
      title: 'Gallery',
      dataIndex: 'title',
      render: (_, row) => (
        <div>
          <strong>{row.title}</strong>
          <p>{row.photoCount} photographs</p>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status) => <Tag color={status === 'published' ? 'cyan' : 'default'}>{status}</Tag>,
    },
    {
      title: 'Actions',
      render: (_, row) => (
        <div className="gallery-row-actions">
          {row.status === 'published' && (
            <a href={urlFor(row)} target="_blank" rel="noreferrer">
              Open customer gallery
            </a>
          )}
          <button onClick={() => void copy(urlFor(row))}>Copy link</button>
          <button
            onClick={() =>
              void (row.status === 'published' ? api.unpublishGallery(row.id) : api.publishGallery(row.id))
                .then(refresh)
                .catch(report)
            }
          >
            {row.status === 'published' ? 'Unpublish' : 'Publish'}
          </button>
          <Popconfirm
            title="Generate a new PIN?"
            description="The previous PIN and customer sessions will stop working."
            onConfirm={() =>
              api
                .rotatePin(row.id)
                .then((result) => setCredentials({ url: urlFor(row), pin: result.pin }))
                .catch(report)
            }
          >
            <button>Reset PIN</button>
          </Popconfirm>
        </div>
      ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Galleries</h1>
          <p>Choose a PIN and share only the selected photographs.</p>
        </div>
        <button className="primary-action compact" onClick={() => setOpen(true)}>
          <Plus />
          New gallery
        </button>
      </div>
      {query.isError && <p role="alert">{query.error.message}</p>}
      <section className="panel table-panel">
        <Table
          rowKey="id"
          dataSource={query.data?.pages.flatMap((page) => page.data) ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: 650 }}
          loading={query.isPending}
        />
      </section>
      {query.hasNextPage && (
        <button
          className="load-more"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more galleries
        </button>
      )}
      <Modal title="Create a gallery" open={open} footer={null} onCancel={() => setOpen(false)}>
        <form className="modal-form" onSubmit={(event) => void create(event)}>
          {stats.isError && (
            <p role="alert">
              {stats.error.message}{' '}
              <button type="button" onClick={() => void stats.refetch()}>
                Retry
              </button>
            </p>
          )}
          <p>
            {stats.data?.selectedPhotos ?? 0} selected photographs will be included. Later selection changes
            won’t alter this gallery.
          </p>
          <label>
            Gallery title
            <input name="title" required maxLength={140} placeholder="Event highlights" />
          </label>
          <label>
            Six-digit PIN
            <input
              name="pin"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              placeholder="Leave blank to generate a PIN"
            />
          </label>
          <label className="checkbox-label">
            <input name="publish" type="checkbox" defaultChecked />
            Publish now
          </label>
          <label className="checkbox-label">
            <input name="allowDownload" type="checkbox" defaultChecked />
            Allow downloads
          </label>
          <button className="primary-action" disabled={busy || !stats.data?.selectedPhotos}>
            {busy ? 'Creating…' : 'Create gallery'}
          </button>
        </form>
      </Modal>
      <Modal
        title="Gallery access details"
        open={Boolean(credentials)}
        footer={null}
        onCancel={() => setCredentials(null)}
      >
        {credentials && (
          <div className="credentials">
            <p>
              Copy the PIN before closing. Draft galleries must be published before customers can open them.
            </p>
            <label>
              Gallery link
              <span>
                {credentials.url}
                <button aria-label="Copy gallery link" onClick={() => void copy(credentials.url)}>
                  <Copy />
                </button>
              </span>
            </label>
            <label>
              Six-digit PIN<strong>{credentials.pin}</strong>
            </label>
            <button
              className="primary-action"
              onClick={() => void copy(`${credentials.url}\nPIN: ${credentials.pin}`)}
            >
              Copy link and PIN
            </button>
            <a href={credentials.url} target="_blank" rel="noreferrer">
              Open customer gallery
            </a>
          </div>
        )}
      </Modal>
    </>
  );
}
