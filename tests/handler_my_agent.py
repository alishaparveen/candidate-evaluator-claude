"""
Plum test-pack handler that proxies to the candidate-evaluator agent (TS).

Usage (in two shells):

    # shell 1 — start the bridge server next to the agent codebase
    cd /c/Users/proba/Downloads/candidate-evaluator-claude
    npm run test:server

    # shell 2 — run the test pack
    cd /c/Users/proba/Downloads/plum_test_pack/test_pack
    python runner.py --handler handler_my_agent:process_message --out results.json
    python checker.py results.json
"""
import json
import os
import urllib.error
import urllib.request

ENDPOINT = os.environ.get("AGENT_ENDPOINT", "http://localhost:9000/process")
TIMEOUT_SECONDS = int(os.environ.get("AGENT_TIMEOUT", "180"))


def process_message(message: dict) -> dict:
    payload = json.dumps(message, default=str).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            err_body = str(e)
        return {
            "decision": "ERROR",
            "reasoning": f"HTTP {e.code} from agent server: {err_body}",
            "response_email": "",
        }
    except urllib.error.URLError as e:
        return {
            "decision": "ERROR",
            "reasoning": f"could not reach agent server at {ENDPOINT}: {e.reason}. "
                         "Did you start `npm run test:server` in the candidate-evaluator project?",
            "response_email": "",
        }
    except Exception as e:
        return {
            "decision": "ERROR",
            "reasoning": f"{type(e).__name__}: {e}",
            "response_email": "",
        }
