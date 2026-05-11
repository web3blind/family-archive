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


def page_tabs():
    return [tab for tab in fetch_json('/json/list') if tab.get('type') == 'page']


def find_or_first_tab():
    tabs = page_tabs()
    for tab in tabs:
        if tab.get('url', '').startswith(BASE_URL):
            return tab
    return tabs[0]


async def main():
    tab = find_or_first_tab()
    async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=20_000_000) as ws:
        msg_id = 0
        pending = {}
        events = []

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
            pending[msg_id] = method
            while True:
                data = json.loads(await ws.recv())
                if data.get('id') == msg_id:
                    if 'error' in data:
                        raise RuntimeError(data['error'])
                    return data.get('result', {})
                events.append(data)

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
        await send('Log.enable')

        await navigate(f'{BASE_URL}/edit.html')
        await evaluate(r"""
          localStorage.setItem('familyArchive.v1', JSON.stringify({
            version: 1,
            title: 'Тестовый семейный архив',
            rootPersonId: 'person-root',
            people: [
              { id: 'person-root', fullName: 'Тестовый корневой человек', birthDate: '1990', deathDate: '', country: 'Россия', place: 'Новосибирск', motherId: 'person-mother', fatherId: 'person-father', primaryMediaId: 'media-root', rememberFor: 'Тестирует семейный архив.', bio: 'Тестовая карточка.', storyIds: [], mediaIds: ['media-root'] },
              { id: 'person-mother', fullName: 'Тестовая мать', birthDate: '1965', deathDate: '', country: 'Россия', place: 'Тестовая область', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Тестовая мать.', bio: '', storyIds: [], mediaIds: [] },
              { id: 'person-father', fullName: 'Тестовый отец', birthDate: '1960', deathDate: '', country: 'Россия', place: 'Тестовый край', motherId: null, fatherId: null, primaryMediaId: '', rememberFor: 'Тестовый отец.', bio: '', storyIds: [], mediaIds: [] }
            ],
            stories: [],
            media: [{ id: 'media-root', type: 'photo', title: 'Тестовое фото', path: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 120 90%22%3E%3Crect width=%22120%22 height=%2290%22 fill=%22%23e5cfae%22/%3E%3Ctext x=%2260%22 y=%2248%22 text-anchor=%22middle%22 font-size=%2214%22%3EPhoto%3C/text%3E%3C/svg%3E', personIds: ['person-root'], storyIds: [] }]
          }));
        """)
        await navigate(f'{BASE_URL}/edit.html')
        edit_result = await evaluate(r"""
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
            await sleep(300);
            document.getElementById('newPersonButton').click();
            await sleep(100);
            const newId = document.getElementById('personId').value;
            set('fullName', 'Тестовая Мария Архивная');
            set('birthDate', '1945');
            set('country', 'Россия');
            set('place', 'Тестовая деревня');
            set('motherId', 'person-mother');
            set('fatherId', 'person-father');
            set('rememberFor', 'В тесте проверяет сохранение, связи и доступный просмотр.');
            set('bio', 'Добавлена автоматической проверкой через редактор.');
            document.getElementById('personForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await sleep(200);
            const saved = JSON.parse(localStorage.getItem('familyArchive.v1'));
            const person = saved.people.find((item) => item.id === newId);
            const exported = JSON.parse(document.getElementById('jsonOutput').value);
            exported.title = 'Импортированный тестовый семейный архив';
            document.getElementById('jsonOutput').value = JSON.stringify(exported, null, 2);
            document.getElementById('loadFromTextareaButton').click();
            await sleep(200);
            const imported = JSON.parse(localStorage.getItem('familyArchive.v1'));
            document.getElementById('exportButton').click();
            await sleep(100);
            return {
              newId,
              personSaved: Boolean(person && person.motherId === 'person-mother' && person.fatherId === 'person-father'),
              importedTitle: imported.title,
              status: document.getElementById('editorStatus').textContent,
              peopleCount: imported.people.length
            };
          })();
        """)
        assert edit_result['personSaved'], edit_result
        assert edit_result['importedTitle'] == 'Импортированный тестовый семейный архив', edit_result
        assert edit_result['peopleCount'] >= 4, edit_result

        await navigate(f'{BASE_URL}/index.html')
        view_result = await evaluate(r"""
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            await sleep(500);
            const text = document.body.innerText;
            const target = Array.from(document.querySelectorAll('[data-person-id]')).find((el) => el.textContent.includes('Тестовая Мария'));
            if (target) target.click();
            await sleep(250);
            const detail = document.getElementById('personDetail').innerText;
            const root = Array.from(document.querySelectorAll('[data-person-id]')).find((el) => el.textContent.includes('Тестовый корневой человек'));
            if (root) root.click();
            await sleep(150);
            const mediaButton = document.querySelector('[data-media-id]');
            if (!mediaButton) throw new Error('No media button for lightbox check');
            mediaButton.click();
            await sleep(150);
            const lightboxOpen = !document.getElementById('lightbox').hidden && document.activeElement.id === 'lightboxClose';
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(150);
            const lightboxClosed = document.getElementById('lightbox').hidden;
            return {
              title: document.getElementById('archiveTitle').textContent,
              hasTree: document.getElementById('ancestorTree').querySelectorAll('li').length >= 3,
              hasTestPerson: text.includes('Тестовая Мария Архивная'),
              detailHasParents: detail.includes('Тестовая мать') && detail.includes('Тестовый отец'),
              lightboxOpen,
              lightboxClosed,
              searchLabel: document.querySelector('label[for="peopleSearch"]')?.textContent.trim() || ''
            };
          })();
        """)
        assert view_result['title'] == 'Импортированный тестовый семейный архив', view_result
        assert view_result['hasTree'], view_result
        assert view_result['hasTestPerson'], view_result
        assert view_result['detailHasParents'], view_result
        assert view_result['lightboxOpen'] and view_result['lightboxClosed'], view_result
        assert 'Поиск' in view_result['searchLabel'], view_result

        print(json.dumps({'edit': edit_result, 'view': view_result}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
