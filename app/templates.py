from typing import Dict, List, Any

TEMPLATES: Dict[str, Dict[str, Any]] = {
    "blank": {
        "title": "Blank Editor (Empty)",
        "description": "Clean empty editor for writing and running your own Playwright code.",
        "python": "",
        "typescript": "",
        "javascript": ""
    }
}

def get_template_list() -> List[Dict[str, str]]:
    return [
        {
            "id": k,
            "title": v["title"],
            "description": v["description"]
        }
        for k, v in TEMPLATES.items()
    ]

def get_template_code(template_id: str, language: str) -> str:
    return ""
