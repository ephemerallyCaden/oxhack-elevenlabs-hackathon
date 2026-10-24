"""Inspect the installed upstream feed server using its real MCP protocol."""
import asyncio
import json
from pathlib import Path
import sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

HERE = Path(__file__).resolve().parent
EXE = Path.home() / ".local/share/reference-loop-feeds/v2.7.0" / ("feed-mcp.exe" if sys.platform == "win32" else "feed-mcp")


async def main():
    params = StdioServerParameters(command=str(EXE), args=["run", "--timeout=15s", "--retry-max-attempts=1", "--opml", str(HERE / "sources.opml")])
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            listing = await session.list_tools()
            print(json.dumps({"tools": [t.name for t in listing.tools]}))
            resources = await session.list_resources()
            report = {"version": "2.7.0", "transport": "MCP stdio", "feeds": [], "coverage": "Feed items are discovery leads; original-thread comments must be read separately."}
            for resource in resources.resources:
                uri = str(resource.uri)
                if uri.endswith('/items'):
                    feed_id = uri[len('feeds://feed/'):-len('/items')]
                    result = await session.call_tool('get_syndication_feed_items', {'ID': feed_id, 'includeContent': False})
                    assert not result.isError, feed_id
                    texts = [c.text for c in result.content if c.type == 'text']
                    report['feeds'].append({'id': feed_id, 'name': resource.name, 'tool_success': True, 'sample': '\n'.join(texts)[:900]})
            output = Path(sys.argv[1])
            with output.open('x', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            print(json.dumps({'feeds_read': len(report['feeds'])}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
