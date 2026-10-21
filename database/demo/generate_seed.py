"""Generate database/demo/seed.sql: removable demo team, project and bug history.

Everything demo is tagged so database/demo/remove.sql can delete it without touching real data:
  * people use @demo.bugboard.test emails and ids starting de300000-
  * bugs live only in the "Demo · Customer Portal" project (de300000-0000-4000-8000-000000000001)
Times are relative to now() when the seed is applied, spread over the last 60 days.
Run: python3 database/demo/generate_seed.py > database/demo/seed.sql
"""
import json
import random

rng = random.Random(42)
PROJECT = 'de300000-0000-4000-8000-000000000001'

# (slug, name, portal role, designation, real?) — real people are existing accounts, looked up by name at seed time;
# only their activity on demo bugs is added (and removed by remove.sql). Everyone else is a removable demo member.
PEOPLE = [
    ('jenith', 'jenith', 'qa', 'QA tester / developer', True),
    ('arvind', 'Arvind', 'admin', 'QA tester / developer', True),
    ('stephen', 'stephen', 'qa', 'QA tester / developer', True),
    ('krishna', 'Krishna', 'developer', 'Developer', False),
    ('shathish', 'Shathish', 'developer', 'Developer', False),
    ('faisal', 'Faisal Ahmed', 'developer', 'Backend developer', False),
    ('patrik', 'Patrik', 'developer', 'DevOps engineer', False),
    ('john', 'John A', 'qa', 'QA engineer', False),
    ('divya', 'Divya Krishnan', 'qa', 'QA engineer', False),
    ('pradeepa', 'Pradeepa', 'other', 'Product manager', False),
    ('nisha', 'Nisha Varma', 'other', 'UI/UX designer', False),
    ('rohan', 'Rohan Mehta', 'tester', 'Client · UAT (Acme Retail)', False),
    ('lakshmi', 'Lakshmi Venkat', 'tester', 'Client · UAT (Acme Retail)', False),
]
PORTAL_TYPE = {'tester': 'reporter', 'developer': 'developer', 'qa': 'qa', 'other': 'member'}
PERMISSIONS = {
    'tester': ['view', 'view_all', 'report', 'comment', 'evidence'],
    'developer': ['view', 'view_all', 'report', 'comment', 'evidence', 'progress', 'recheck', 'disposition'],
    'qa': ['view', 'view_all', 'report', 'comment', 'evidence', 'validate', 'assign', 'verify'],
    'other': ['view', 'view_all', 'report', 'comment', 'evidence'],
}
REAL = {slug for slug, *_, real in PEOPLE if real}
uid = {slug: f'de300000-0000-4000-8000-1000000000{i:02d}' for i, (slug, *_rest) in enumerate(PEOPLE, 1)}
pid = {slug: f'de300000-0000-4000-8000-2000000000{i:02d}' for i, (slug, *_rest) in enumerate(PEOPLE, 1)}


def ref(slug):
    """SQL reference to a person: a variable for real accounts, a literal id for demo members."""
    return f'u_{slug}' if slug in REAL else "'" + uid[slug] + "'"


# Who does what. Real QA testers/devs both raise and fix; clients and the designer raise; the PM makes product calls.
reporters = ['jenith'] * 3 + ['arvind'] * 2 + ['stephen'] * 3 + ['john'] * 3 + ['divya'] * 2 + ['rohan'] * 3 + ['lakshmi'] * 2 + ['nisha', 'pradeepa']
qas = ['john'] * 3 + ['divya'] * 2 + ['stephen'] * 2 + ['jenith', 'arvind']
devs = ['krishna'] * 4 + ['shathish'] * 4 + ['faisal'] * 3 + ['jenith', 'arvind', 'stephen']
INFRA_MODULES = {'Performance', 'Admin'}  # DevOps picks these up

