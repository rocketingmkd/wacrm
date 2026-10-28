"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";

interface MediaLightboxProps {
  kind: "image" | "video";
  /** Ready-to-render URL (an http(s) URL or an already-fetched blob: URL). */
  src: string;
  alt?: string;
  /** Suggested file name for the download button. */
  filename?: string;
  onClose: () => void;
}

/**
 * Full-screen viewer for chat images and videos. Closes with Esc, the X
 * button or a click outside the media. Images toggle between "fit the
 * screen" and 2x zoom on click.
 */
export function MediaLightbox({ kind, src, alt, filename, onClose }: MediaLightboxProps) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const buttonClass =
    "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={kind === "image" ? "Visualizar imagem" : "Visualizar vídeo"}
      className="fixed inset-0 z-[100] flex flex-col bg-black/90"
      onClick={onClose}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-end gap-2 p-3" onClick={(e) => e.stopPropagation()}>
        {kind === "image" && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? "Reduzir" : "Ampliar"}
            title={zoomed ? "Reduzir" : "Ampliar"}
          >
            {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
          </button>
        )}
        <a
          href={src}
          download={filename ?? (kind === "image" ? "imagem" : "video")}
          className={buttonClass}
          aria-label="Baixar"
          title="Baixar"
        >
          <Download className="h-5 w-5" />
        </a>
        <button type="button" className={buttonClass} onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-4">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt ?? ""}
            onClick={(e) => {
              e.stopPropagation();
              setZoomed((z) => !z);
            }}
            className={
              zoomed
                ? "m-auto max-w-none cursor-zoom-out"
                : "max-h-full max-w-full cursor-zoom-in object-contain"
            }
            style={zoomed ? { width: "200%" } : undefined}
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
