"""Import the reviewed design collection through the running desktop API.

Usage: python3 scripts/import-curated-prompts.py --base-url http://127.0.0.1:5001
Only adds missing prompts and groups; never replaces existing user content.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def digest(text):
    return hashlib.sha256(re.sub(r"\s+", "", text).lower().encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--collection", type=Path, default=ROOT / "data/prompt-curation/design-prompts-2026-11-15.json")
    parser.add_argument("--project-id")
    parser.add_argument("--report", type=Path, default=ROOT / "output/prompt-curation/import-report.json")
    args = parser.parse_args()
    if not args.base_url.startswith(("http://127.0.0.1:", "http://localhost:")):
        raise ValueError("This importer targets a local desktop service only")

    def api(route, body=None):
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = Request(args.base_url.rstrip("/") + route, data=payload, headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=60) as response:
            return json.load(response)

    collection = json.loads(args.collection.read_text())
    for item in collection["prompts"]:
        if item.get("source", {}).get("verifiedPair") is not True or not item.get("previewUrl"):
            raise ValueError("Unreviewed prompt/image pair: " + item.get("key", "unknown"))
    projects = api("/api/projects").get("projects", [])
    project_id = args.project_id or (projects[0]["id"] if projects else None)
    if not project_id or not any(project["id"] == project_id for project in projects):
        raise ValueError("Select an existing owned project before importing")
    existing = api("/api/prompts")["prompts"]
    known = {digest(item["text"]) for item in existing}
    groups = {item["name"]: item["id"] for item in api("/api/prompt-libraries")["data"] if item.get("is_default") != 1}
    report = {"batch": collection["batch"], "baseUrl": args.base_url, "projectId": project_id, "beforeCount": len(existing), "createdGroups": [], "imported": [], "skipped": []}

    def save_report():
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    for item in collection["prompts"]:
        key = digest(item["text"])
        if key in known:
            report["skipped"].append(item["key"])
            continue
        category = item["category"]
        if category not in groups:
            groups[category] = api("/api/prompt-libraries", {"name": category, "description": "公开设计案例精选；细分用途与标签见条目。"})["data"]["id"]
            report["createdGroups"].append(category)
        record = api("/api/prompts", {"projectId": project_id, "groupId": groups[category], "imageUrl": item.get("previewUrl"), "name": item["name"], "text": item["text"], "tags": json.dumps(item["tags"], ensure_ascii=False), "source": json.dumps(item["source"], ensure_ascii=False)})["prompt"]
        assert record["name"] == item["name"] and record["tags"] and record["source"], "Runtime must support prompt metadata before import"
        known.add(key)
        report["imported"].append({"id": record["id"], "key": item["key"], "name": item["name"], "category": category})
        save_report()
    final = api("/api/prompts")["prompts"]
    assert len(final) == len(existing) + len(report["imported"])
    assert all(item["id"] in {record["id"] for record in final} for item in existing)
    report["afterCount"] = len(final)
    report["verified"] = True
    save_report()
    print(json.dumps({"imported": len(report["imported"]), "skipped": len(report["skipped"]), "total": len(final), "verified": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
