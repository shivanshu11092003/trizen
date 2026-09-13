import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CloudUpload } from 'lucide-react';
import { api } from '../../lib/api';

type Item = {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'error';
  percent: number;
  error?: string;
};
const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export function UploadView({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const slots = useRef(new Map<string, { photoId: string; uploadUrl: string }>());
  const queryClient = useQueryClient();
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const update = (id: string, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  function add(files: File[]) {
    const accepted: Item[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!allowed.includes(file.type) || file.size === 0 || file.size > 25 * 1024 ** 2)
        rejected.push(file.name);
      else accepted.push({ id: crypto.randomUUID(), file, status: 'queued', percent: 0 });
    }
    setItems((current) => [...current, ...accepted]);
    setError(
      rejected.length
        ? `Not added: ${rejected.join(', ')}. Choose JPEG, PNG, WebP or AVIF files up to 25 MB.`
        : '',
    );
  }

  async function upload(item: Item) {
    update(item.id, { status: 'uploading', percent: 0, error: undefined });
    try {
      const bitmap = await createImageBitmap(item.file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      let slot = slots.current.get(item.id);
      if (slot) {
        const check = await api.confirmUpload(eventId, [{ photoId: slot.photoId, ...dimensions }]);
        if (check.confirmed === 1) {
          update(item.id, { status: 'done', percent: 100 });
          return;
        }
      } else {
        const intent = await api.uploadIntent(eventId, [
          { filename: item.file.name, contentType: item.file.type, fileSize: item.file.size },
        ]);
        slot = intent.uploads[0];
        if (!slot) throw new Error('Could not reserve this photograph.');
        slots.current.set(item.id, slot);
      }
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const cleanup = () => controller.current.signal.removeEventListener('abort', abort);
        xhr.open('PUT', slot!.uploadUrl);
        xhr.timeout = 120_000;
        xhr.setRequestHeader('Content-Type', item.file.type);
        xhr.upload.onprogress = (event) =>
          event.lengthComputable &&
          update(item.id, { percent: Math.round((event.loaded / event.total) * 100) });
        xhr.onload = () => {
          cleanup();
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error('Storage rejected the upload. Retry this file.'));
        };
        xhr.onerror =
          xhr.ontimeout =
          xhr.onabort =
            () => {
              cleanup();
              reject(new Error('Transfer interrupted. Retry this file.'));
            };
        controller.current.signal.addEventListener('abort', abort, { once: true });
        if (controller.current.signal.aborted) {
          cleanup();
          reject(new Error('Upload canceled.'));
          return;
        }
        xhr.send(item.file);
      });
      const result = await api.confirmUpload(eventId, [{ photoId: slot.photoId, ...dimensions }]);
      if (result.confirmed !== 1) throw new Error('The file could not be verified. Retry this file.');
      update(item.id, { status: 'done', percent: 100 });
    } catch (caught) {
      update(item.id, {
        status: 'error',
        error: caught instanceof Error ? caught.message : 'Upload failed. Try again.',
      });
    }
  }

  async function start() {
    setBusy(true);
    const pending = items.filter((item) => item.status !== 'done');
    let next = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (next < pending.length && !controller.current.signal.aborted) await upload(pending[next++]!);
        }),
      );
      await Promise.all(
        ['photos', 'stats'].map((key) => queryClient.invalidateQueries({ queryKey: [key, eventId] })),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Upload photographs</h1>
          <p>Add multiple photos. Successful uploads stay ready when another file fails.</p>
        </div>
      </div>
      <label
        className="upload-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) add(Array.from(event.dataTransfer.files));
        }}
      >
        <CloudUpload />
        <strong>Drop photographs here or choose files</strong>
        <span>JPEG, PNG, WebP, AVIF · up to 25 MB each</span>
        <input
          aria-label="Choose photographs"
          type="file"
          multiple
          accept={allowed.join(',')}
          disabled={busy}
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <ul className="upload-files">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.file.name}</strong>
              <span>
                {item.status === 'done'
                  ? 'Ready for review'
                  : item.status === 'error'
                    ? item.error
                    : item.status === 'uploading'
                      ? `Uploading ${item.percent}%`
                      : 'Queued'}
              </span>
            </div>
            <progress value={item.percent} max={100} aria-label={`${item.file.name} progress`} />
            {!busy && item.status !== 'done' && (
              <button onClick={() => setItems((current) => current.filter((other) => other.id !== item.id))}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <div className="upload-start">
          <span>
            {items.filter((item) => item.status === 'done').length} of {items.length} ready
          </span>
          <button
            className="primary-action compact"
            disabled={busy || items.every((item) => item.status === 'done')}
            onClick={() => void start()}
          >
            {busy
              ? 'Uploading…'
              : items.some((item) => item.status === 'error')
                ? 'Retry unfinished uploads'
                : 'Start upload'}
          </button>
          <Link to="/events/$eventId/photos" params={{ eventId }}>
            View photographs
          </Link>
        </div>
      )}
    </>
  );
}
