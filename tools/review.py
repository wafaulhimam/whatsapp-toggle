#!/usr/bin/env python3
"""Static checks for the extension.

Catches the classes of mistake that only show up as a silent no-op at runtime:
a manifest pointing at a file that does not exist, a CSS custom property that is
read but never written, a feature with no stylesheet, a JS syntax error.

Run from the repo root:  python3 tools/review.py
Exits non-zero if anything fails.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.environ.get("NODE_BIN", "node")

problems = []
notes = []


def fail(msg):
    problems.append(msg)


def rel(path):
    return os.path.relpath(path, ROOT)


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def check_json():
    for name in ("manifest.json", "_locales/en/messages.json"):
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            fail("%s is missing" % name)
            continue
        try:
            json.loads(read(path))
        except json.JSONDecodeError as exc:
            fail("%s is not valid JSON: %s" % (name, exc))


def check_js_syntax():
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        if any(part in dirpath for part in (".git", ".workbuddy-ai")):
            continue
        for name in filenames:
            if not name.endswith(".js"):
                continue
            path = os.path.join(dirpath, name)
            result = subprocess.run(
                [NODE, "--check", path], capture_output=True, text=True
            )
            if result.returncode != 0:
                fail("%s has a syntax error:\n%s" % (rel(path), result.stderr.strip()))


def check_manifest_paths():
    manifest = json.loads(read(os.path.join(ROOT, "manifest.json")))

    referenced = []

    def add(path):
        if path:
            referenced.append(path)

    for size, path in (manifest.get("icons") or {}).items():
        add(path)
    action = manifest.get("action") or {}
    add(action.get("default_popup"))
    for path in (action.get("default_icon") or {}).values():
        add(path)
    background = manifest.get("background") or {}
    add(background.get("service_worker"))
    for entry in manifest.get("content_scripts") or []:
        for path in entry.get("js") or []:
            add(path)
        for path in entry.get("css") or []:
            add(path)
    for entry in manifest.get("web_accessible_resources") or []:
        for pattern in entry.get("resources") or []:
            if "*" in pattern:
                directory = os.path.join(ROOT, os.path.dirname(pattern))
                if not os.path.isdir(directory):
                    fail("web_accessible_resources pattern %r matches no directory" % pattern)
                continue
            add(pattern)

    for path in referenced:
        if not os.path.exists(os.path.join(ROOT, path)):
            fail("manifest references missing file: %s" % path)

    for size in ("16", "32", "48", "128"):
        if size not in (manifest.get("icons") or {}):
            notes.append("manifest has no %spx icon" % size)


def feature_ids():
    """Feature ids and their gear storage keys, read straight from the schema."""
    source = read(os.path.join(ROOT, "shared", "settings.js"))
    ids = re.findall(r'^\s*id:\s*"([^"]+)"', source, re.M)
    var_keys = re.findall(r'store:\s*"varStyles",\s*key:\s*"([^"]+)"', source)
    idle_keys = re.findall(r'store:\s*"idle",\s*key:\s*"([^"]+)"', source)
    return ids, var_keys, idle_keys


def kebab(name):
    return re.sub(r"[A-Z]+(?![a-z])|[A-Z]", lambda m: ("-" if m.start() else "") + m.group(0).lower(), name)


def check_feature_stylesheets(ids):
    css_dir = os.path.join(ROOT, "css")
    for feature_id in ids:
        path = os.path.join(css_dir, feature_id + ".css")
        if not os.path.exists(path):
            fail("feature %r has no stylesheet at css/%s.css" % (feature_id, feature_id))

    for name in sorted(os.listdir(css_dir)):
        if not name.endswith(".css"):
            continue
        if name[:-4] not in ids:
            fail("css/%s does not correspond to any feature in the schema" % name)


def check_css_custom_properties(var_keys, idle_keys):
    """Every var(--pfwa-*) a stylesheet reads must be written by the content
    script, or declared locally with a fallback."""
    known = {"--pfwa-delay", "--pfwa-gray", "--pfwa-ti-gray", "--pfwa-ti-opacity"}
    for key in var_keys + idle_keys:
        known.add("--pfwa-" + kebab(key))

    css_dir = os.path.join(ROOT, "css")
    for name in sorted(os.listdir(css_dir)):
        if not name.endswith(".css"):
            continue
        source = read(os.path.join(css_dir, name))
        for match in re.finditer(r"var\(\s*(--pfwa-[a-z0-9-]+)", source):
            name_of_var = match.group(1)
            if name_of_var not in known:
                fail("css/%s reads unknown custom property %s" % (name, name_of_var))

    # Any custom property the content script writes should actually be used.
    used = set()
    for name in os.listdir(css_dir):
        if name.endswith(".css"):
            used.update(re.findall(r"var\(\s*(--pfwa-[a-z0-9-]+)", read(os.path.join(css_dir, name))))
    for key in var_keys:
        var_name = "--pfwa-" + kebab(key)
        if var_name not in used:
            notes.append("%s is configurable in the popup but no stylesheet reads it" % var_name)


def check_css_braces():
    css_dir = os.path.join(ROOT, "css")
    files = [os.path.join(css_dir, n) for n in sorted(os.listdir(css_dir)) if n.endswith(".css")]
    files.append(os.path.join(ROOT, "popup", "popup.css"))
    for path in files:
        source = re.sub(r"/\*.*?\*/", "", read(path), flags=re.S)
        if source.count("{") != source.count("}"):
            fail("%s has unbalanced braces" % rel(path))
        if re.search(r"\{\s*\}", source):
            fail("%s contains an empty rule" % rel(path))
        for depth, char in enumerate(source):
            pass
        # A declaration list must end with a semicolon before the closing brace.
        for block in re.findall(r"\{([^{}]*)\}", source):
            stripped = block.strip()
            if stripped and not stripped.endswith(";"):
                fail("%s has a declaration block missing a trailing semicolon" % rel(path))


def check_popup_html():
    path = os.path.join(ROOT, "popup", "popup.html")
    source = read(path)

    for match in re.finditer(r'(?:src|href)="([^"]+)"', source):
        target = match.group(1)
        if target.startswith(("http:", "https:", "#")):
            continue
        resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
        if not os.path.exists(resolved):
            fail("popup.html references missing file: %s" % target)

    ids = re.findall(r'\sid="([^"]+)"', source)
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        fail("popup.html has duplicate ids: %s" % ", ".join(sorted(duplicates)))

    # Every getElementById in the popup must have a matching element.
    script = read(os.path.join(ROOT, "popup", "popup.js"))
    for wanted in set(re.findall(r'getElementById\("([^"]+)"\)', script)):
        if wanted not in ids:
            fail("popup.js looks up #%s but popup.html does not define it" % wanted)


def check_locale_keys():
    manifest = json.loads(read(os.path.join(ROOT, "manifest.json")))
    messages = json.loads(read(os.path.join(ROOT, "_locales", "en", "messages.json")))
    used = set(re.findall(r"__MSG_([A-Za-z0-9_]+)__", json.dumps(manifest)))
    for key in sorted(used):
        if key not in messages:
            fail("manifest uses __MSG_%s__ but _locales/en/messages.json has no such key" % key)
    for key in messages:
        if key not in used:
            notes.append("locale key %r is defined but never used" % key)


def main():
    check_json()
    check_js_syntax()

    if problems:
        report()
        return 1

    check_manifest_paths()
    ids, var_keys, idle_keys = feature_ids()
    if not ids:
        fail("could not read any feature ids out of shared/settings.js")
    check_feature_stylesheets(ids)
    check_css_custom_properties(var_keys, idle_keys)
    check_css_braces()
    check_popup_html()
    check_locale_keys()

    return report()


def report():
    for note in notes:
        print("note: %s" % note)
    if problems:
        print("")
        for problem in problems:
            print("FAIL: %s" % problem)
        print("\n%d problem(s) found." % len(problems))
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
