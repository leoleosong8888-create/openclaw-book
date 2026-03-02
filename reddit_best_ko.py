#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List

UA = "Mozilla/5.0 (X11; Linux x86_64) OpenClawRedditBest/1.0"


def fetch_json(url: str) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def translate_to_ko(text: str) -> str:
    # Unofficial Google Translate endpoint (no key). Good for lightweight automation.
    q = urllib.parse.quote(text)
    url = (
        "https://translate.googleapis.com/translate_a/single"
        f"?client=gtx&sl=auto&tl=ko&dt=t&q={q}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)

    # data[0] = translated segments
    return "".join(seg[0] for seg in data[0] if seg and seg[0])


def get_best_posts(subreddit: str, timeframe: str, count: int) -> List[Dict[str, Any]]:
    # fetch extra to allow simple filtering
    limit = max(count * 3, 10)
    url = f"https://www.reddit.com/r/{subreddit}/top.json?t={timeframe}&limit={limit}"
    data = fetch_json(url)

    out: List[Dict[str, Any]] = []
    for child in data.get("data", {}).get("children", []):
        p = child.get("data", {})
        if p.get("stickied"):
            continue

        title = p.get("title", "")
        try:
            title_ko = translate_to_ko(title)
        except Exception:
            title_ko = "(번역 실패) " + title

        out.append(
            {
                "subreddit": p.get("subreddit"),
                "title": title,
                "title_ko": title_ko,
                "url": "https://reddit.com" + p.get("permalink", ""),
                "score": p.get("score", 0),
                "comments": p.get("num_comments", 0),
                "created_utc": p.get("created_utc", 0),
            }
        )
        if len(out) >= count:
            break

    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch top Reddit posts and output Korean-translated titles."
    )
    parser.add_argument("--subreddit", default="all", help="Subreddit name (default: all)")
    parser.add_argument(
        "--timeframe",
        default="day",
        choices=["hour", "day", "week", "month", "year", "all"],
        help="Top timeframe (default: day)",
    )
    parser.add_argument("--count", type=int, default=3, help="Number of posts (default: 3)")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    posts = get_best_posts(args.subreddit, args.timeframe, args.count)

    if args.json:
        print(json.dumps(posts, ensure_ascii=False, indent=2))
        return 0

    for i, p in enumerate(posts, start=1):
        print(f"{i}. [{p['subreddit']}] {p['title_ko']}")
        print(f"   원문: {p['title']}")
        print(f"   점수: {p['score']} | 댓글: {p['comments']}")
        print(f"   링크: {p['url']}")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
