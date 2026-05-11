#!/usr/bin/env python3
import asyncio
import json
import urllib.request

import websockets

DEVTOOLS_URL = 'http://127.0.0.1:9222'
BASE_URL = 'http://127.0.0.1:4177'


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
    async with websockets.connect(page_tab()['webSocketDebuggerUrl'], max_size=20_000_000) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
            while True:
                data = json.loads(await ws.recv())
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

        async def navigate(url):
            await send('Page.navigate', {'url': url})
            for _ in range(80):
                ready = await evaluate('document.readyState')
                if ready == 'complete':
                    return
                await asyncio.sleep(0.1)
            raise TimeoutError(f'Navigation timeout: {url}')

        await send('Page.enable')
        await send('Runtime.enable')

        await navigate(f'{BASE_URL}/edit.html')
        await evaluate(r"""
          localStorage.setItem('familyArchive.v1', JSON.stringify({
            version: 1,
            title: 'Тестовый семейный архив',
            rootPersonId: 'person-root',
            people: [{ id: 'person-root', fullName: 'Тестовый корневой человек', birthDate: '', deathDate: '', country: '', place: '', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Тестирует медиа.', bio: '', storyIds: [], mediaIds: [] }],
            stories: [],
            media: []
          }));
        """)
        await navigate(f'{BASE_URL}/edit.html')
        edit_result = await evaluate(r"""
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const set = (id, value) => {
              const el = document.getElementById(id);
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const selectOnly = (id, value) => {
              const el = document.getElementById(id);
              Array.from(el.options).forEach((option) => { option.selected = option.value === value; });
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const addMedia = async (title, type, path) => {
              document.getElementById('newMediaButton').click();
              await sleep(80);
              set('mediaTitle', title);
              set('mediaType', type);
              set('mediaPath', path);
              selectOnly('mediaPersonIds', 'person-root');
              document.getElementById('mediaForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              await sleep(120);
            };
            const addMediaViaFileInput = async (fileName, mimeType) => {
              document.getElementById('newMediaButton').click();
              await sleep(80);
              const input = document.getElementById('mediaFileInput');
              const data = new DataTransfer();
              data.items.add(new File(['demo'], fileName, { type: mimeType }));
              input.files = data.files;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(150);
              selectOnly('mediaPersonIds', 'person-root');
              document.getElementById('mediaForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              await sleep(120);
            };
            await sleep(300);
            await addMediaViaFileInput('demo-audio.mp3', 'audio/mpeg');
            await addMediaViaFileInput('demo-video.mp4', 'video/mp4');
            const saved = JSON.parse(localStorage.getItem('familyArchive.v1'));
            const root = saved.people.find((person) => person.id === 'person-root');
            return {
              audioLinked: saved.media.some((item) => item.type === 'audio' && item.path === 'media/demo-audio.mp3' && item.personIds.includes('person-root')),
              videoLinked: saved.media.some((item) => item.type === 'video' && item.path === 'media/demo-video.mp4' && item.personIds.includes('person-root')),
              rootMediaCount: root.mediaIds.length,
              mediaHint: document.getElementById('mediaFileHint').textContent
            };
          })();
        """)
        assert edit_result['audioLinked'], edit_result
        assert edit_result['videoLinked'], edit_result

        await navigate(f'{BASE_URL}/index.html')
        view_result = await evaluate(r"""
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            await sleep(500);
            const root = Array.from(document.querySelectorAll('[data-person-id]')).find((el) => el.textContent.includes('Тестовый корневой человек'));
            if (root) root.click();
            await sleep(250);
            const detail = document.getElementById('personDetail');
            return {
              hasAudioText: detail.innerText.includes('demo-audio'),
              hasVideoText: detail.innerText.includes('demo-video'),
              audioElement: Boolean(detail.querySelector('audio[src="media/demo-audio.mp3"]')),
              videoElement: Boolean(detail.querySelector('video[src="media/demo-video.mp4"]'))
            };
          })();
        """)
        assert view_result['hasAudioText'], view_result
        assert view_result['hasVideoText'], view_result
        assert view_result['audioElement'], view_result
        assert view_result['videoElement'], view_result
        print(json.dumps({'edit': edit_result, 'view': view_result}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
