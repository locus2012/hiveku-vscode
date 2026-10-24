# Domains, DNS, and Redirects

The full mechanism behind Play 8. Load this before attaching, verifying, migrating, or
removing any domain, and before creating or deploying redirects.

Connecting a custom domain and preserving link equity is core agency work.
1. Attach: `project_domains_add({ project_id, domain, tier, is_primary? })` - the tier enum
   here is `production` | `staging` | `dev` (not the deploy_site spelling), default
   production. Then get the records the client must set with `project_domain_dns_records`.
   Surface them verbatim - the user cannot guess them. If you have registrar access
   (Cloudflare, Route53) create them yourself and re-read with `check_dns: true` instead of
   handing over a list. Do not guess DNS.
1b. A domain that is LIVE on another host right now (it serves the client's current site
   somewhere else): do NOT use `project_domains_add`. With it the certificate can only be
   issued once the domain points at Hiveku, so visitors get certificate errors for a few
   minutes during the switch. Use the no-gap move instead (its tools are below):
   - Start it with the domain as the client knows it (www.example.com also moves
     example.com). Nothing changes for visitors. It is refused with a code when nothing is
     live on the domain (then use `project_domains_add`), when it already points at Hiveku,
     when the site already has another domain (a move is for a site's first domain), or
     when another Hiveku site holds the domain on any tier (or this site on another tier).
   - Hand over `domains[].addNow`, the validation record(s) to add NOW at the CURRENT DNS
     host, beside the existing records, and say plainly: do not change the main record yet.
     Right after the start `addNow` can be empty for a few minutes (stage `checking`, code
     `records_not_ready`): Hiveku is still getting the record, so read the status again.
     If `fixFirst` is not empty, that comes first: a CAA setting that keeps the certificate
     authority out, often the old host's own, reached through its CNAME (the fix is to
     replace that CNAME with an A record for the same host); or a TXT record
     `_hiveku-move.<name>`, asked when the name's validation record was already in place
     before the move (left from an earlier setup), so it proves nothing about who asks now.
     Stage `confirm_ownership` waits for that TXT record.
   - Read the status every few minutes (it only reads; Hiveku moves the setup on by itself:
     every 5 minutes at first and while a domain is ready to switch, then every 15 minutes
     after the first day and hourly after a week while it waits for a record).
     Each record says `done`, or names a typo (`wrong_value` with the value found, or
     `wrong_name` for a name entered with the domain twice).
   - ONLY when `readyToSwitch` is true, hand over the records in `domains[].atSwitch`: a
     domain lists them only once it is ready. www comes FIRST (CNAME www to the site's
     hvk-....cdn.hiveku.com address); HTTPS works from the first request. Never before:
     until then visitors would get certificate errors. Leave the bare domain alone until
     www is live: only then does it list its two A records (stage `ready_to_switch` again).
     An old host whose main address is the bare domain sends www back to it, so a bare
     domain switched first sends visitors round in a loop.
   - The stage turns `done` once Hiveku sees both changes; the move stays open for the bare
     domain until then. The validation records stay: they renew the certificate. To abandon
     the move before the switch, stop it (confirm with the client); it is refused once a
     domain points at Hiveku, and once www is live it stops only the bare domain.
   - While it runs, the move's rows carry `verification_method: "live_move"`;
     `project_domain_verify` answers the move's state, `project_domain_retry_certificate`
     asks the move for a new certificate, and `project_domains_remove` on either domain
     stops the whole move.

   **The no-gap move's tools:**

   | Tool | What it does |
   | --- | --- |
   | `project_domain_move_start` | start the move; answers the records to add now |
   | `project_domain_move_status` | read only: stage, records, certificate, `readyToSwitch` |
   | `project_domain_move_stop` | stop before the switch and clean up |

2. For any APEX domain (example.com, no subdomain), call `project_domain_apex_options`
   FIRST and lead with the answer it exists to give: an apex cannot use a CNAME. That single
   fact is the most common reason a custom-domain setup stalls. The tool returns the static
   IPs plus provider-specific routes, including Cloudflare CNAME flattening, which is the
   cleanest path when you already have Cloudflare access.
3. Verify propagation before promising it works: `project_domain_check_dns` (re-check the
   tier now instead of waiting for the sweep - a negative result minutes after a change
   usually means "not yet", not "wrong") then `project_domain_verify({ project_id,
   domain_id })`. That last one is the call that answers "can I tell the client it is up":
   it checks DNS AND the SSL certificate, and a domain is only servable once BOTH are good.
   On a failed or stuck cert, `project_domain_retry_certificate` - but a CAA record that
   forbids the issuing CA is the usual cause, and the retry fails identically until the CAA
   is fixed. `project_domains_list` shows current attachments with dns_status/ssl_status;
   `project_domains_remove` soft-detaches (confirm - it takes the site offline on that host;
   the user's DNS records are left alone).
4. Apex-to-www: `project_domain_apex_redirect_set` points the bare domain at the www host
   (or vice versa) so both resolve. Decide the canonical host once and be consistent.
5. Migrating an OLD domain to a new one (olddomain.com -> newdomain.com) does NOT use the
   apex tool. Attach the old domain with `project_domains_add` WITHOUT `is_primary`, make
   sure the right one is primary (`project_domains_update({ is_primary: true })`), then run
   `project_redirects_deploy`. Every non-primary domain on a project 301s to the primary via
   the CloudFront function. Two caveats that turn this into a silent no-op: domain redirects
   are PRODUCTION TIER ONLY, and nothing at all takes effect until the deploy runs.
6. Redirects preserve SEO and fix broken paths. Map old URLs to new BEFORE you delete or
   rename pages:
 - `project_redirects_list` to see the current map (each row carries the `id` you need to
     edit or delete it).
 - `project_redirect_create({ project_id, from_path, to_path, status_code, match_type })` -
     301 for permanent moves, 302 only for temporary; match_type is exact | prefix | regex.
     The route validates duplicate sources, self-loops, and circular chains up to depth 10.
     `project_redirect_update`, `project_redirect_delete` for the rest.
 - Redirects are staged until published: `project_redirects_deploy({ project_id, tier })`
     makes them live, tier is `development` | `staging` | `production` (default production).
     Deploying to development and then checking production is its own silent no-op. Confirm,
     then verify a couple of the mappings actually 301 against the deployed host.
 - Every renamed slug or deleted page in Play 1/2/3 needs a matching 301 here. An orphaned
     old URL is lost traffic and a lost ranking.
