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
            people: [
              { id: 'person-root', fullName: 'Тестовый корневой человек', birthDate: '', deathDate: '', country: '', place: '', motherId: 'person-child', fatherId: null, primaryMediaId: '', rememberFor: 'Тестирует ошибки.', bio: '', storyIds: [], mediaIds: [] },
              { id: 'person-child', fullName: 'Тестовый потомок', birthDate: '', deathDate: '', country: '', place: '', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Нужен для проверки цикла.', bio: '', storyIds: [], mediaIds: [] }
            ],
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
            await sleep(300);

            document.getElementById('newPersonButton').click();
            await sleep(80);
            set('fullName', '');
            set('rememberFor', 'Есть текст');
            document.getElementById('personForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await sleep(80);
            const emptyNameStatus = document.getElementById('editorStatus').textContent;

            set('personPicker', 'person-child');
            await sleep(80);
            set('motherId', 'person-root');
            document.getElementById('personForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await sleep(80);
            const cycleStatus = document.getElementById('editorStatus').textContent;

            document.getElementById('newMediaButton').click();
            await sleep(80);
            set('mediaTitle', 'Битый путь');
            set('mediaType', 'photo');
            set('mediaPath', '../secret.jpg');
            document.getElementById('mediaForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await sleep(80);
            const badPathStatus = document.getElementById('editorStatus').textContent;

            set('mediaPath', 'media/song.mp3');
            set('mediaType', 'photo');
            document.getElementById('mediaForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await sleep(80);
            const typeMismatchStatus = document.getElementById('editorStatus').textContent;

            return { emptyNameStatus, cycleStatus, badPathStatus, typeMismatchStatus };
          })();
        """)
        assert 'Укажите ФИО' in edit_result['emptyNameStatus'], edit_result
        assert 'цикл' in edit_result['cycleStatus'], edit_result
        assert 'media/' in edit_result['badPathStatus'], edit_result
        assert 'Тип медиа' in edit_result['typeMismatchStatus'], edit_result

        await navigate(f'{BASE_URL}/index.html')
        await evaluate(r"""
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            const archive = await window.FamilyArchive.loadArchive();
            archive.media.push({ id: 'missing-photo', type: 'photo', title: 'Несуществующее фото', path: 'media/no-such-file.jpg', personIds: ['person-root'], storyIds: [] });
            archive.people.find((person) => person.id === 'person-root').mediaIds.push('missing-photo');
            window.FamilyArchive.saveArchive(archive);
            return true;
          })();
        """)
        await navigate(f'{BASE_URL}/index.html')
        view_result = await evaluate(r"""
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            await sleep(500);
            const root = Array.from(document.querySelectorAll('[data-person-id]')).find((el) => el.textContent.includes('Тестовый корневой человек'));
            if (root) root.click();
            await sleep(700);
            const errors = Array.from(document.querySelectorAll('.media-error')).map((el) => el.textContent).filter(Boolean);
            return { errors };
          })();
        """)
        assert any('Файл не найден' in error for error in view_result['errors']), view_result
        print(json.dumps({'edit': edit_result, 'view': view_result}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
