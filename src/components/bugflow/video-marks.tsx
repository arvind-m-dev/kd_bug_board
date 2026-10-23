import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  Eraser,
  Pause,
  PenLine,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hitShape } from "@/lib/mark-hit";
import { VIDEO_MARKS_MAX, clock, marksAt, type MarkShape, type VideoMark } from "@/lib/bug-media";

type Tool = "pen" | "rect" | "arrow" | "text" | "eraser";
const COLORS = [
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
  "#111111",
];
const TOOLS: { id: Tool; label: string; icon: typeof PenLine }[] = [
  { id: "pen", label: "Pencil", icon: PenLine },
  { id: "rect", label: "Box", icon: Square },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "text", label: "Text", icon: Type },
  { id: "eraser", label: "Eraser", icon: Eraser },
];
const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Draws one mark shape whose coordinates are fractions of the frame onto a frame of w×h pixels at (ox, oy). */
function paint(
  ctx: CanvasRenderingContext2D,
  s: MarkShape,
  ox: number,
  oy: number,
  w: number,
  h: number,
) {
  const X = (x: number) => ox + x * w,
    Y = (y: number) => oy + y * h;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.type === "text") {
    const size = s.size * h;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.lineWidth = Math.max(2, size / 8);
    ctx.strokeStyle = s.color === "#ffffff" ? "#111111" : "#ffffff";
    ctx.strokeText(s.text, X(s.x), Y(s.y));
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, X(s.x), Y(s.y));
    ctx.restore();
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = Math.max(1.5, s.width * w);
  if (s.type === "pen") {
    ctx.beginPath();
    ctx.moveTo(X(s.points[0]!), Y(s.points[1]!));
    for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(X(s.points[i]!), Y(s.points[i + 1]!));
    if (s.points.length === 2) ctx.lineTo(X(s.points[0]!) + 0.1, Y(s.points[1]!));
    ctx.stroke();
  } else if (s.type === "rect") {
    ctx.strokeRect(
      Math.min(X(s.x1), X(s.x2)),
      Math.min(Y(s.y1), Y(s.y2)),
      Math.abs(X(s.x2) - X(s.x1)),
      Math.abs(Y(s.y2) - Y(s.y1)),
    );
  } else {
    const x1 = X(s.x1),
      y1 = Y(s.y1),
      x2 = X(s.x2),
      y2 = Y(s.y2);
    const a = Math.atan2(y2 - y1, x2 - x1),
      head = ctx.lineWidth * 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - Math.PI / 6), y2 - head * Math.sin(a - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(a + Math.PI / 6), y2 - head * Math.sin(a + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
  }
  ctx.restore();
}

