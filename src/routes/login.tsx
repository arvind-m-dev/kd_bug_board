import { createFileRoute, redirect } from "@tanstack/react-router";
import { BrandMark } from "@/components/bugflow/decorations";
import { AdminAccess } from "@/components/bugflow/admin-access";
import { getAdminStatus } from "@/lib/portal-access.functions";
import { pageHead } from "@/lib/bugflow";

export const Route = createFileRoute("/login")({
  head: () =>
    pageHead(
      "Admin sign in",
      "Sign in securely to your Futurist Global Bug Board Admin workspace.",
    ),
  beforeLoad: async () => {
    if ((await getAdminStatus()).unlocked) throw redirect({ to: "/admin", replace: true });
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="bf-login min-h-screen bg-background flex flex-col items-center justify-center px-5 py-12">
      <div className="flex items-center gap-2 text-2xl font-bold mb-8">
        <span className="bf-logo">
          <BrandMark />
        </span>
        Futurist Global Bug Board<span className="text-primary">.</span>
      </div>
      <div className="w-full max-w-md">
        <AdminAccess signInPage />
      </div>
    </main>
  );
}
