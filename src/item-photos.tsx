import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, X } from "lucide-react";
import { supabase } from "./client";

export type PendingPhoto = {
  id: string;
  filename: string;
  blob: Blob;
  url: string;
};
type Photo = {
  id: string;
  filename: string;
  object_path: string;
  removed_at: string | null;
  data_url?: string;
};
const bucket = "motion-item-photos";
const sampleKey = (item: string) => `motion-sample-photos:${item}`;
const readSample = (item: string): Photo[] =>
  JSON.parse(localStorage.getItem(sampleKey(item)) || "[]");

async function prepare(file: File): Promise<PendingPhoto> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml")
    throw new Error(
      "Choose a JPEG, PNG, WebP, or another photo your browser can open.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 20 MB.");
  const source = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = source;
    try {
      await img.decode();
    } catch {
      throw new Error(
        "This photo format could not be opened. Export it as JPEG or PNG and try again.",
      );
    }
    const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Photo preview is unavailable. Try another browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Photo conversion failed."))),
        "image/jpeg",
        0.85,
      ),
    );
    if (blob.size > 3 * 1024 * 1024)
      throw new Error("This photo is too large. Choose a smaller image.");
    return {
      id: crypto.randomUUID(),
      filename: file.name.slice(0, 180),
      blob,
      url: URL.createObjectURL(blob),
    };
  } finally {
    URL.revokeObjectURL(source);
  }
}
export async function uploadItemPhoto(
  item: string,
  photo: PendingPhoto,
  preview: boolean,
) {
  if (preview) {
    const data_url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read photo."));
      reader.readAsDataURL(photo.blob);
    });
    const all = readSample(item);
    if (all.filter((p) => !p.removed_at).length >= 20)
      throw new Error("Up to 20 photos per item.");
    localStorage.setItem(
      sampleKey(item),
      JSON.stringify([
        ...all,
        {
          id: photo.id,
          filename: photo.filename,
          object_path: "",
          removed_at: null,
          data_url,
        },
      ]),
    );
    return;
  }
  if (!supabase) throw new Error("Sign in to upload photos.");
  const reserved = await supabase.rpc("prepare_item_photo", {
    p_item: item,
    p_filename: photo.filename,
    p_photo: photo.id,
  });
  if (reserved.error) throw reserved.error;
  const record = reserved.data as Photo & { ready: boolean };
  if (record.ready) return;
  const uploaded = await supabase.storage
    .from(bucket)
    .upload(record.object_path, photo.blob, {
      contentType: "image/jpeg",
      cacheControl: "0",
      upsert: false,
    });
  if (uploaded.error) {
    // A timed-out upload may already exist. Finalize that same reservation
    // instead of creating a duplicate or depending on a Storage error code.
    const recovered = await supabase.rpc("complete_item_photo", {
      p_id: record.id,
    });
    if (!recovered.error) return;
    await supabase.rpc("set_item_photo_removed", {
      p_id: record.id,
      p_removed: true,
    });
    throw uploaded.error;
  }
  const completed = await supabase.rpc("complete_item_photo", {
    p_id: record.id,
  });
  if (completed.error) throw completed.error;
}