/** Where the picture sits inside the <video> box (object-fit: contain), in CSS pixels. */
function frameRect(v: HTMLVideoElement) {
  const cw = v.clientWidth,
    ch = v.clientHeight;
  const vw = v.videoWidth || cw,
    vh = v.videoHeight || ch;
  const scale = Math.min(cw / vw, ch / vh) || 1;
  const w = vw * scale,
    h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Lanes so overlapping marks stack instead of hiding each other on the timeline. */
function lanes(marks: VideoMark[], duration: number) {
  const ends: number[] = [];
  return marks.map((m) => {
    const end = m.end ?? duration;
    let lane = ends.findIndex((e) => e <= m.start);
    if (lane < 0) lane = ends.length < 4 ? ends.length : ends.indexOf(Math.min(...ends));
    ends[lane] = end;
    return lane;
  });
}

/**
 * A recording with timed mark-up. In the viewer it is view-only: everyone sees the marks appear and disappear as it
 * plays. Marks are drawn only by the uploader on the local file before it goes up (pass `edit`): pause, draw (the
 * drawing shows from that moment on), play on, pause again and hide marks from there. The recording is never changed.
 */
export function VideoPlayer({
  src,
  poster,
  initialMarks,
  videoRef,
  edit,
  onState,
}: {
  src: string;
  poster?: string | null | undefined;
  initialMarks: VideoMark[];
  videoRef?: React.RefObject<HTMLVideoElement | null> | undefined;
  /** Local mark-up before upload: opens in edit mode and hands the marks back instead of saving them. */
  edit?:
    | {
        onDone: (marks: VideoMark[]) => void;
        onCancel: () => void;
        doneLabel?: string;
        note?: string;
      }
    | undefined;
  onState?: ((s: { editing: boolean; dirty: boolean }) => void) | undefined;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [marks, setMarksState] = useState<VideoMark[]>(initialMarks);
  const marksRef = useRef(marks);
  const [dirty, setDirty] = useState(false);
  // Preview plays the recording from the start with the marks, exactly as viewers will see it, before confirming.
  const [previewing, setPreviewing] = useState(false);
  const editing = !!edit && !previewing;
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]!);
  const [thick, setThick] = useState(false);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const draft = useRef<MarkShape | null>(null);
  const session = useRef<string | null>(null);
  const undone = useRef<{ mark: VideoMark; shape: MarkShape }[]>([]);

  const setMarks = (next: VideoMark[]) => {
    marksRef.current = next;
    setMarksState(next);
    setDirty(true);
  };
  useEffect(() => onState?.({ editing, dirty }), [editing, dirty, onState]);

  const draw = useCallback(() => {
    const v = video.current,
      c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!v || !c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(v.clientWidth * dpr),
      H = Math.round(v.clientHeight * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const r = frameRect(v);
    for (const m of marksAt(marksRef.current, v.currentTime))
      for (const s of m.shapes) paint(ctx, s, r.x, r.y, r.w, r.h);
    if (draft.current) paint(ctx, draft.current, r.x, r.y, r.w, r.h);
  }, []);
  useEffect(draw, [marks, t, draw, editing]);

  // Keep the overlay in step with playback: every decoded frame where supported, else every animation frame.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0,
      vfc = 0;
    const tick = () => {
      draw();
      const rv = v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (rv.requestVideoFrameCallback) vfc = rv.requestVideoFrameCallback(tick);
      else raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      setT(v.currentTime);
      setPaused(v.paused);
      draw();
    };
    const play = () => {
      session.current = null;
      setTextAt(null);
      sync();
    };
    const meta = () => {
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      draw();
    };
    const seeked = () => {
      session.current = null;
      sync();
    };
    v.addEventListener("timeupdate", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("play", play);
    v.addEventListener("seeked", seeked);
    v.addEventListener("loadedmetadata", meta);
    v.addEventListener("durationchange", meta);
    const ro = new ResizeObserver(draw);
    ro.observe(v);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      (
        v as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }
      ).cancelVideoFrameCallback?.(vfc);
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("play", play);
      v.removeEventListener("seeked", seeked);
      v.removeEventListener("loadedmetadata", meta);
      v.removeEventListener("durationchange", meta);
      ro.disconnect();
    };
  }, [draw]);

  const point = (e: React.PointerEvent) => {
    const v = video.current!,
      c = canvas.current!;
    const box = c.getBoundingClientRect();
    const r = frameRect(v);
    return {
      x: round(clamp((e.clientX - box.left - r.x) / r.w)),
      y: round(clamp((e.clientY - box.top - r.y) / r.h)),
    };
  };
  const stroke = thick ? 0.009 : 0.004;
  /** Adds a drawing to this pause's mark (created at the current moment on the first drawing). */
  function addShape(shape: MarkShape) {
    const v = video.current;
    if (!v) return;
    undone.current = [];
    const list = marksRef.current;
    const current = list.find((m) => m.id === session.current);
    if (current && current.shapes.length < 80) {
      setMarks(list.map((m) => (m.id === current.id ? { ...m, shapes: [...m.shapes, shape] } : m)));
      return;
    }
    if (list.length >= VIDEO_MARKS_MAX) {
      toast.error(`Up to ${VIDEO_MARKS_MAX} marks per recording.`);
      return;
    }
    const mark: VideoMark = {
      id: crypto.randomUUID(),
      start: round(v.currentTime),
      end: null,
      shapes: [shape],
    };
    session.current = mark.id;
    setMarks([...list, mark].sort((a, b) => a.start - b.start));
  }
  const erasing = useRef(false);
  /** Eraser: removes the drawing under the pointer from the marks showing now (newest first). */
  function eraseAt(e: React.PointerEvent) {
    const v = video.current,
      c = canvas.current;
    if (!v || !c) return;
    const box = c.getBoundingClientRect();
    const r = frameRect(v);
    const p = { x: e.clientX - box.left, y: e.clientY - box.top };
    const X = (x: number) => r.x + x * r.w,
      Y = (y: number) => r.y + y * r.h;
    const list = marksRef.current;
    const showing = marksAt(list, v.currentTime).reverse();
    for (const m of showing)
      for (let i = m.shapes.length - 1; i >= 0; i--) {
        const s = m.shapes[i]!;
        if (!hitShape(s, p, X, Y, s.type === "text" ? s.size * r.h : 0, 10)) continue;
        if (session.current === m.id && m.shapes.length === 1) session.current = null;
        setMarks(
          m.shapes.length === 1
            ? list.filter((x) => x.id !== m.id)
            : list.map((x) =>
                x.id === m.id ? { ...x, shapes: x.shapes.filter((_, j) => j !== i) } : x,
              ),
        );
        return;
      }
  }
  const down = (e: React.PointerEvent) => {
    if (!editing || !paused) return;
    if (tool === "eraser") {
      (e.target as Element).setPointerCapture(e.pointerId);
      erasing.current = true;
      eraseAt(e);
      return;
    }
    const p = point(e);
    if (tool === "text") {
      setTextAt(p);
      setText("");
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    draft.current =
      tool === "pen"
        ? { type: "pen", points: [p.x, p.y], color, width: stroke }
        : { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width: stroke };
    draw();
  };
  const move = (e: React.PointerEvent) => {
    if (erasing.current) return eraseAt(e);
    const d = draft.current;
    if (!d || d.type === "text") return;
    const p = point(e);
    if (d.type === "pen") {
      const n = d.points.length;
      if (n >= 3998 || Math.hypot(p.x - d.points[n - 2]!, p.y - d.points[n - 1]!) < 0.002) return;
      draft.current = { ...d, points: [...d.points, p.x, p.y] };
    } else draft.current = { ...d, x2: p.x, y2: p.y };
    draw();
  };
  const up = () => {
    erasing.current = false;
    const d = draft.current;
    draft.current = null;
    if (d) addShape(d);
    else draw();
  };
  const commitText = () => {
    if (textAt && text.trim())
      addShape({
        type: "text",
        x: textAt.x,
        y: textAt.y,
        text: text.trim().slice(0, 120),
        color,
        size: 0.045,
      });
    setTextAt(null);
    setText("");
  };
  function undo() {
    const list = marksRef.current;
    const m = list.find((x) => x.id === session.current);
    if (!m) return;
    const shape = m.shapes[m.shapes.length - 1]!;
    undone.current.push({ mark: m, shape });
    if (m.shapes.length === 1) {
      session.current = null;
      setMarks(list.filter((x) => x.id !== m.id));
    } else setMarks(list.map((x) => (x.id === m.id ? { ...x, shapes: x.shapes.slice(0, -1) } : x)));
  }
  function redo() {
    const last = undone.current.pop();
    if (!last) return;
    const list = marksRef.current;
    const m = list.find((x) => x.id === last.mark.id);
    session.current = last.mark.id;
    setMarks(
      m
        ? list.map((x) => (x.id === m.id ? { ...x, shapes: [...x.shapes, last.shape] } : x))
        : [...list, { ...last.mark, shapes: [last.shape] }].sort((a, b) => a.start - b.start),
    );
  }
  /** Hides a mark from now on: it ends here (or is removed when it would end where it starts). */
  function hideFromHere(id: string) {
    const now = round(video.current?.currentTime ?? t);
    const list = marksRef.current;
    if (session.current === id) session.current = null;
    setMarks(
      list.flatMap((m) => (m.id !== id ? [m] : now - m.start < 0.05 ? [] : [{ ...m, end: now }])),
    );
  }
  const remove = (id: string) => {
    if (session.current === id) session.current = null;
    setMarks(marksRef.current.filter((m) => m.id !== id));
  };
  const seek = (to: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(duration || to, to));
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  // Space plays and pauses while marking (not while typing a text mark).
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== " " || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      const v = video.current;
      if (!v) return;
      if (v.paused) void v.play();
      else v.pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);
  const startPreview = () => {
    const v = video.current;
    session.current = null;
    setTextAt(null);
    setPreviewing(true);
    if (!v) return;
    v.currentTime = 0;
    void v.play();
  };
  const backToMarking = () => {
    video.current?.pause();
    setPreviewing(false);
  };
  const visible = marksAt(marks, t);
  const laneOf = lanes(marks, duration);
  const showTimeline = duration > 0 && (marks.length > 0 || editing);
  const textStyle = (() => {
    const v = video.current;
    if (!textAt || !v) return {};
    const r = frameRect(v);
    return { left: r.x + textAt.x * r.w, top: r.y + textAt.y * r.h - 28 };
  })();
  return (
    <div className="bf-video-block" data-editing={editing || undefined}>
      <div className="bf-video-frame">
        <video
          ref={(el) => {
            video.current = el;
            if (videoRef) videoRef.current = el;
          }}
          src={src}
          poster={poster ?? undefined}
          controls
          autoPlay={!editing}
          preload="auto"
          playsInline
        />
        <canvas
          ref={canvas}
          className="bf-video-marks"
          data-draw={(editing && paused) || undefined}
          data-tool={tool}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-hidden={!editing}
          aria-label={editing ? "Drawing layer: pause the video, then draw" : undefined}
        />
        {textAt && (
          <input
            className="bf-annotate-text"
            style={textStyle}
            autoFocus
            value={text}
            maxLength={120}
            placeholder="Type, then Enter"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                commitText();
              }
              if (e.key === "Escape") setTextAt(null);
            }}
            onBlur={commitText}
          />
        )}
      </div>
      {showTimeline && (
        <div
          className="bf-video-timeline"
          role="group"
          aria-label="Marks on the timeline"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          {marks.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className="bf-video-timeline-mark"
              data-on={visible.includes(m) || undefined}
              style={{
                left: `${(m.start / duration) * 100}%`,
                width: `${Math.max(0.6, (((m.end ?? duration) - m.start) / duration) * 100)}%`,
                top: `${4 + laneOf[i]! * 7}px`,
                background: m.shapes[0]?.color,
              }}
              title={`Mark from ${clock(m.start)} to ${m.end === null ? "the end" : clock(m.end)}`}
              aria-label={`Go to the mark at ${clock(m.start)}`}
              onClick={(e) => {
                e.stopPropagation();
                seek(m.start + 0.01);
              }}
            />
          ))}
          <span className="bf-video-playhead" style={{ left: `${(t / duration) * 100}%` }} />
        </div>
      )}
      {!editing && marks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {marks.length} timed {marks.length === 1 ? "mark" : "marks"} from the uploader · they show
          while the video plays
        </p>
      )}
      {edit && previewing && (
        <div className="bf-video-editor">
          <div className="bf-annotate-save">
            <span className="flex-1 text-xs text-muted-foreground">
              Preview: the recording plays with your {marks.length}{" "}
              {marks.length === 1 ? "mark" : "marks"}, exactly as others will see it.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={backToMarking}>
              <PenLine />
              Back to marking
            </Button>
            <Button type="button" size="sm" onClick={() => edit.onDone(marksRef.current)}>
              <Save />
              {edit.doneLabel ?? "Use these marks"}
            </Button>
          </div>
        </div>
      )}
      {editing && (
        <div className="bf-video-editor">
          <div className="bf-annotate-tools" role="toolbar" aria-label="Drawing tools">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggle}
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? <Play /> : <Pause />}
              {clock(t)}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => seek(t - 1)}>
              −1s
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => seek(t + 1)}>
              +1s
            </Button>
            <div className="bf-mode" role="radiogroup" aria-label="Tool">
              {TOOLS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={tool === x.id}
                  onClick={() => setTool(x.id)}
                >
                  <x.icon size={14} />
                  {x.label}
                </button>
              ))}
            </div>
            <div className="bf-annotate-colors" role="radiogroup" aria-label="Colour">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <label className="bf-switch-row text-xs">
              <input type="checkbox" checked={thick} onChange={(e) => setThick(e.target.checked)} />{" "}
              Thick
            </label>
            <span className="ml-auto flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!session.current}
                onClick={undo}
              >
                <Undo2 />
                Undo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!undone.current.length}
                onClick={redo}
              >
                <Redo2 />
                Redo
              </Button>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {paused
              ? "Paused: draw on the video. Drawings show from this moment until you hide them at a later pause. Space plays."
              : "Playing: press Space or the pause button where you want to draw or hide marks."}
          </p>
          {visible.length > 0 && (
            <ul className="bf-video-mark-list" aria-label="Marks showing now">
              {visible.map((m) => (
                <li key={m.id}>
                  <span className="bf-video-mark-dot" style={{ background: m.shapes[0]?.color }} />
                  <span className="min-w-0 flex-1 truncate">
                    From {clock(m.start)} {m.end !== null ? `to ${clock(m.end)}` : "to the end"} ·{" "}
                    {m.shapes.length} {m.shapes.length === 1 ? "drawing" : "drawings"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => hideFromHere(m.id)}
                  >
                    <EyeOff />
                    Hide from here
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(m.id)}
                    aria-label={`Delete the mark from ${clock(m.start)}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              {visible.length > 1 && (
                <li>
                  <span className="flex-1" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => visible.forEach((m) => hideFromHere(m.id))}
                  >
                    <EyeOff />
                    Hide all from here
                  </Button>
                </li>
              )}
            </ul>
          )}
          <div className="bf-annotate-save">
            <span className="flex-1 text-xs text-muted-foreground">
              {marks.length} {marks.length === 1 ? "mark" : "marks"} ·{" "}
              {edit?.note ?? "saved with the recording when it is uploaded"}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={edit?.onCancel}>
              <X />
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!marks.length}
              title="Play from the start with your marks before confirming"
              onClick={startPreview}
            >
              <Eye />
              Preview
            </Button>
            <Button type="button" size="sm" onClick={() => edit?.onDone(marksRef.current)}>
              <Save />
              {edit?.doneLabel ?? "Use these marks"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