BUGS = [  # (module, title, description, expected, actual)
    ('Login', 'OTP screen accepts an expired code', 'Entering an OTP older than 5 minutes still signs the user in.', 'Expired codes are rejected with a clear message.', 'The user is signed in.'),
    ('Login', 'Remember-me logs out after browser restart', 'Ticking "Remember me" has no effect after closing Chrome.', 'Session persists for 30 days.', 'User is asked to sign in again.'),
    ('Login', 'Password reset email arrives twice', 'Requesting a reset sends two identical emails.', 'One email per request.', 'Two emails arrive within seconds.'),
    ('Checkout', 'Coupon discount applied twice on refresh', 'Refreshing the review step re-applies the coupon.', 'Discount is applied once.', 'Total is reduced twice.'),
    ('Checkout', 'Pay button stays disabled after fixing card number', 'Correcting an invalid card number does not re-enable Pay.', 'Pay enables when the form is valid.', 'Pay remains disabled.'),
    ('Checkout', 'Shipping cost missing for Kerala pincodes', 'Pincodes starting 68 show ₹0 shipping.', 'Correct shipping fee is shown.', 'Shipping shows ₹0.'),
    ('Checkout', 'Order summary overlaps on iPhone SE', 'The sticky summary covers the address form on small screens.', 'Summary sits below the form.', 'Summary overlaps the inputs.'),
    ('Payments', 'UPI payment shows failed but money is debited', 'UPI callback times out and order is marked failed.', 'Order reflects the successful payment.', 'Order shows failed; amount debited.'),
    ('Payments', 'Refund amount rounds down by ₹1', 'Refunds of odd paise amounts lose ₹1.', 'Exact amount refunded.', '₹1 less refunded.'),
    ('Payments', 'Saved cards list shows deleted card', 'A removed card still appears until logout.', 'Removed card disappears immediately.', 'Card remains visible.'),
    ('Dashboard', 'Revenue chart ignores selected date range', 'Changing the range keeps showing last 7 days.', 'Chart follows the selected range.', 'Chart does not change.'),
    ('Dashboard', 'Widgets reorder after every reload', 'Custom widget order is lost on reload.', 'Saved order persists.', 'Default order returns.'),
    ('Dashboard', 'KPI tiles show NaN for new accounts', 'Accounts with no orders show NaN% growth.', 'Shows 0% or a dash.', 'Shows NaN%.'),
    ('Profile', 'Avatar upload fails for PNG over 2 MB', 'Uploading a 2.5 MB PNG shows a generic error.', 'Image is compressed or a size message is shown.', 'Generic "Something went wrong".'),
    ('Profile', 'Phone number field rejects +91 prefix', 'Entering +91 98765 43210 shows invalid number.', 'International format is accepted.', 'Validation error.'),
    ('Profile', 'Language switch does not translate menu', 'Switching to Hindi leaves the side menu in English.', 'All navigation is translated.', 'Menu stays in English.'),
    ('Search', 'Search returns no results for lowercase SKU', 'Searching "sku-1042" finds nothing; "SKU-1042" works.', 'Search is case-insensitive.', 'No results.'),
    ('Search', 'Filters reset when paging results', 'Moving to page 2 clears the brand filter.', 'Filters persist across pages.', 'Filters are cleared.'),
    ('Search', 'Autocomplete lags by one keystroke', 'Suggestions reflect the previous input.', 'Suggestions match current text.', 'Suggestions are one character behind.'),
    ('Notifications', 'Push notification opens the wrong order', 'Tapping an order notification opens the latest order instead.', 'The referenced order opens.', 'Latest order opens.'),
    ('Notifications', 'Email digest sent at 3 AM IST', 'Daily digest time ignores the user time zone.', 'Sent at 9 AM local time.', 'Sent at 3 AM IST.'),
    ('Notifications', 'Unread badge never clears on mobile', 'Badge count stays after reading all notifications.', 'Badge clears.', 'Badge shows the old count.'),
    ('Reports', 'CSV export cuts off at 1,000 rows', 'Exporting 2,400 orders produces 1,000 rows.', 'All rows are exported.', 'Only 1,000 rows.'),
    ('Reports', 'PDF invoice shows wrong GST number', 'Invoices print the previous GSTIN after update.', 'Current GSTIN is printed.', 'Old GSTIN appears.'),
    ('Reports', 'Monthly report totals differ from dashboard', 'October totals differ by ₹12,340.', 'Totals match.', 'Totals differ.'),
    ('Cart', 'Cart badge counts removed items', 'Removing an item keeps the badge count unchanged.', 'Badge updates immediately.', 'Badge is stale.'),
    ('Cart', 'Quantity stepper allows 0', 'Clicking minus at 1 sets quantity to 0 without removing.', 'Item is removed or minimum is 1.', 'Quantity shows 0.'),
    ('Cart', 'Out-of-stock item can still be checked out', 'Stock check happens only on the product page.', 'Checkout blocks out-of-stock items.', 'Order is placed.'),
    ('Orders', 'Cancel order button visible after dispatch', 'Dispatched orders still show Cancel.', 'Cancel hidden once dispatched.', 'Cancel is visible.'),
    ('Orders', 'Tracking link opens 404 page', 'Courier tracking URL is missing the AWB number.', 'Tracking page opens.', '404 Not Found.'),
    ('Orders', 'Order history sorted oldest first', 'Order history shows 2023 orders at the top.', 'Newest first.', 'Oldest first.'),
    ('Admin', 'Bulk price update times out over 500 SKUs', 'Updating 600 SKUs fails after 30 seconds.', 'Update completes in the background.', 'Request times out.'),
    ('Admin', 'Role change needs logout to apply', 'Granting the manager role has no effect until re-login.', 'Permissions apply immediately.', 'Old permissions remain.'),
    ('Admin', 'Audit log missing IP address', 'Audit entries show "—" for IP.', 'Client IP is recorded.', 'IP is empty.'),
    ('Accessibility', 'Modal traps focus behind overlay', 'Tab moves focus to elements behind the open dialog.', 'Focus stays inside the dialog.', 'Focus escapes.'),
    ('Accessibility', 'Error messages not announced by screen readers', 'Form errors are not in a live region.', 'Errors are announced.', 'Silent.'),
    ('Performance', 'Product list takes 6 s on 3G', 'Initial load downloads 4 MB of images.', 'Under 2.5 s with lazy loading.', '6 s load.'),
    ('Performance', 'Memory grows on infinite scroll', 'Scrolling 500 products uses 1.2 GB.', 'Memory stays stable.', 'Tab crashes on low-end phones.'),
    ('Login', 'Google sign-in button misaligned on Safari', 'The Google button sits 4 px lower than the email button.', 'Buttons align.', 'Misaligned.'),
    ('Checkout', 'Address autocomplete suggests other cities', 'Typing "Koramangala" suggests results from Chennai.', 'Suggestions are local.', 'Wrong city suggestions.'),
    ('Dashboard', 'Dark mode chart labels unreadable', 'Axis labels are dark grey on navy.', 'Labels meet contrast.', 'Hard to read.'),
    ('Profile', 'Delete account leaves saved addresses', 'After deletion, addresses remain in the database export.', 'All personal data removed.', 'Addresses remain.'),
]
DEVICES = ['Chrome 129 · Windows 11', 'Safari 18 · iPhone 15', 'Chrome · Pixel 8', 'Firefox 131 · macOS', 'Edge · Windows 10', 'Samsung Internet · Galaxy S23']
ENVS = ['Staging', 'Staging', 'Production', 'Development']
SEVERITY_BY_PRIORITY = {'P0': ['Critical', 'Critical', 'High'], 'P1': ['High', 'Critical', 'High'], 'P2': ['High', 'Medium'], 'P3': ['Medium', 'Medium', 'Low'], 'P4': ['Low', 'Medium'], 'P5': ['Low']}
PRIORITY_POOL = ['P0'] * 3 + ['P1'] * 6 + ['P2'] * 9 + ['P3'] * 10 + ['P4'] * 6 + ['P5'] * 3
# Final status mix: mostly flowing work, some resolved, a few rejections.
FINAL = (['RESOLVED'] * 11 + ['IN_PROGRESS'] * 5 + ['RECHECK'] * 4 + ['ASSIGNED'] * 4 + ['REOPENED'] * 3 + ['NEW'] * 3
         + ['VALIDATING'] * 2 + ['READY_FOR_ASSIGNMENT'] * 2 + ['NEEDS_INFORMATION'] * 2 + ['NOT_A_BUG'] * 2 + ['DUPLICATE'] * 2 + ['WONT_FIX'] * 2)
