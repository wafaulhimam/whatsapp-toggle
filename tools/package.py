#!/usr/bin/env python3
"""Build a distributable ZIP of the extension.

The Chrome Web Store requires manifest.json at the *root* of the archive, and it
rejects packages that contain stray files - so this uses an explicit allowlist of
top-level entries rather than trying to exclude things. Anything not listed here
(tools/, PLAN.md, the workspace memory folder, dist/ itself) is never packaged.

Output is deterministic: fixed timestamps and sorted entries, so the same source
always produces byte-identical output and the checksum is meaningful.

Run from the repo root:  python3 tools/package.py
"""
import hashlib
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Top-level entries that ship to users. Everything else stays out.
SHIPPED = [
    "manifest.json",
    "background.js",
    "popup",
    "scripts",
    "shared",
    "css",
    "images",
    "_locales",
    "NOTICE.md",
]

# Fixed timestamp so builds are reproducible.
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def collect():
    """Return the sorted list of files to ship, relative to ROOT."""
    files = []
    for entry in SHIPPED:
        path = os.path.join(ROOT, entry)
        if not os.path.exists(path):
            raise SystemExit("FAIL: %s is listed in SHIPPED but does not exist" % entry)
        if os.path.isfile(path):
            files.append(entry)
            continue
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames.sort()
            for name in sorted(filenames):
                if name == ".DS_Store":
                    continue
                full = os.path.join(dirpath, name)
                files.append(os.path.relpath(full, ROOT))
    return sorted(files)


def verify_manifest(files):
    """The store rejects a package whose manifest points at missing files."""
    if "manifest.json" not in files:
        raise SystemExit("FAIL: manifest.json would not be at the root of the ZIP")

    manifest = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))
    present = set(files)
    referenced = []

    def add(path):
        if path:
            referenced.append(path)

    for path in (manifest.get("icons") or {}).values():
        add(path)
    action = manifest.get("action") or {}
    add(action.get("default_popup"))
    for path in (action.get("default_icon") or {}).values():
        add(path)
    add((manifest.get("background") or {}).get("service_worker"))
    for entry in manifest.get("content_scripts") or []:
        for path in (entry.get("js") or []) + (entry.get("css") or []):
            add(path)

    missing = [p for p in referenced if p not in present]
    if missing:
        raise SystemExit("FAIL: manifest references files not in the package: %s" % ", ".join(missing))

    return manifest


def main():
    files = collect()
    manifest = verify_manifest(files)

    version = manifest["version"]
    dist = os.path.join(ROOT, "dist")
    os.makedirs(dist, exist_ok=True)
    out = os.path.join(dist, "privacy-blur-whatsapp-web-v%s.zip" % version)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in files:
            info = zipfile.ZipInfo(relative, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(os.path.join(ROOT, relative), "rb") as handle:
                archive.writestr(info, handle.read())

    size = os.path.getsize(out)
    digest = hashlib.sha256(open(out, "rb").read()).hexdigest()

    print("packaged %d files -> %s" % (len(files), os.path.relpath(out, ROOT)))
    print("size:     %.1f KB" % (size / 1024))
    print("sha256:   %s" % digest)
    print("")
    for relative in files:
        print("  " + relative)

    # Sanity: nothing from the dev toolchain should have leaked in.
    leaked = [f for f in files if f.startswith(("tools/", "dist/")) or f.endswith(".md") and f != "NOTICE.md"]
    if leaked:
        print("\nFAIL: dev files leaked into the package: %s" % ", ".join(leaked))
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
