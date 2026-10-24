"""Focused protocol, real public fetch and read-only boundary checks. No account login."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from public_server import channel_name, parse_preview

HERE = Path(__file__).resolve().parent


def local_checks():
    for invalid in ["https://localhost/", "../private", "-10012345", "a?x=y"]:
        try:
            channel_name(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("Non-channel input accepted")
    fixture = '<div data-post="demo_chan/42"><div class="tgme_widget_message_text"><b>A &amp; B</b><br>context <a href="https://example.org/source">source</a></div><time datetime="2026-10-24T00:00:00Z"></time></div><div data-post="demo_chan/42"></div>'
    posts, count = parse_preview(fixture, "demo_chan")
    assert count == 1 and posts[0]["body"] == "A & B\ncontext source"
    assert posts[0]["links"] == ["https://example.org/source"]
    assert posts[0]["created_at"] == "2026-10-24T00:00:00Z"
    env = {k: v for k, v in os.environ.items() if not k.startswith("TELEGRAM_")}
    env.update(TELEGRAM_API_ID="12345", TELEGRAM_API_HASH="synthetic-offline-contract-check",
               TELEGRAM_SESSION_NAME=":memory:", TELEGRAM_EXPOSED_TOOLS="read-only",
               TELEGRAM_TRANSCRIBE="off", PYTHON_DOTENV_DISABLED="1")
    contract = 'import telethon; original = telethon.TelegramClient; telethon.TelegramClient = lambda session, *a, **kw: original(None, *a, **kw); import main; from telegram_mcp import runtime; from account import restrict_tools, ALLOWED; restrict_tools(runtime); runtime._apply_exposed_tools_mode(); assert {t.name for t in runtime.mcp._tool_manager.list_tools()} == ALLOWED; print("read-only contract passed: 7 tools; in-memory session, no network/authentication")'
    result = subprocess.run([sys.executable, "-c", contract], cwd=HERE, env=env, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr[-2500:])
    return {"username_boundary": "passed", "nested_text_dates_links_and_dedup": "passed", "account_tool_contract": "passed (offline only; seven read-only tools)"}


def result_json(result):
    if result.isError:
        raise RuntimeError(str(result.content))
    if result.structuredContent:
        return result.structuredContent
    return json.loads(next(c.text for c in result.content if c.type == "text"))


async def live_check(output):
    report = {"local_checks": local_checks(), "account_live_acceptance": "not run; requires owner login"}
    params = StdioServerParameters(command=sys.executable, args=[str(HERE / "public_server.py")])
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            listing = await session.list_tools()
            assert {t.name for t in listing.tools} == {"telegram_read_public_channel", "telegram_search_public_preview"}
            assert all(t.annotations.readOnlyHint for t in listing.tools)
            read = result_json(await session.call_tool("telegram_read_public_channel", {"channel": "godotid"}))
            assert read["comments"] and read["coverage"]["complete_history"] is False
            search = result_json(await session.call_tool("telegram_search_public_preview", {"channel": "godotid", "query": "godot"}))
            assert search["comments"] and all("godot" in p["body"].casefold() for p in search["comments"])
            rejected = await session.call_tool("telegram_read_public_channel", {"channel": "https://localhost/"})
            assert rejected.isError
            report.update({"protocol": "MCP initialize/list_tools/call_tool passed over stdio", "tools": [t.name for t in listing.tools],
                           "public_read": {"posts": len(read["comments"]), "source": read["source"]["url"], "coverage": read["coverage"]},
                           "preview_search": {"query": "godot", "matching_posts": len(search["comments"])}, "invalid_input": "MCP tool error as expected",
                           "native_client_acceptance": "not established by this SDK protocol trial"})
    output.mkdir(parents=True, exist_ok=True)
    for filename, value in [("public-observation.json", read), ("acceptance.json", report)]:
        with (output / filename).open("x", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    asyncio.run(live_check(parser.parse_args().output))