assert len(FINAL) == len(BUGS), (len(FINAL), len(BUGS))
rng.shuffle(FINAL)
SPEED = {'krishna': 0.7, 'shathish': 1.1, 'faisal': 1.4, 'patrik': 0.8, 'jenith': 1.0, 'arvind': 0.9, 'stephen': 1.2}  # fix-time multiplier


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def at(hours_ago):
    return f"now()-interval '{hours_ago:.2f} hours'"


out = ['-- Demo data: generated by database/demo/generate_seed.py. Remove with database/demo/remove.sql.',
       '-- Apply with: npm run demo:seed (removes any existing demo data first, all in one transaction).']
out.append(f"INSERT INTO bugflow.projects(id,name,description,environment) VALUES ({q(PROJECT)},'Demo · Customer Portal','Demo data for exploring reports. Remove with database/demo/remove.sql.','Staging') ON CONFLICT (id) DO NOTHING;")
for slug, name, r, designation, real in PEOPLE:
    if real:
        continue
    email = f'{slug}@demo.bugboard.test'
    token_hash = ''.join(rng.choice('0123456789abcdef') for _ in range(64))
    out.append(f"INSERT INTO bugflow.users(id,name,email,created_at) VALUES ({ref(slug)},{q(name)},{q(email)},{at(24*62)}) ON CONFLICT DO NOTHING;")
    out.append(f"INSERT INTO bugflow.portals(id,user_id,type,token_hash,expires_at,created_at,welcome_seen_at) VALUES ({q(pid[slug])},{ref(slug)},{q(PORTAL_TYPE[r])},{q(token_hash)},now()+interval '90 days',{at(24*62)},{at(24*61)}) ON CONFLICT DO NOTHING;")
    out.append(f"INSERT INTO bugflow.portal_onboarding(portal_id,collaborator_role,permissions,scope_note,context,welcome) VALUES ({q(pid[slug])},{q(r)},{q(json.dumps(PERMISSIONS[r]))}::jsonb,'Demo · Customer Portal',{q(designation)},'Welcome to the demo project.') ON CONFLICT DO NOTHING;")
    out.append(f"INSERT INTO bugflow.portal_projects(portal_id,project_id) VALUES ({q(pid[slug])},{q(PROJECT)}) ON CONFLICT DO NOTHING;")

