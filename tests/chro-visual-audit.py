#!/usr/bin/env python3
import asyncio
import base64
import json
from pathlib import Path
import urllib.request

import websockets

DEVTOOLS_URL = 'http://127.0.0.1:9222'
BASE_URL = 'http://127.0.0.1:4177'
OUT_DIR = Path('tests/screenshots')


def fetch_json(path):
    with urllib.request.urlopen(f'{DEVTOOLS_URL}{path}', timeout=10) as resp:
        return json.loads(resp.read().decode())


def page_tab():
    tabs = [tab for tab in fetch_json('/json/list') if tab.get('type') == 'page']
    for tab in tabs:
        if tab.get('url', '').startswith(BASE_URL):
            return tab
    return tabs[0]


async def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with websockets.connect(page_tab()['webSocketDebuggerUrl'], max_size=50_000_000) as ws:
        msg_id = 0
        console = []

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
            while True:
                data = json.loads(await ws.recv())
                if data.get('method') in {'Runtime.consoleAPICalled', 'Log.entryAdded'}:
                    console.append(data)
                    continue
                if data.get('id') == msg_id:
                    if 'error' in data:
                        raise RuntimeError(data['error'])
                    return data.get('result', {})

        async def evaluate(expression):
            result = await send('Runtime.evaluate', {
                'expression': expression,
                'awaitPromise': True,
                'returnByValue': True
            })
            if result.get('exceptionDetails'):
                raise RuntimeError(result['exceptionDetails'])
            return result.get('result', {}).get('value')

        async def navigate(path):
            await send('Page.navigate', {'url': f'{BASE_URL}/{path}'})
            for _ in range(100):
                if await evaluate('document.readyState') == 'complete':
                    return
                await asyncio.sleep(0.1)
            raise TimeoutError(path)

        async def set_viewport(width, height):
            await send('Emulation.setDeviceMetricsOverride', {
                'width': width,
                'height': height,
                'deviceScaleFactor': 1,
                'mobile': width < 700
            })

        async def screenshot(name):
            result = await send('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True})
            path = OUT_DIR / name
            path.write_bytes(base64.b64decode(result['data']))
            return str(path)

        await send('Page.enable')
        await send('Runtime.enable')
        await send('Log.enable')
        await navigate('edit.html')
        await evaluate(r"""
          localStorage.setItem('familyArchive.v1', JSON.stringify({
            version: 1,
            title: 'Тестовый семейный архив',
            rootPersonId: 'person-root',
            people: [
              { id: 'person-root', fullName: 'Тестовый корневой человек', birthDate: '1990', deathDate: '', country: 'Россия', place: 'Новосибирск', motherId: 'person-mother', fatherId: 'person-father', primaryMediaId: '', rememberFor: 'Тестирует просмотр.', bio: '', storyIds: [], mediaIds: [] },
              { id: 'person-mother', fullName: 'Тестовая мать', birthDate: '', deathDate: '', country: '', place: '', motherId: 'person-grandmother', fatherId: null, primaryMediaId: '', rememberFor: 'Тестовая карточка.', bio: '', storyIds: [], mediaIds: [] },
              { id: 'person-father', fullName: 'Тестовый отец', birthDate: '', deathDate: '', country: '', place: '', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Тестовая карточка.', bio: '', storyIds: [], mediaIds: [] },
              { id: 'person-grandmother', fullName: 'Тестовая бабушка', birthDate: '', deathDate: '', country: '', place: '', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Тестовая карточка.', bio: '', storyIds: [], mediaIds: [] },
              { id: 'person-relative', fullName: 'Тестовый родственник', birthDate: '', deathDate: '', country: '', place: '', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Тестовая карточка.', bio: '', storyIds: [], mediaIds: [] }
            ],
            stories: [],
            media: []
          }));
        """)
        console.clear()

        shots = []
        metrics = {}
        for width, height, suffix in [(1366, 900, 'desktop'), (390, 844, 'mobile')]:
            await set_viewport(width, height)
            await navigate('edit.html')
            await evaluate("document.getElementById('mediaHeading').scrollIntoView()")
            shots.append(await screenshot(f'edit-{suffix}.png'))
            metrics[f'edit-{suffix}'] = await evaluate(r"""
              (() => {
                const body = document.body;
                const required = ['editorStartHeading','archiveSettingsHeading','personFormHeading','storiesHeading','mediaHeading','importExportHeading'];
                return {
                  title: document.title,
                  scrollWidth: body.scrollWidth,
                  clientWidth: document.documentElement.clientWidth,
                  horizontalOverflow: body.scrollWidth > document.documentElement.clientWidth + 2,
                  hasSteps: required.every((id) => Boolean(document.getElementById(id))),
                  buttons: Array.from(document.querySelectorAll('button')).map((button) => button.textContent.trim()).filter(Boolean),
                  emptyLabels: Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => !el.labels?.length && !el.getAttribute('aria-label') && el.type !== 'hidden').map((el) => el.id)
                };
              })();
            """)

            await navigate('index.html')
            await evaluate("document.getElementById('personDetail').scrollIntoView()")
            shots.append(await screenshot(f'index-{suffix}.png'))
            metrics[f'index-{suffix}'] = await evaluate(r"""
              (() => {
                const body = document.body;
                return {
                  title: document.title,
                  scrollWidth: body.scrollWidth,
                  clientWidth: document.documentElement.clientWidth,
                  horizontalOverflow: body.scrollWidth > document.documentElement.clientWidth + 2,
                  cards: document.querySelectorAll('.person-card').length,
                  treeNodes: document.querySelectorAll('.tree-node').length,
                  hasLightbox: Boolean(document.getElementById('lightbox')),
                  emptyButtons: Array.from(document.querySelectorAll('button')).filter((button) => !button.textContent.trim() && !button.getAttribute('aria-label')).length
                };
              })();
            """)

        error_entries = [entry for entry in console if 'error' in json.dumps(entry, ensure_ascii=False).lower()]
        print(json.dumps({'screenshots': shots, 'metrics': metrics, 'consoleErrorEvents': len(error_entries), 'consoleErrors': error_entries[:5]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
