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
