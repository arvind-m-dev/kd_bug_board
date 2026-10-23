import { useSyncExternalStore } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Phones: toasts bottom-centre, clear of the floating bin and the home bar. Desktop: bottom-right, above the bin.
const NARROW = "(max-width: 640px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useNarrow = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );

const Toaster = ({ ...props }: ToasterProps) => {
  const narrow = useNarrow();
  return (
    <Sonner
      position={narrow ? "bottom-center" : "bottom-right"}
      offset={{ bottom: 88, right: 22 }}
      mobileOffset={{ bottom: 16, left: 12, right: 12 }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
