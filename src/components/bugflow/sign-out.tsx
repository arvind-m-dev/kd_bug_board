import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lockAdminAccess } from "@/lib/portal-access.functions";
import { ConfirmAction } from "./action-feedback";
import { forgetWorkspaceAccess } from "@/lib/admin-route-access";

export function SignOutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const router = useRouter();
  const lock = useServerFn(lockAdminAccess);
  async function signOut() {
    await lock();
    forgetWorkspaceAccess();
    await client.cancelQueries();
    client.clear();
    await router.navigate({ to: "/login", replace: true });
    await router.invalidate();
  }
  return (
    <>
      <Button variant="ghost" size="sm" className={className} onClick={() => setOpen(true)}>
        <LogOut size={16} />
        Sign out
      </Button>
      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
        title="Sign out of Futurist Global Bug Board?"
        description="You’ll return to the sign-in page. Any unsaved changes or unshared portal links will be lost. Saved members and projects will stay unchanged."
        confirmLabel="Sign out"
        onConfirm={signOut}
      />
    </>
  );
}
