import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isAdminSessionError } from "./lib/portal-access";
import { forgetWorkspaceAccess, safeReturnPath } from "./lib/admin-route-access";
import { clearQueryCache } from "./lib/query-cache";

export const getRouter = () => {
  // An Admin session that ended elsewhere (sign-out in another tab, 8-hour expiry, revocation) sends the person
  // back to sign-in with this page as the return path, instead of leaving error cards on every panel.
  let leaving = false;
  const onError = (error: unknown) => {
    if (leaving || typeof window === "undefined" || !isAdminSessionError(error)) return;
    const here = window.location.pathname;
    if (here !== "/admin" && !here.startsWith("/admin/")) return;
    leaving = true;
    forgetWorkspaceAccess();
    clearQueryCache();
    const back = safeReturnPath(here + window.location.search);
    // Same order as sign-out: nothing from the ended session stays in memory for the next person.
    void (async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await router.navigate({
        to: "/login",
        search: back ? { redirect: back } : {},
        replace: true,
      });
      await router.invalidate();
    })().finally(() => {
      leaving = false;
    });
  };
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPreload: "intent",
  });

  return router;
};
