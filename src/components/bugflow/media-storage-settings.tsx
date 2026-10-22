import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { BookOpen, ChevronDown, LoaderCircle, PlugZap, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMediaStatus } from '@/lib/bug-media.functions';
import { formatBytes } from '@/lib/bug-media';
import { ErrorNotice, actionError } from './action-feedback';

const VARS = ['MEDIA_S3_ENDPOINT', 'MEDIA_S3_BUCKET', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY'];
const FREE_TIER = 10 * 1024 * 1024 * 1024;

/** Settings → Connected services → Media storage: honest state from the environment and our own rows, a real round trip on request, and the R2 setup guide. */
export function MediaStorageCard() {
  const read = useServerFn(getMediaStatus);
  const q = useQuery({ queryKey: ['media-status'], queryFn: () => read({ data: { test: false } }), staleTime: 60000, retry: false });
  const test = useMutation({ mutationFn: () => read({ data: { test: true } }) });
  const s = test.data ?? q.data; const [guide, setGuide] = useState(false);
  const origin = typeof window === 'undefined' ? 'https://your-app.vercel.app' : window.location.origin;
  const state = !s ? 'loading' : !s.configured ? 'off' : s.test?.ok ? 'ok' : s.test ? 'bad' : 'untested';
  const tag = state === 'loading' ? '…' : state === 'off' ? 'Not connected' : state === 'ok' ? 'Connected' : state === 'bad' ? 'Not reachable' : 'Configured · not tested';
  const tone = state === 'ok' ? 'text-success' : state === 'bad' ? 'text-destructive' : state === 'untested' ? 'text-warning' : '';
  const showGuide = guide || state === 'off';
  return <>
    <div className="bf-setting-row"><span className="bf-stat-icon bf-tone-info"><Upload size={19} /></span><div><h3>Media storage</h3>
      <p>Private screenshots, recordings and PDFs on a bug, in your own S3-compatible bucket (Cloudflare R2 free tier recommended: 10 GB, no egress fees).<br />
        {state === 'off' && 'Uploads are hidden until the bucket is connected. Drive links keep working.'}
        {state === 'untested' && `${s!.provider} · bucket ${s!.bucket} at ${s!.endpointHost}. Variables are set, so uploads are on — run Test connection to confirm the bucket answers.`}
        {state === 'ok' && `${s!.provider} · bucket ${s!.bucket} · ${s!.test!.message}`}
        {state === 'bad' && `${s!.provider} · bucket ${s!.bucket} · ${s!.test!.message} Uploads will fail until this is fixed.`}
        {s && s.configured && <> {s.files} {s.files === 1 ? 'file' : 'files'} · {formatBytes(s.bytes)} of the {formatBytes(FREE_TIER)} R2 free tier{s.pending > 0 && ` · ${s.pending} uploading`}{s.awaitingPurge > 0 && ` · ${s.awaitingPurge} awaiting purge`}</>}
      </p></div><span className={`bf-tag ${tone}`}>{tag}</span></div>
    {q.isError && <ErrorNotice message={actionError(q.error, 'Media storage status could not be read.')} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />}
    {s && <div className="bf-media-guide">
      {!s.configured && <div><p className="mb-2 text-xs text-muted-foreground">Missing environment variables:</p><div className="bf-media-missing">{s.missing.map(v => <code key={v}>{v}</code>)}</div></div>}
      <div className="flex flex-wrap items-center gap-2">
        {s.configured && <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <LoaderCircle className="animate-spin" /> : <PlugZap />}{s.awaitingPurge > 0 ? 'Test connection & purge' : 'Test connection'}</Button>}
        {s.configured && <Button size="sm" variant="ghost" onClick={() => setGuide(g => !g)}><BookOpen />Setup guide<ChevronDown className={showGuide ? 'rotate-180' : ''} /></Button>}
        {test.isError && <span className="text-xs text-destructive">{actionError(test.error, 'The test could not run.')}</span>}
      </div>
      {showGuide && <ol>
        <li><strong>Create a private bucket</strong> in Cloudflare → R2 Object Storage → Create bucket (for example <code>bugboard-media</code>). Leave public access off; never use an r2.dev domain.</li>
        <li><strong>Create an API token</strong> under R2 → Manage R2 API Tokens: permission <em>Object Read &amp; Write</em>, scoped to that bucket. Copy the Access Key ID, the Secret Access Key and the S3 endpoint <code>https://&lt;ACCOUNT_ID&gt;.r2.cloudflarestorage.com</code>.</li>
        <li><strong>Set the variables</strong> {VARS.map((v, i) => <span key={v}>{i > 0 && ', '}<code>{v}</code></span>)} in <code>.env.local</code> and in Vercel (Production and Preview), then redeploy. Backblaze B2 or AWS S3 work with the same four values (set <code>MEDIA_S3_REGION</code> for those).</li>
        <li><strong>Allow browser uploads</strong>: bucket → Settings → CORS policy, add this rule (uploads go straight from the browser to the bucket):
          <pre>{JSON.stringify([{ AllowedOrigins: [origin], AllowedMethods: ['PUT', 'GET'], AllowedHeaders: ['content-type', 'if-none-match'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }], null, 2)}</pre></li>
        <li><strong>Test</strong>: come back here and press <em>Test connection</em>, then attach a screenshot to any bug. Files stay private: every view uses a 10-minute signed link minted after the usual bug permission check.</li>
      </ol>}
    </div>}
  </>;
}
