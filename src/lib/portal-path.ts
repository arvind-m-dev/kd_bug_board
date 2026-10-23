/** The member portal a path belongs to (/qa/<token>/…), so error pages lead back there and never to the Admin panel. */
export function portalHome(pathname: string): string | null {
  const m = pathname.match(/^\/(reporter|qa|developer|member)\/([^/?#]+)/);
  return m ? `/${m[1]}/${m[2]}` : null;
}
