"""
Example handler — copy this and wire it up to your real agent.

The runner imports a function with this signature:
    handler(message: dict) -> dict

`message` is the parsed email (see runner.py docstring for the full schema).

Your function should return a dict with at least:
    {"decision": "pass" | "fail" | "needs_info" | "skipped",
     "reasoning": "<one paragraph>",
     "response_email": "<the body of what you'd send back, or empty for skipped>"}

To wire up your real agent:
    1. Copy this file or write your own.
    2. Replace the body of `process_message` with a call to your agent's
       actual processing function (whatever your Gmail-watcher invokes).
    3. Run:  python runner.py --handler example_handler:process_message --out results.json
    4. Then: python checker.py results.json
"""


def process_message(message: dict) -> dict:
    """
    Demo handler — replace with a call to your real agent.
    This dummy version just looks at headers and decides.
    """
    headers = message.get("headers", {})

    # Layer 1: bulk-mail filter
    if headers.get("List-Unsubscribe") or headers.get("Precedence", "").lower() == "bulk":
        return {"decision": "skipped", "reasoning": "bulk mail header detected"}

    # Layer 2: empty/gibberish
    body = (message.get("body_text") or "").strip()
    if not body and not message.get("attachments"):
        return {"decision": "needs_info", "reasoning": "empty email"}

    # ... your real evaluation goes here ...
    return {
        "decision": "needs_info",
        "reasoning": "demo handler — replace with your real agent",
        "response_email": "Hi, please send your resume / GitHub / portfolio.",
    }


# Wire-up examples for common agent shapes:
#
# If your agent has a function like `evaluator.run(gmail_message)`:
#     from evaluator import run
#     def process_message(message):
#         return run(message)   # adapt the dict to whatever shape `run` expects
#
# If your agent expects a raw .eml bytes:
#     from evaluator import run_from_eml
#     import base64, email
#     def process_message(message):
#         # reconstruct or just point runner at a .eml-bytes mode (extend runner.py)
#         ...
