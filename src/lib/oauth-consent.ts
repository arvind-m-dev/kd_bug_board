/** Self-contained consent page for the OAuth authorize step. No app bundle: inline HTML/CSS/JS, dark by default, escapes all input. */
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function consentPage(p: { clientName: string; params: Record<string, string>; error?: string }) {
  const hidden = Object.entries(p.params).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const who = p.clientName ? esc(p.clientName) : 'An AI client';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Bug Board</title>
<style>
:root{color-scheme:dark;--bg:#13111c;--card:#1d1b2a;--line:#312e45;--fg:#eceaf5;--mut:#a7a3c0;--pri:#8b7cf6;--err:#f1707a}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(60% 50% at 50% 0%,#262042,transparent),var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;padding:24px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 24px 60px -20px #000a}
h1{font-size:19px;margin:0 0 4px}p.sub{color:var(--mut);margin:0 0 20px;font-size:13.5px}
.tabs{display:flex;gap:6px;margin-bottom:16px}.tabs button{flex:1;padding:8px;border:1px solid var(--line);background:transparent;color:var(--mut);border-radius:10px;cursor:pointer;font:inherit;font-size:13px}
.tabs button[aria-selected=true]{background:var(--pri);border-color:var(--pri);color:#fff;font-weight:600}
label{display:block;font-size:12.5px;color:var(--mut);margin:12px 0 5px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#15131f;color:var(--fg);font:inherit}
input:focus{outline:2px solid color-mix(in oklab,var(--pri) 55%,transparent);border-color:var(--pri)}
button.go{width:100%;margin-top:20px;padding:11px;border:0;border-radius:10px;background:var(--pri);color:#fff;font:inherit;font-weight:700;cursor:pointer}
button.go:hover{filter:brightness(1.08)}.err{background:color-mix(in oklab,var(--err) 16%,var(--card));border:1px solid color-mix(in oklab,var(--err) 45%,var(--line));color:var(--err);padding:9px 11px;border-radius:10px;font-size:13px;margin-bottom:14px}
.hide{display:none}.foot{margin-top:16px;font-size:11.5px;color:var(--mut);text-align:center}
</style></head><body><form class="card" method="post" action="/api/oauth/authorize">
<h1>Connect to Bug Board</h1><p class="sub">${who} wants to read and report bugs on your behalf. Sign in to approve, or close this window to deny.</p>
${p.error ? `<div class="err">${esc(p.error)}</div>` : ''}
${hidden}
<div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-m="admin">Admin</button><button type="button" role="tab" aria-selected="false" data-m="portal">Member portal</button></div>
<input type="hidden" name="login_kind" value="admin">
<div data-pane="admin"><label>Admin email</label><input name="email" type="email" autocomplete="username" autofocus><label>Admin password</label><input name="password" type="password" autocomplete="current-password"></div>
<div data-pane="portal" class="hide"><label>Your portal link</label><input name="portal_url" type="url" placeholder="https://…/member/…" autocomplete="off"><p class="foot" style="text-align:left">Paste the private portal link your Admin shared with you.</p></div>
<button class="go" type="submit">Approve access</button>
<p class="foot">You can revoke this connection any time in Settings, AI access.</p>
<script>
var kind=document.querySelector('[name=login_kind]');
document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.tabs button').forEach(function(x){x.setAttribute('aria-selected', x===b);});
  var m=b.dataset.m; kind.value=m;
  document.querySelector('[data-pane=admin]').classList.toggle('hide',m!=='admin');
  document.querySelector('[data-pane=portal]').classList.toggle('hide',m!=='portal');
};});
</script></form></body></html>`;
}
/** Pulls the token+type out of a pasted portal URL like https://host/member/<64hex>. */
export function parsePortalUrl(url: string): { token: string; type: string } | null {
  try { const m = new URL(url.trim()).pathname.match(/^\/(reporter|qa|developer|member)\/([a-f0-9]{64})\/?$/); return m ? { type: m[1]!, token: m[2]! } : null; } catch { return null; }
}
