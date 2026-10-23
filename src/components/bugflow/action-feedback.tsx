import { useState } from "react";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export function actionError(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message;
  if (
    !message ||
    message.length > 300 ||
    /sql|postgres|stack|connector|gateway|fetch|network|internal server|unexpected token|<!doctype/i.test(
      message,
    )
  )
    return fallback;
  return message;
}

export function ErrorNotice({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <CircleAlert size={17} className="shrink-0" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
          <RefreshCw className={retrying ? "animate-spin" : ""} />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      setError(actionError(cause, "This action could not be completed. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setError("");
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent
        className="w-[calc(100%-2rem)] max-w-md"
        // Clicking outside cancels, like every other modal; never while the action is running.
        onBackdropClick={() => {
          if (busy) return;
          setError("");
          onOpenChange(false);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <ErrorNotice message={error} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={confirm}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {busy ? "Please wait…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