stmts = []  # statements inside the DO block, using variable b (bug id)
for i, (module, title, desc, expected, actual) in enumerate(BUGS):
    final = FINAL[i]
    priority = rng.choice(PRIORITY_POOL)
    severity = rng.choice(SEVERITY_BY_PRIORITY[priority])
    reporter = rng.choice(reporters)
    qa = rng.choice(qas)
    dev = 'patrik' if module in INFRA_MODULES and rng.random() < 0.7 else rng.choice(devs)
    speed = SPEED[dev] * (0.5 if priority in ('P0', 'P1') else 1.0)
    t = rng.uniform(4, 58) * 24  # hours ago the bug was reported
    events = []  # (hours_ago, actor, prev, new)
    clock = [t]

    def step(actor, new, gap):
        clock[0] = max(0.3, clock[0] - gap)
        events.append((clock[0], actor, events[-1][3] if events else 'NEW', new))
    path = []
    if final != 'NEW':
        path.append((qa, 'VALIDATING', rng.uniform(1, 18)))
    if final in ('NOT_A_BUG', 'DUPLICATE'):
        path.append((qa, final, rng.uniform(1, 30)))
    elif final == 'NEEDS_INFORMATION':
        path.append((rng.choice([qa, 'pradeepa']), 'NEEDS_INFORMATION', rng.uniform(2, 24)))
    elif final not in ('NEW', 'VALIDATING'):
        path += [(qa, 'VALIDATED', rng.uniform(1, 20)), (qa, 'READY_FOR_ASSIGNMENT', rng.uniform(0.5, 6))]
        if final != 'READY_FOR_ASSIGNMENT':
            path.append((qa, 'ASSIGNED', rng.uniform(1, 24)))
            if final != 'ASSIGNED':
                path.append((dev, 'IN_PROGRESS', rng.uniform(2, 30) * speed))
                if final == 'WONT_FIX':
                    path.append(('pradeepa', 'WONT_FIX', rng.uniform(4, 40)))
                elif final in ('RECHECK', 'RESOLVED', 'REOPENED'):
                    path.append((dev, 'RECHECK', rng.uniform(6, 96) * speed))
                    if final in ('RESOLVED', 'REOPENED'):
                        bounced = final == 'REOPENED' or rng.random() < 0.25  # some fixes fail QA first
                        if bounced:
                            path.append((qa, 'REOPENED', rng.uniform(2, 30)))
                            if final == 'RESOLVED':
                                path += [(dev, 'IN_PROGRESS', rng.uniform(1, 10)), (dev, 'RECHECK', rng.uniform(4, 48) * speed), (qa, 'RESOLVED', rng.uniform(2, 24))]
                        else:
                            path.append((qa, 'RESOLVED', rng.uniform(2, 24)))
    # Compress the path if it would run into the future.
    total = sum(g for _, _, g in path)
    scale = min(1.0, (t - 0.5) / total) if total else 1.0
    for actor, new, gap in path:
        step(actor, new, gap * scale)
    last = events[-1][0] if events else t
    assigned = any(e[3] == 'ASSIGNED' for e in events)
    assignee = f"{ref(dev)}::uuid" if assigned else 'NULL'
    fix_notes = q('Root cause fixed and covered by a regression test.') if any(e[3] == 'RECHECK' for e in events) else "''"
    steps = [f'Open the {module} page', 'Repeat the action described', 'Observe the result']
    s = []
    s.append(f"INSERT INTO bugflow.bugs(title,project_id,reporter_id,qa_owner_id,assignee_id,status,priority,severity,description,expected,actual,browser_device,environment,fix_notes,created_at,updated_at) VALUES ({q(title)},{q(PROJECT)},{ref(reporter)},{ref(qa)},{assignee},{q(final)},{q(priority)},{q(severity)},{q(desc)},{q(expected)},{q(actual)},{q(rng.choice(DEVICES))},{q(rng.choice(ENVS))},{fix_notes},{at(t)},{at(last)}) RETURNING id INTO b;")
    s.append(f"INSERT INTO bugflow.bug_details(bug_id,request_id,module_name) VALUES (b,gen_random_uuid(),{q(module)});")
    s.append("INSERT INTO bugflow.steps(bug_id,position,content) VALUES " + ','.join(f"(b,{n},{q(x)})" for n, x in enumerate(steps, 1)) + ';')
    s.append(f"INSERT INTO bugflow.activity(id,bug_id,actor_id,action,detail,created_at) VALUES (gen_random_uuid(),b,{ref(reporter)},'bug.created',jsonb_build_object('priority',{q(priority)},'status','NEW','title',{q(title)}),{at(t)});")
    for hours, actor, prev, new in events:
        s.append(f"INSERT INTO bugflow.status_history(id,bug_id,actor_id,previous_status,new_status,created_at) VALUES (gen_random_uuid(),b,{ref(actor)},{q(prev)},{q(new)},{at(hours)});")
        if new == 'ASSIGNED':
            s.append(f"INSERT INTO bugflow.assignments(id,bug_id,actor_id,assignee_id,created_at) VALUES (gen_random_uuid(),b,{ref(actor)},{ref(dev)},{at(hours)});")
            s.append(f"INSERT INTO bugflow.bug_assignees(bug_id,user_id,assigned_by,created_at) VALUES (b,{ref(dev)},{ref(actor)},{at(hours)}) ON CONFLICT DO NOTHING;")
            s.append(f"INSERT INTO bugflow.activity(id,bug_id,actor_id,action,detail,created_at) VALUES (gen_random_uuid(),b,{ref(actor)},'bug.assign',jsonb_build_object('previousStatus',{q(prev)},'status','ASSIGNED','priority',{q(priority)},'previousPriority',{q(priority)},'assignee',{ref(dev)}),{at(hours)});")
            continue
        verify = prev == 'RECHECK' and new in ('RESOLVED', 'REOPENED')
        if verify:
            passed = 'true' if new == 'RESOLVED' else 'false'
            note = 'Verified on staging; works as expected.' if new == 'RESOLVED' else 'Still reproducible on Safari; sending back.'
            s.append(f"INSERT INTO bugflow.verifications(id,bug_id,actor_id,passed,notes,created_at) VALUES (gen_random_uuid(),b,{ref(actor)},{passed},{q(note)},{at(hours)});")
        action = 'bug.verify' if verify else 'bug.status'
        notes = {'RECHECK': 'Fix deployed to staging.', 'NEEDS_INFORMATION': 'Please share the exact steps and a screen recording.', 'NOT_A_BUG': 'Works as designed.', 'DUPLICATE': 'Same issue is already tracked.', 'WONT_FIX': 'Out of scope for this release.'}.get(new, '')
        s.append(f"INSERT INTO bugflow.activity(id,bug_id,actor_id,action,detail,created_at) VALUES (gen_random_uuid(),b,{ref(actor)},{q(action)},jsonb_build_object('previousStatus',{q(prev)},'status',{q(new)},'priority',{q(priority)},'previousPriority',{q(priority)},'notes',{q(notes)}),{at(hours)});")
    if rng.random() < 0.35:  # some discussion
        commenter = rng.choice([dev, qa, reporter]); ch = max(0.4, last - rng.uniform(0.2, 2))
        text = rng.choice(['Can reproduce on staging.', 'Looks related to the last release.', 'Adding a screen recording in Drive.', 'Is this blocking the release?'])
        s.append(f"INSERT INTO bugflow.comments(id,bug_id,actor_id,content,created_at) VALUES (gen_random_uuid(),b,{ref(commenter)},{q(text)},{at(ch)});")
        s.append(f"INSERT INTO bugflow.activity(id,bug_id,actor_id,action,detail,created_at) VALUES (gen_random_uuid(),b,{ref(commenter)},'bug.comment',jsonb_build_object('notes',{q(text)}),{at(ch)});")
    stmts.append('\n  '.join(s))

lookups = {
    'arvind': "(SELECT p.user_id FROM bugflow.portals p WHERE p.type='admin' ORDER BY p.created_at LIMIT 1)",
    'jenith': "(SELECT id FROM bugflow.users WHERE lower(name)='jenith' AND email NOT LIKE '%@demo.bugboard.test' AND deleted_at IS NULL ORDER BY created_at LIMIT 1)",
    'stephen': "(SELECT id FROM bugflow.users WHERE lower(name)='stephen' AND email NOT LIKE '%@demo.bugboard.test' AND deleted_at IS NULL ORDER BY created_at LIMIT 1)",
}
declare = ''.join(f'u_{k} uuid := {v};\n' for k, v in lookups.items())
checks = ''.join(f"  IF u_{k} IS NULL THEN RAISE EXCEPTION 'Demo seed needs an existing member named {k}'; END IF;\n" for k in lookups)
out.append('DO $$\nDECLARE b bigint;\n' + declare + 'BEGIN\n' + checks + '  ' + '\n  '.join(stmts) + '\nEND $$;')
print('\n'.join(line for line in out if line))
