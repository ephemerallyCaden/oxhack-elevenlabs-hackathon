"""Local login and narrow launch adapter for the pinned chigwell Telegram MCP."""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path.home() / ".local" / "share" / "reference-loop-telegram"
PRIVATE = ROOT / "private"
ALLOWED = {"search_public_chats", "resolve_username", "get_chat", "search_messages",
           "get_history", "get_message_context", "get_message_link"}


def private_dir():
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "nt":
        user = subprocess.check_output(["whoami"], text=True).strip()
        subprocess.run(["icacls", str(PRIVATE), "/inheritance:r", "/grant:r", user + ":(OI)(CI)F"],
                       check=True, stdout=subprocess.DEVNULL)
    else:
        PRIVATE.chmod(0o700)


async def login(client_name):
    from telethon import TelegramClient
    private_dir()
    config = PRIVATE / f"{client_name}.json"
    if config.exists():
        raise ValueError("A local account configuration already exists; preserve it and run the connection check first.")
    print("Enter credentials from https://my.telegram.org/apps in this local terminal. They will not be printed.")
    api_id = getpass.getpass("API ID: ").strip()
    api_hash = getpass.getpass("API hash: ").strip()
    if not api_id.isdecimal() or not api_hash:
        raise ValueError("Both a numeric API ID and API hash are required.")
    session = PRIVATE / f"{client_name}.session"
    client = TelegramClient(str(session), int(api_id), api_hash, device_model="Reference loop " + client_name)
    try:
        await client.start(phone=lambda: getpass.getpass("Telegram phone number: "),
                           code_callback=lambda: getpass.getpass("Telegram login code: "),
                           password=lambda: getpass.getpass("Telegram two-step password: "))
        if not await client.is_user_authorized():
            raise ValueError("Telegram account authorization is incomplete.")
        with config.open("x", encoding="utf-8") as f:
            json.dump({"api_id": int(api_id), "api_hash": api_hash, "session": str(session)}, f)
        if os.name != "nt":
            config.chmod(0o600)
            session.chmod(0o600)
        print("Login saved locally. No channel was joined and no research message was sent.")
    finally:
        await client.disconnect()


def restrict_tools(runtime):
    for tool in list(runtime.mcp._tool_manager.list_tools()):
        if tool.name not in ALLOWED:
            runtime.mcp.remove_tool(tool.name)
    actual = {t.name for t in runtime.mcp._tool_manager.list_tools()}
    if actual != ALLOWED or any(not t.annotations or not t.annotations.readOnlyHint for t in runtime.mcp._tool_manager.list_tools()):
        raise ValueError("Upstream tool contract changed; refusing to expose unexpected tools.")


def serve(client_name):
    config = PRIVATE / f"{client_name}.json"
    if not config.exists():
        raise ValueError(f"Local Telegram login missing. Run account.py login --client {client_name} in your own terminal.")
    settings = json.loads(config.read_text(encoding="utf-8"))
    # Do not inherit unrelated account/session settings into this dedicated connector.
    for key in list(os.environ):
        if key.startswith("TELEGRAM_"):
            del os.environ[key]
    os.environ.update({"TELEGRAM_API_ID": str(settings["api_id"]), "TELEGRAM_API_HASH": settings["api_hash"],
                       "TELEGRAM_SESSION_NAME": settings["session"], "TELEGRAM_EXPOSED_TOOLS": "read-only",
                       "TELEGRAM_TRANSCRIBE": "off", "TELEGRAM_EVENT_FEED": "off", "PYTHON_DOTENV_DISABLED": "1"})
    os.chdir(PRIVATE)
    import main as upstream
    from telegram_mcp import runtime
    restrict_tools(runtime)
    sys.argv = [sys.argv[0]]
    upstream.main()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["login", "serve", "status"])
    parser.add_argument("--client", choices=["codex", "claude"], default="codex")
    args = parser.parse_args()
    if args.action == "status":
        print(json.dumps({"client": args.client, "local_configuration_present": (PRIVATE / f"{args.client}.json").exists(),
                          "authenticated_runtime_verified": False}))
    elif args.action == "login":
        asyncio.run(login(args.client))
    else:
        serve(args.client)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception as exc:
        print("Telegram operation failed: " + type(exc).__name__ + ". Credentials were not logged.", file=sys.stderr)
        sys.exit(1)
