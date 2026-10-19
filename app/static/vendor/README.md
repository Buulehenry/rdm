# Local frontend dependencies

These pinned packages are served from RDM so the login, dashboard and export tools
do not depend on public CDN connectivity. Upstream license files are retained.
`manifest.json` records source package URLs and SHA-256 archive checksums.

Regenerate with `python -m scripts.vendor_frontend` from the repository root.
Map tiles still come from the configured map provider; they are not bundled here.