export function ItemPhotos({
  itemId,
  preview,
  privateTodo,
  pending,
  onPending,
  disabled,
  onBusy,
  revision,
}: {
  itemId: string | null;
  preview: boolean;
  privateTodo: boolean;
  pending: PendingPhoto[];
  onPending: (photos: PendingPhoto[]) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  revision: number;
}) {
  const [photos, setPhotos] = useState<(Photo & { url: string })[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [removed, setRemoved] = useState<Photo | null>(null);
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setPhotos([]);
    if (!itemId) return;
    void (async () => {
      let rows: Photo[];
      if (preview) rows = readSample(itemId).filter((p) => !p.removed_at);
      else {
        const r = await supabase!
          .from("item_photos")
          .select("id,filename,object_path,removed_at")
          .eq("item_id", itemId)
          .eq("ready", true)
          .is("removed_at", null)
          .order("created_at");
        if (r.error) throw r.error;
        rows = r.data;
      }
      const loaded = await Promise.all(
        rows.map(async (p) => {
          if (p.data_url) return { ...p, url: p.data_url };
          const r = await supabase!.storage
            .from(bucket)
            .download(p.object_path);
          if (r.error) throw r.error;
          const url = URL.createObjectURL(r.data);
          urls.push(url);
          if (!active) URL.revokeObjectURL(url);
          return { ...p, url };
        }),
      );
      if (active) setPhotos(loaded);
    })().catch((e) => {
      if (active) setError(e.message || "Photos could not load.");
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [itemId, preview, reload, revision]);
  async function select(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    onBusy(true);
    setError("");
    const selected: PendingPhoto[] = [];
    try {
      if (photos.length + pending.length + files.length > 20)
        throw new Error("Up to 20 photos per item.");
      for (const file of files) selected.push(await prepare(file));
      // Keep selections until Save; a failed upload leaves the remaining photos retryable.
      onPending([...pendingRef.current, ...selected]);
    } catch (e) {
      selected.forEach((p) => URL.revokeObjectURL(p.url));
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove(photo: Photo, restore = false) {
    if (!itemId) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      if (preview)
        localStorage.setItem(
          sampleKey(itemId),
          JSON.stringify(
            readSample(itemId).map((p) =>
              p.id === photo.id
                ? {
                    ...p,
                    removed_at: restore ? null : new Date().toISOString(),
                  }
                : p,
            ),
          ),
        );
      else {
        const r = await supabase!.rpc("set_item_photo_removed", {
          p_id: photo.id,
          p_removed: !restore,
        });
        if (r.error) throw r.error;
      }
      setRemoved(restore ? null : photo);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="item-photos" aria-label="Photos">
      <div className="section-line">
        <h3>Photos</h3>
        <button
          type="button"
          className="button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={17} /> Add photos
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose photos"
        onChange={(e) => void select(Array.from(e.target.files || []))}
      />
      <p className="field-hint">
        {privateTodo
          ? "Only you can see these photos."
          : "Workspace members can see these photos."}{" "}
        Up to 20 photos, 20 MB each before resizing.
      </p>
      {!!pending.length && (
        <p className="notice">
          {pending.length} photo{pending.length === 1 ? "" : "s"} ready. Save to
          upload. Unsaved photo selections stay here until you close this
          editor.
        </p>
      )}
      {busy && <p role="status">Preparing photos…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError("");
              setReload((n) => n + 1);
            }}
          >
            Reload photos
          </button>
        </p>
      )}
      <div className="photo-grid">
        {photos.map((p) => (
          <figure key={p.id}>
            <a href={p.url} target="_blank" rel="noreferrer">
              <img src={p.url} alt={p.filename} loading="lazy" />
            </a>
            <figcaption>{p.filename}</figcaption>
            <button
              type="button"
              aria-label={`Remove ${p.filename}`}
              disabled={disabled || busy}
              onClick={() => void remove(p)}
            >
              <X size={16} />
            </button>
          </figure>
        ))}
        {pending.map((p) => (
          <figure key={p.id}>
            <img src={p.url} alt={`Selected: ${p.filename}`} />
            <figcaption>{p.filename} · Not saved</figcaption>
            <button
              type="button"
              aria-label={`Remove selected ${p.filename}`}
              disabled={disabled || busy}
              onClick={() => {
                URL.revokeObjectURL(p.url);
                onPending(pending.filter((x) => x.id !== p.id));
              }}
            >
              <X size={16} />
            </button>
          </figure>
        ))}
      </div>
      {removed && (
        <button
          type="button"
          className="text-button"
          disabled={disabled || busy}
          onClick={() => void remove(removed, true)}
        >
          <RotateCcw size={15} /> Undo photo removal
        </button>
      )}
    </section>
  );
}
