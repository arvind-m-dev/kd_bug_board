import { describe, expect, it } from 'vitest';
import { MEDIA_MAX_BYTES, clock, downloadName, formatBytes, mayDeleteMedia, mayUploadMedia, mediaKey, mediaLinkPath, prepareMediaSchema, providerName, rejectReason, renameMediaSchema, resolveContentType, safeFileName } from '@/lib/bug-media';

const admin = { userId: 'a', role: 'admin', permissions: [] as string[] };
const reporter = { userId: 'r', role: 'reporter', permissions: ['view', 'report', 'evidence'] };
const dev = { userId: 'd', role: 'developer', permissions: ['view', 'progress', 'evidence'] };
const qa = { userId: 'q', role: 'qa', permissions: ['view', 'validate', 'verify'] };
const bug = { reporterId: 'r', status: 'IN_PROGRESS', assigneeId: 'd', assignees: [{ id: 'd' }, { id: 'c' }] };

describe('media rules', () => {
  it('object keys come from ids and the whitelist, never the filename', () => {
    expect(mediaKey('42', '0f9b2e4a-2b1c-4b2a-9f1e-0123456789ab', 'image/jpeg')).toBe('bugs/42/0f9b2e4a-2b1c-4b2a-9f1e-0123456789ab.jpg');
    expect(safeFileName('../..\\evil\u0000name   .png')).toBe('.. .. evil name .png'.replace(/^\.+/, ''));
    expect(safeFileName('   ')).toBe('file'); expect(safeFileName('x'.repeat(300))).toHaveLength(140);
  });
  it('resolves the upload type with an extension fallback and refuses what browsers cannot handle', () => {
    expect(resolveContentType('shot.PNG', '')).toBe('image/png'); expect(resolveContentType('a.jpg', 'image/jpg')).toBe('image/jpeg');
    expect(resolveContentType('a.svg', 'image/svg+xml')).toBeNull(); expect(resolveContentType('a.png', 'text/html')).toBeNull();
    expect(rejectReason('IMG_1.heic', 'image/heic', 100)).toMatch(/HEIC/); expect(rejectReason('clip.mov', 'video/quicktime', 100)).toMatch(/MP4/);
    expect(rejectReason('page.html', 'text/html', 100)).toMatch(/Only PNG/); expect(rejectReason('big.mp4', 'video/mp4', MEDIA_MAX_BYTES + 1)).toMatch(/Too large/);
    expect(rejectReason('big.png', 'image/png', MEDIA_MAX_BYTES * 3)).toBeNull(); // images are compressed first
    expect(rejectReason('ok.pdf', 'application/pdf', 10)).toBeNull();
  });
  it('upload: admin always; reporter, assignees and QA on open bugs only', () => {
    expect(mayUploadMedia(admin, { ...bug, status: 'RESOLVED' })).toBe(true);
    expect(mayUploadMedia(reporter, bug)).toBe(true); expect(mayUploadMedia(reporter, { ...bug, status: 'RESOLVED' })).toBe(false);
    expect(mayUploadMedia(dev, bug)).toBe(true); expect(mayUploadMedia({ ...dev, userId: 'c' }, bug)).toBe(true);
    expect(mayUploadMedia({ ...dev, userId: 'z' }, bug)).toBe(false); expect(mayUploadMedia({ ...dev, permissions: ['view'] }, bug)).toBe(false);
    expect(mayUploadMedia(qa, bug)).toBe(true);
  });
  it('delete: admin or the uploader', () => {
    expect(mayDeleteMedia(admin, { uploadedById: 'r' })).toBe(true); expect(mayDeleteMedia(reporter, { uploadedById: 'r' })).toBe(true); expect(mayDeleteMedia(dev, { uploadedById: 'r' })).toBe(false);
  });
  it('schemas are strict and bounded', () => {
    expect(prepareMediaSchema.safeParse({ bugId: '7', id: '0f9b2e4a-2b1c-4b2a-9f1e-0123456789ab', name: 'a.png', contentType: 'image/png', size: 10 }).success).toBe(true);
    expect(prepareMediaSchema.safeParse({ bugId: '7', id: 'nope', name: 'a.png', contentType: 'image/png', size: 10 }).success).toBe(false);
    expect(prepareMediaSchema.safeParse({ bugId: '7', id: '0f9b2e4a-2b1c-4b2a-9f1e-0123456789ab', name: 'a.svg', contentType: 'image/svg+xml', size: 10 }).success).toBe(false);
    expect(prepareMediaSchema.safeParse({ bugId: '7', id: '0f9b2e4a-2b1c-4b2a-9f1e-0123456789ab', name: 'a.png', contentType: 'image/png', size: MEDIA_MAX_BYTES + 1 }).success).toBe(false);
  });
  it('formats sizes and names providers', () => {
    expect(formatBytes(900)).toBe('900 B'); expect(formatBytes(300 * 1024)).toBe('300 KB'); expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(providerName('https://abc.r2.cloudflarestorage.com')).toBe('Cloudflare R2'); expect(providerName('https://s3.us-west-004.backblazeb2.com')).toBe('Backblaze B2'); expect(providerName('')).toBe('');
  });
});

describe('prepareMediaSchema bug ids', () => {
  const base = { id: '6f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f', name: 'shot.png', contentType: 'image/png', size: 10 };
  it('accepts canonical ids and rejects zero-padded ones (keys must match the bigint bug_id)', () => {
    expect(prepareMediaSchema.safeParse({ ...base, bugId: '12' }).success).toBe(true);
    expect(prepareMediaSchema.safeParse({ ...base, bugId: '00012' }).success).toBe(false);
    expect(prepareMediaSchema.safeParse({ ...base, bugId: '0' }).success).toBe(false);
  });
});

describe('media names and links', () => {
  it('download names always carry the right extension', () => {
    expect(downloadName('login screen', 'image/png')).toBe('login screen.png');
    expect(downloadName('shot.PNG', 'image/png')).toBe('shot.PNG');
    expect(downloadName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(downloadName('clip at 0:42', 'video/mp4')).toBe('clip at 0:42.mp4');
  });
  it('formats recording positions as m:ss and builds in-app links', () => {
    expect(clock(0)).toBe('0:00'); expect(clock(61.4)).toBe('1:01'); expect(clock(3599)).toBe('59:59');
    expect(mediaLinkPath('12')).toBe('/media/12'); expect(mediaLinkPath('12', 'abc')).toBe('/media/12?m=abc');
  });
  it('accepts lineage on prepare and bounds rename', () => {
    const base = { bugId: '12', id: '6f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f', name: 'frame', contentType: 'image/png', size: 10 };
    expect(prepareMediaSchema.parse(base)).toMatchObject({ derivedFrom: null, atSeconds: null });
    expect(prepareMediaSchema.safeParse({ ...base, derivedFrom: '7f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f', atSeconds: 42.5 }).success).toBe(true);
    expect(prepareMediaSchema.safeParse({ ...base, derivedFrom: 'nope' }).success).toBe(false);
    expect(renameMediaSchema.safeParse({ id: base.id, name: '  ' }).success).toBe(false);
    expect(renameMediaSchema.safeParse({ id: base.id, name: 'x'.repeat(121) }).success).toBe(false);
    expect(renameMediaSchema.parse({ id: base.id, name: ' Login error ' }).name).toBe('Login error');
  });
});
