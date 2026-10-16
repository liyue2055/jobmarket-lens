import { useEffect, useRef, useState } from "react";
import { PlayCircle, X } from "lucide-react";
import { TOUR } from "./tourContent";
import "./video.css";

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Self-hosted tour video in a modal dialog.
 * Bandwidth: nothing is requested until the dialog opens; the video then uses
 * preload="none", so the file downloads only after the viewer presses play.
 * Privacy: same-origin files, no third-party player, no autoplay, no tracking.
 */
export function TourButton() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const seek = (seconds: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = seconds;
    v.focus();
  };

  return (
    <>
      <button
        ref={opener}
        className="button secondary tour-open"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <PlayCircle size={15} />
        Watch the tour
        <span className="tour-length">{clock(TOUR.durationSeconds)}</span>
      </button>
      <dialog
        ref={dialog}
        className="tour-dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        onClose={() => {
          video.current?.pause();
          setOpen(false);
          opener.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
      >
        {open && (
          <div className="tour-body">
            <div className="tour-head">
              <div>
                <p className="eyebrow">
                  Guided tour · {clock(TOUR.durationSeconds)} · recorded on release{" "}
                  {TOUR.recordedRelease} ({TOUR.recordedOn})
                </p>
                <h2 id="tour-title">{TOUR.title}</h2>
              </div>
              <button
                className="icon-button tour-close"
                onClick={() => setOpen(false)}
                aria-label="Close the tour"
              >
                <X size={18} />
              </button>
            </div>
            <video
              ref={video}
              className="tour-video"
              controls
              preload="none"
              playsInline
              poster={TOUR.poster}
              aria-describedby="tour-description"
            >
              <source src={TOUR.src} type="video/mp4" />
              <track
                kind="captions"
                src={TOUR.captions}
                srcLang="en"
                label="English"
              />
              <track kind="chapters" src={TOUR.chapters} srcLang="en" label="Chapters" />
            </video>
            <p id="tour-description" className="tour-note">
              A screen recording of this canvas with narration; captions are part
              of the picture, and a caption file and transcript are also provided.
              The guide portrait and voice are AI-generated; the background music is
              a licensed Eleven Music track.{" "}
              {`The file (${(TOUR.bytes / 1e6).toFixed(1)} MB) loads only when you press play and is served from this site.`}
            </p>
            <nav className="tour-chapters" aria-label="Tour chapters">
              {TOUR.sections.map((s) => (
                <button key={s.title} className="text-button" onClick={() => seek(s.start)}>
                  <span className="tour-time">{clock(s.start)}</span>
                  {s.title}
                </button>
              ))}
            </nav>
            <details className="tour-transcript">
              <summary>Read the transcript</summary>
              {TOUR.sections.map((s) => (
                <p key={s.title}>
                  <strong>
                    {s.title} ({clock(s.start)})
                  </strong>{" "}
                  {s.text}
                </p>
              ))}
            </details>
          </div>
        )}
      </dialog>
    </>
  );
}
