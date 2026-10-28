"""Search Google Scholar via SerpApi; run directly for a standalone experiment."""

import argparse
import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv


def search_papers(query: str, limit: int = 5) -> list[dict]:
    """Return paper metadata, search snippets, and available PDF resource links."""
    if not query.strip():
        raise ValueError("Provide a non-empty search query.")
    if not 1 <= limit <= 20:
        raise ValueError("limit must be between 1 and 20.")

    # Support the workspace .env currently used in the IDE and backend deployments.
    backend_dir = Path(__file__).resolve().parent
    load_dotenv(backend_dir / ".env")
    load_dotenv(backend_dir.parent.parent / ".env")
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        raise ValueError("Set SERPAPI_API_KEY in your workspace or backend .env.")

    try:
        response = requests.get(
            "https://serpapi.com/search.json",
            params={
                "engine": "google_scholar",
                "q": query.strip(),
                "num": limit,
                "hl": "en",
                "api_key": api_key,
            },
            timeout=30,
        )
    except requests.RequestException:
        # Request exceptions may contain the URL, including the secret API key.
        raise RuntimeError("Could not reach SerpApi. Check your connection and retry.") from None

    if response.status_code != 200:
        raise RuntimeError(
            f"SerpApi returned HTTP {response.status_code}. "
            "Check your API key and search quota in the SerpApi dashboard."
        )
    try:
        data = response.json()
    except ValueError:
        raise RuntimeError("SerpApi returned an invalid JSON response.") from None
    if not isinstance(data, dict) or data.get("error"):
        raise RuntimeError("SerpApi reported a search failure. Check your dashboard.")

    papers = []
    for result in data.get("organic_results", [])[:limit]:
        publication = result.get("publication_info") or {}
        papers.append({
            "title": result.get("title"),
            "url": result.get("link"),
            "result_id": result.get("result_id"),
            "authors": [a["name"] for a in publication.get("authors", []) if a.get("name")],
            "publication": publication.get("summary"),
            "snippet": result.get("snippet"),
            "pdf_urls": [
                resource["link"]
                for resource in result.get("resources", [])
                if resource.get("file_format", "").upper() == "PDF" and resource.get("link")
            ],
        })
    return papers


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="Google Scholar search terms")
    parser.add_argument("--limit", type=int, default=5, help="Maximum results (1–20)")
    args = parser.parse_args()
    try:
        print(json.dumps(search_papers(args.query, args.limit), indent=2, ensure_ascii=False))
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
