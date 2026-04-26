"""
Grade your agent's results against expected_results.json.

Reads:
  results.json         (produced by runner.py)
  expected_results.json

Each result entry should look like:
  {
    "fixture_id": "edge_13_marketing_email",
    "result": {
        "decision": "skipped",          # one of: pass, fail, needs_info, skipped, ERROR
        "reasoning": "...",             # optional, used for must_mention soft check
        "response_email": "..."         # optional, also matched against must_mention
    }
  }

Usage:
  python checker.py results.json
  python checker.py results.json --strict   # must_mention failures count as fails too
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
DIM = "\033[2m"
RESET = "\033[0m"
BOLD = "\033[1m"

VALID_DECISIONS = {"pass", "fail", "needs_info", "skipped", "ERROR"}


def normalize(d):
    if d is None:
        return None
    return d.strip().lower().replace("-", "_").replace(" ", "_")


def decision_matches(actual, expected):
    """expected can be a single value or 'a_or_b' / 'a_or_b_or_c'."""
    actual = normalize(actual)
    accepted = [normalize(x) for x in expected.split("_or_")]
    return actual in accepted, accepted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("results_file", help="JSON file produced by runner.py")
    ap.add_argument("--expected", default=os.path.join(ROOT, "expected_results.json"))
    ap.add_argument("--strict", action="store_true",
                    help="Treat must_mention failures as test failures")
    args = ap.parse_args()

    with open(args.results_file) as f:
        results = json.load(f)
    with open(args.expected) as f:
        expected = json.load(f)
    expected = {k: v for k, v in expected.items() if not k.startswith("_")}

    by_id = {r["fixture_id"]: r for r in results}

    rows = []
    counts = {"pass": 0, "fail": 0, "missing": 0, "soft_fail": 0}

    print(f"\n{BOLD}Plum Builders test pack — results{RESET}\n")
    print(f"{'fixture':<48} {'expected':<28} {'actual':<14} {'mentions':<10} {'verdict'}")
    print("-" * 120)

    for fid, exp in expected.items():
        exp_dec = exp["decision"]
        must_mention = exp.get("must_mention", [])
        row = by_id.get(fid)

        if row is None:
            print(f"{fid:<48} {exp_dec:<28} {'(missing)':<14} {'-':<10} {RED}NOT RUN{RESET}")
            counts["missing"] += 1
            continue

        actual_decision = row.get("result", {}).get("decision")
        ok_dec, accepted = decision_matches(actual_decision, exp_dec)

        # must_mention soft check
        searchable = " ".join([
            str(row.get("result", {}).get("reasoning", "")),
            str(row.get("result", {}).get("response_email", "")),
            str(row.get("result", {}).get("response", "")),
        ]).lower()
        missing_mentions = [m for m in must_mention if m.lower() not in searchable]
        mentions_ok = not missing_mentions

        actual_str = str(actual_decision)
        mentions_str = "ok" if mentions_ok else f"missing {len(missing_mentions)}"

        if ok_dec and (mentions_ok or not args.strict):
            verdict = f"{GREEN}PASS{RESET}"
            counts["pass"] += 1
        elif ok_dec and not mentions_ok and args.strict:
            verdict = f"{YELLOW}SOFT-FAIL{RESET}"
            counts["soft_fail"] += 1
        else:
            verdict = f"{RED}FAIL{RESET}"
            counts["fail"] += 1

        print(f"{fid:<48} {exp_dec:<28} {actual_str:<14} {mentions_str:<10} {verdict}")
        if not ok_dec:
            print(f"   {DIM}↳ accepted: {accepted}, got: {normalize(actual_decision)}{RESET}")
        if missing_mentions and not args.strict:
            print(f"   {DIM}↳ (soft) missing mentions: {missing_mentions}{RESET}")

    total = sum(counts.values())
    print("-" * 120)
    print(f"\n{BOLD}Summary{RESET}")
    print(f"  {GREEN}pass:      {counts['pass']}/{total}{RESET}")
    if counts["soft_fail"]:
        print(f"  {YELLOW}soft-fail: {counts['soft_fail']}/{total}{RESET}")
    print(f"  {RED}fail:      {counts['fail']}/{total}{RESET}")
    if counts["missing"]:
        print(f"  {DIM}missing:   {counts['missing']}/{total}{RESET}")
    print()

    sys.exit(0 if counts["fail"] == 0 and counts["missing"] == 0 else 1)


if __name__ == "__main__":
    main()
