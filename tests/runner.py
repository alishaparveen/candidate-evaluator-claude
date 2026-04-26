"""
Test runner for the Plum Builders evaluator agent.

Reads .eml fixtures, normalizes them into a dict that looks like what your
Gmail-API-based agent would see, and either:
  - prints them (--dry-run)
  - calls a Python handler you point it at (--handler some.module:func)
  - writes the parsed messages to a JSON file (--out parsed.json)
  - writes your agent's responses to a results JSON for the checker

Usage examples
--------------
    # Just see what's in the fixtures:
    python runner.py --dry-run

    # Wire it up to your agent. Your handler takes one parsed message dict
    # and returns a result dict like {"decision": "pass", "reasoning": "..."}.
    python runner.py --handler myagent.pipeline:process_message --out results.json

    # Run only one folder:
    python runner.py --only 04_edge_cases --dry-run

The parsed message dict your handler receives looks like:

    {
      "fixture_id": "edge_13_marketing_email",
      "message_id": "<...>",
      "from": "Apollo <hello@apollo.io>",
      "from_email": "hello@apollo.io",
      "to": "apply@yourdomain.com",
      "subject": "...",
      "date": "2025-11-05T...",
      "body_text": "...",
      "body_html": "..." or None,
      "headers": {"List-Unsubscribe": "...", ...},
      "in_reply_to": "<...>" or None,
      "references": "<...>" or None,
      "attachments": [
        {"filename": "...", "content_type": "application/pdf",
         "size_bytes": 12345, "data_b64": "..."},
        ...
      ],
    }
"""
import argparse
import base64
import importlib
import json
import os
import sys
from email import policy
from email.parser import BytesParser

ROOT = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(ROOT, "fixtures")


def parse_eml(path):
    with open(path, "rb") as f:
        msg = BytesParser(policy=policy.default).parse(f)

    # Body
    body_text, body_html = None, None
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp:
                continue
            if ctype == "text/plain" and body_text is None:
                try:
                    body_text = part.get_content()
                except Exception:
                    body_text = part.get_payload(decode=True).decode("utf-8", errors="replace")
            elif ctype == "text/html" and body_html is None:
                try:
                    body_html = part.get_content()
                except Exception:
                    body_html = part.get_payload(decode=True).decode("utf-8", errors="replace")
    else:
        try:
            body_text = msg.get_content()
        except Exception:
            body_text = msg.get_payload()

    # Attachments
    attachments = []
    for part in msg.iter_attachments():
        data = part.get_payload(decode=True) or b""
        attachments.append({
            "filename": part.get_filename() or "unnamed",
            "content_type": part.get_content_type(),
            "size_bytes": len(data),
            "data_b64": base64.b64encode(data).decode("ascii"),
        })

    # From
    from_full = str(msg.get("From", ""))
    from_email = from_full
    if "<" in from_full and ">" in from_full:
        from_email = from_full.split("<", 1)[1].rsplit(">", 1)[0].strip()

    # All headers as a flat dict (last-write wins for duplicates)
    headers = {k: str(v) for k, v in msg.items()}

    return {
        "message_id": str(msg.get("Message-ID", "")),
        "from": from_full,
        "from_email": from_email,
        "to": str(msg.get("To", "")),
        "subject": str(msg.get("Subject", "")),
        "date": str(msg.get("Date", "")),
        "body_text": body_text or "",
        "body_html": body_html,
        "headers": headers,
        "in_reply_to": str(msg.get("In-Reply-To")) if msg.get("In-Reply-To") else None,
        "references": str(msg.get("References")) if msg.get("References") else None,
        "attachments": attachments,
    }


def load_handler(spec):
    """spec format: 'module.path:function_name'"""
    if ":" not in spec:
        raise ValueError("Handler must be 'module.path:function_name'")
    mod_path, fn_name = spec.split(":", 1)
    sys.path.insert(0, os.getcwd())
    mod = importlib.import_module(mod_path)
    return getattr(mod, fn_name)


def iter_fixtures(only=None):
    for folder in sorted(os.listdir(FIX)):
        if only and folder != only:
            continue
        sub = os.path.join(FIX, folder)
        if not os.path.isdir(sub):
            continue
        for fname in sorted(os.listdir(sub)):
            if fname.endswith(".eml"):
                yield folder, fname, os.path.join(sub, fname)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--handler", help="Python handler 'module.path:function_name'")
    ap.add_argument("--dry-run", action="store_true", help="Just print what would be sent")
    ap.add_argument("--only", help="Run only one folder (e.g. 04_edge_cases)")
    ap.add_argument("--out", default="results.json", help="Write results to this JSON file")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    handler = load_handler(args.handler) if args.handler else None
    results = []

    for folder, fname, path in iter_fixtures(only=args.only):
        fixture_id = fname.replace(".eml", "")
        parsed = parse_eml(path)
        parsed["fixture_id"] = fixture_id

        if args.dry_run:
            print(f"[{folder}] {fixture_id}")
            print(f"   from:    {parsed['from']}")
            print(f"   subject: {parsed['subject']}")
            print(f"   atts:    {[a['filename'] for a in parsed['attachments']] or 'none'}")
            unsubscribe = parsed['headers'].get('List-Unsubscribe')
            if unsubscribe:
                print(f"   ⚠ List-Unsubscribe header present (bulk mail)")
            if parsed.get('in_reply_to'):
                print(f"   ↪ In-Reply-To: {parsed['in_reply_to']}")
            print()
            continue

        if handler is None:
            print("Provide --handler or --dry-run", file=sys.stderr)
            sys.exit(2)

        try:
            result = handler(parsed)
        except Exception as e:
            result = {"decision": "ERROR", "error": f"{type(e).__name__}: {e}"}

        results.append({
            "fixture_id": fixture_id,
            "folder": folder,
            "from": parsed["from"],
            "subject": parsed["subject"],
            "result": result,
        })
        if args.verbose:
            print(f"[{folder}] {fixture_id}: {result.get('decision', result)}")

    if not args.dry_run:
        with open(args.out, "w") as f:
            json.dump(results, f, indent=2, default=str)
        print(f"\nWrote {len(results)} results to {args.out}")


if __name__ == "__main__":
    main()
