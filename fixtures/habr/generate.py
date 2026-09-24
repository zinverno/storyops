#!/usr/bin/env python3
"""
Generates the Habr HTML fixtures in this directory.

The markup is a HAND-WRITTEN APPROXIMATION of Habr's public page structure
(class names such as tm-articles-list__item, tm-title__link, tm-votes-meter__value,
article-formatted-body). It is not captured from habr.com, and all articles,
authors, numbers and texts are fictional. When Habr changes its markup, capture
a real page into the cache (`editorial-kit research --platform habr`), compare,
and update platforms/habr/selectors.ts together with this generator.

Run: python3 fixtures/habr/generate.py
"""
import json, os, html

HERE = os.path.dirname(os.path.abspath(__file__))

def esc(s): return html.escape(s, quote=True)

def list_item(a, stats=True):
    hubs = ''.join(
        f'<span class="tm-publication-hub__link-container"><a href="/ru/hubs/{h}/" class="tm-publication-hub__link"><span>{esc(name)}</span><span title="Профильный хаб" class="tm-article-snippet__profiled-hub">*</span></a></span>'
        for h, name in a['hubs'])
    rating = '' if a.get('rating') is None else (
        f'<div class="tm-votes-meter tm-data-icons__item"><span title="Всего голосов {a["votes"]}: ↑{a["up"]} и ↓{a["down"]}" class="tm-votes-meter__value tm-votes-meter__value_positive tm-votes-meter__value_rating">{"+" if a["rating"] > 0 else ("–" if a["rating"] < 0 else "")}{abs(a["rating"])}</span></div>')
    views = '' if a.get('views') is None else f'<span class="tm-icon-counter tm-data-icons__item" title="Количество просмотров"><svg class="tm-svg-img"></svg><span class="tm-icon-counter__value">{a["views"]}</span></span>'
    bookmarks = '' if a.get('bookmarks') is None else f'<button class="bookmarks-button tm-data-icons__item" title="Добавить в закладки"><span class="bookmarks-button__counter" title="Количество пользователей, добавивших публикацию в закладки">{a["bookmarks"]}</span></button>'
    comments = '' if a.get('comments') is None else f'<div class="tm-article-comments-counter-link tm-data-icons__item"><a href="/ru/articles/{a["id"]}/comments/" class="tm-article-comments-counter-link__link"><span class="tm-article-comments-counter-link__value">Комментарии {a["comments"]}</span></a></div>'
    time_attr = f'datetime="{a["date"]}"' if a.get('date') else ''
    return f'''
<article id="{a["id"]}" data-test-id="articles-list-item" class="tm-articles-list__item">
  <div class="tm-article-snippet">
    <div class="tm-article-snippet__meta-container"><div class="tm-article-snippet__meta">
      <span class="tm-user-info tm-article-snippet__author"><span class="tm-user-info__user"><a href="/ru/users/{a["author"]}/" class="tm-user-info__username">{a["author"]}</a></span></span>
      <span class="tm-article-datetime-published"><a href="/ru/articles/{a["id"]}/" class="tm-article-datetime-published__link"><time {time_attr} title="{a.get("title_date", "")}">{a.get("display_date", "")}</time></a></span>
    </div></div>
    <h2 class="tm-title tm-title_h2"><a href="/ru/articles/{a["id"]}/" data-article-link="true" class="tm-title__link"><span>{esc(a["title"])}</span></a></h2>
    <div class="tm-article-snippet__stats"><span class="tm-article-reading-time"><span class="tm-article-reading-time__label">{a.get("reading", 8)} мин</span></span></div>
    <div class="tm-publication-hubs__container"><div class="tm-publication-hubs">{hubs}</div></div>
  </div>
  <div class="tm-data-icons tm-articles-list__item-footer">{rating}{views}{bookmarks}{comments}</div>
</article>'''

PROMO = '''
<article class="tm-articles-list__item tm-articles-list__item_promo"><div class="tm-promo-block">Реклама: промо-блок без заголовка статьи</div></article>'''

def list_page(items, next_href=None, extra=''):
    nav = ''
    if next_href:
        nav = f'<div class="tm-pagination"><a href="{next_href}" class="tm-pagination__page">2</a><a href="{next_href}" data-pagination-next-page="true" class="tm-pagination__navigation-link">Дальше</a></div>'
    body = ''.join(list_item(a) for a in items) + extra
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Habr fixture</title></head>
<body><div class="tm-layout"><main><div class="tm-articles-list">{body}</div>{nav}</main></div></body></html>
'''

def render_blocks(blocks):
    out = []
    for b in blocks:
        t = b[0]
        if t == 'p': out.append(f'<p>{b[1]}</p>')
        elif t == 'h2': out.append(f'<h2>{esc(b[1])}</h2>')
        elif t == 'h3': out.append(f'<h3>{esc(b[1])}</h3>')
        elif t == 'code': out.append(f'<pre><code class="{b[1]}">{esc(b[2])}</code></pre>')
        elif t == 'img': out.append(f'<figure class="full-width"><img src="{b[1]}" alt="{esc(b[2])}" width="800" height="400"><figcaption>{esc(b[3])}</figcaption></figure>')
        elif t == 'ul': out.append('<ul>' + ''.join(f'<li>{x}</li>' for x in b[1]) + '</ul>')
        elif t == 'quote': out.append(f'<blockquote>{b[1]}</blockquote>')
    return '\n'.join(out)

def article_page(a, blocks, tags):
    hubs = ''.join(f'<li class="tm-separated-list__item"><a href="/ru/hubs/{h}/" class="tm-hubs-list__link"><span>{esc(n)}</span></a></li>' for h, n in a['hubs'])
    tag_html = ''.join(f'<li class="tm-separated-list__item"><a href="/ru/search/?target_type=posts&amp;order=relevance&amp;q=%5B{esc(t)}%5D" class="tm-tags-list__link"><span>{esc(t)}</span></a></li>' for t in tags)
    rating = '' if a.get('rating') is None else f'<span title="Всего голосов {a["votes"]}: ↑{a["up"]} и ↓{a["down"]}" class="tm-votes-meter__value tm-votes-meter__value_rating">{"+" if a["rating"] > 0 else ("–" if a["rating"] < 0 else "")}{abs(a["rating"])}</span>'
    views = '' if a.get('views') is None else f'<span class="tm-icon-counter" title="Количество просмотров"><span class="tm-icon-counter__value">{a["views"]}</span></span>'
    ld = json.dumps({"@context": "http://schema.org", "@type": "Article", "headline": a['title'], "datePublished": a.get('date'), "author": {"@type": "Person", "name": a['author']}}, ensure_ascii=False)
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>{esc(a["title"])} / Хабр</title>
<script type="application/ld+json">{ld}</script></head>
<body><div class="tm-layout"><main><div class="tm-article-presenter">
<div class="tm-article-presenter__header">
  <span class="tm-user-info__user"><a href="/ru/users/{a["author"]}/" class="tm-user-info__username">{a["author"]}</a></span>
  <span class="tm-article-datetime-published"><time datetime="{a.get("date", "")}" title="">{a.get("display_date", "")}</time></span>
  {views}
  <h1 class="tm-title tm-title_h1" lang="ru" data-test-id="articleTitle"><span>{esc(a["title"])}</span></h1>
</div>
<div class="tm-article-presenter__body"><div class="tm-article-body"><div id="post-content-body"><div><div class="article-formatted-body article-formatted-body_version-2"><div xmlns="http://www.w3.org/1999/xhtml">
{render_blocks(blocks)}
</div></div></div></div></div></div>
<div class="tm-article-presenter__meta">
  <div class="tm-separated-list tm-article-presenter__meta-list"><span class="tm-separated-list__title">Теги:</span><ul class="tm-separated-list__list">{tag_html}</ul></div>
  <div class="tm-separated-list tm-article-presenter__meta-list"><span class="tm-separated-list__title">Хабы:</span><ul class="tm-separated-list__list">{hubs}</ul></div>
</div>
<div class="tm-article-presenter__footer"><div class="tm-data-icons">{rating}<span class="bookmarks-button__counter">{a.get("bookmarks", "")}</span><span class="tm-article-comments-counter-link__value">Комментарии {a.get("comments", 0)}</span></div></div>
</div></main></div></body></html>
'''

# ---------------------------------------------------------------- author ---
AUTHOR = 'demo_author'
HUB_OS = ('open_source', 'Open source')
HUB_PROG = ('programming', 'Программирование')
HUB_TS = ('typescript', 'TypeScript')

pub1 = dict(id='900001', author=AUTHOR, title='Notegarden: зачем я написал аудитор для заметок Obsidian',
            date='2025-02-03T09:00:00.000Z', display_date='3 фев 2025 в 12:00', hubs=[HUB_OS, HUB_PROG],
            rating=24, votes=28, up=26, down=2, views='4.2K', bookmarks=37, comments=15)
pub1_blocks = [
    ('p', 'За три года моё хранилище заметок в Obsidian выросло до четырёх тысяч файлов. Часть ссылок давно никуда не ведёт, часть заметок ни с чем не связана, а теги живут своей жизнью. Руками такое не проверишь, поэтому я написал Notegarden: небольшую утилиту, которая проходит по хранилищу и показывает, где оно запущено.'),
    ('h2', 'Откуда взялась проблема'),
    ('p', 'Obsidian хорошо помогает писать, но почти не помогает поддерживать порядок. Битую ссылку видно только тогда, когда по ней кликнешь. Заметку-сироту, на которую никто не ссылается, не видно вообще. Когда заметок сотни, это терпимо. Когда тысячи, хранилище постепенно превращается в свалку, в которой страшно что-то искать.'),
    ('p', 'Готовые плагины решали отдельные куски: один искал битые ссылки, другой показывал граф. Мне хотелось одного отчёта, который можно запустить из терминала и приложить к коммиту в репозиторий с заметками.'),
    ('h2', 'Что умеет первая версия'),
    ('p', 'Первая версия Notegarden делает разовый аудит. Она читает все markdown-файлы, прогоняет по ним набор правил и собирает отчёт. Правила пока простые:'),
    ('ul', ['битые вики-ссылки и ссылки на несуществующие вложения;', 'заметки-сироты без входящих ссылок;', 'пустые заметки и заметки только с заголовком;', 'теги, которые встречаются ровно один раз.']),
    ('p', 'Отчёт получается в markdown, поэтому его удобно читать прямо в Obsidian.'),
    ('h2', 'Как запустить'),
    ('code', 'bash', 'npx notegarden audit ~/Notes --report notegarden-report.md'),
    ('p', 'Аудит моего хранилища занимает около двадцати секунд на ноутбуке, но это не бенчмарк, а просто ощущение от запуска.'),
    ('h2', 'Что дальше'),
    ('p', 'В следующей статье расскажу, как устроен аудит внутри: раннер, правила и отчёт. Там же покажу, почему правила оказались удобнее, чем один большой скрипт.'),
]
pub2 = dict(id='900002', author=AUTHOR, title='Как устроен Notegarden: разовый аудит заметок изнутри',
            date='2025-03-10T09:00:00.000Z', display_date='10 мар 2025 в 12:00', hubs=[HUB_OS, HUB_TS],
            rating=31, votes=35, up=33, down=2, views='5.8K', bookmarks=64, comments=22)
pub2_blocks = [
    ('p', 'В прошлой статье я рассказал, зачем мне понадобился Notegarden. Теперь про то, как он устроен. Архитектура у первой версии намеренно простая: аудит запускается один раз, проходит по всему хранилищу и выдаёт отчёт. Никакого состояния между запусками нет.'),
    ('h2', 'Архитектура аудита'),
    ('p', 'Аудит состоит из трёх частей. Раннер в <code>src/audit/runner.ts</code> обходит хранилище и строит индекс заметок. Правила в <code>src/audit/rules.ts</code> получают индекс и возвращают находки. Модуль отчёта в <code>src/report/markdown.ts</code> превращает находки в markdown.'),
    ('code', 'typescript', "export async function runAudit(vault: string): Promise<Finding[]> {\n  const index = await buildIndex(vault);\n  return rules.flatMap((rule) => rule.check(index));\n}"),
    ('p', 'Индекс хранит для каждой заметки путь, заголовки, исходящие ссылки и теги. Входящие ссылки считаются вторым проходом, когда все заметки уже прочитаны. Индекс строится заново при каждом запуске аудита, и это главное упрощение первой версии.'),
    ('h2', 'Правила'),
    ('p', 'Каждое правило — это объект с идентификатором, описанием и функцией <code>check</code>. Правило ничего не знает про файловую систему: оно получает готовый индекс и возвращает список находок. Благодаря этому правила легко тестировать на маленьких синтетических индексах, без реального хранилища.'),
    ('code', 'typescript', "export const orphanNotes: Rule = {\n  id: 'orphan-note',\n  check: (index) => index.notes.filter((n) => n.incoming.length === 0).map(toFinding),\n};"),
    ('p', 'Находка в первой версии — это просто запись: правило, заметка, сообщение. У находки нет истории и нет статуса. Если запустить аудит завтра, он найдёт те же самые проблемы и не будет знать, что вчера они уже были.'),
    ('h2', 'Отчёт'),
    ('p', 'Отчёт группирует находки по правилам и сортирует по количеству. Сверху идёт сводка, дальше списки со ссылками на заметки. Так как ссылки в формате вики, по ним можно кликать прямо в Obsidian и сразу исправлять.'),
    ('p', 'Отчёт перезаписывается при каждом запуске. Сравнить два отчёта можно только через diff в git, и это неудобно: порядок строк меняется, если в хранилище добавилась хотя бы одна заметка.'),
    ('h2', 'Почему аудит разовый'),
    ('p', 'Разовый аудит было проще всего написать и проверить. Я хотел сначала понять, какие правила вообще полезны, и не тратить время на хранение состояния. Для хранилища на четыре тысячи заметок полный проход укладывается в секунды, поэтому инкрементальность казалась преждевременной оптимизацией.'),
    ('p', 'Но у этого решения есть цена. Аудит не помнит, какие находки я уже видел и сознательно оставил. Он не показывает динамику: стало ли хранилище лучше за месяц или хуже. И каждое новое правило приходится встраивать в общий проход, который постепенно разрастается.'),
    ('h2', 'Что дальше'),
    ('p', 'Планирую сделать анализ постоянным, чтобы не прогонять весь аудит с нуля при каждом запуске и видеть, как меняется состояние хранилища. Открытый вопрос — как хранить историю находок между запусками: в файлах рядом с заметками или в отдельной базе.'),
]

author_list = list_page([pub2, pub1], extra=PROMO)
tg_note = None

# ---------------------------------------------------------------- trends ---
def art(id, title, date, display, views, rating, votes, bookmarks, comments, hubs, author, reading=8):
    up = max(0, (votes + (rating or 0)) // 2) if rating is not None else 0
    down = max(0, votes - up) if rating is not None else 0
    return dict(id=str(id), title=title, date=date, display_date=display, views=views, rating=rating, votes=votes, up=up, down=down,
                bookmarks=bookmarks, comments=comments, hubs=hubs, author=author, reading=reading)

H_DEVOPS = ('devops', 'DevOps'); H_GO = ('go', 'Go'); H_PG = ('postgresql', 'PostgreSQL'); H_AI = ('artificial_intelligence', 'Искусственный интеллект'); H_ML = ('machine_learning', 'Машинное обучение')

trends = [
    art(910001, 'Почему наш планировщик задач терял события по ночам: разбор', '2026-09-22T09:00:00.000Z', 'позавчера в 12:00', '18K', 64, 70, 140, 58, [HUB_PROG, H_GO], 'fixture_author_a'),
    art(910002, 'Мы перенесли поиск с Elasticsearch на PostgreSQL и упёрлись в блокировки', '2026-09-21T07:00:00.000Z', '21 сен в 10:00', '14K', 48, 56, 120, 41, [H_PG, HUB_PROG], 'fixture_author_b'),
    art(910003, 'Утечка памяти в Go-сервисе, которую не видел профилировщик', '2026-09-23T06:00:00.000Z', 'вчера в 09:00', '9.1K', 39, 45, 90, 22, [H_GO], 'fixture_author_c'),
    art(910004, 'Как мы сократили время сборки монорепозитория с 40 до 7 минут', '2026-09-20T10:00:00.000Z', '20 сен в 13:00', '12K', 35, 41, 150, 30, [H_DEVOPS, HUB_PROG], 'fixture_author_d'),
    art(910005, 'Как ИИ меняет разработку: мысли после года с нейросетями', '2026-09-17T08:00:00.000Z', '17 сен в 11:00', '11K', 3, 61, 12, 25, [H_AI], 'fixture_author_e'),
    art(910006, 'Нейросеть в каждом проекте: зачем я добавил ИИ в свой pet-проект', '2026-09-18T12:00:00.000Z', '18 сен в 15:00', '6.5K', 2, 30, 8, 14, [H_AI, HUB_PROG], 'fixture_author_f'),
    art(910007, 'ИИ-ассистенты для программиста: обзор возможностей', '2026-09-19T09:00:00.000Z', '19 сен в 12:00', '7.2K', 5, 23, 30, 9, [H_AI], 'fixture_author_g'),
    art(910008, 'Будущее LLM в разработке: что нас ждёт', '2026-09-17T15:00:00.000Z', '17 сен в 18:00', '5.1K', -4, 40, 5, 31, [H_ML], 'fixture_author_h'),
    art(910009, 'Обзор новых возможностей TypeScript 6', '2026-09-18T09:00:00.000Z', '18 сен в 12:00', '8K', 12, 20, 60, 7, [HUB_TS], 'fixture_author_i'),
    art(910010, 'Как ИИ помог мне написать бота за вечер', '2026-09-19T18:00:00.000Z', '19 сен в 21:00', '4.3K', 1, 13, None, 6, [H_AI], 'fixture_author_j'),
    art(910011, 'Подборка инструментов для DevOps в 2026 году', '2026-09-20T08:00:00.000Z', '20 сен в 11:00', '3.9K', None, 0, 25, 3, [H_DEVOPS], 'fixture_author_k'),
]

GENERIC_INTRO = ('Разработка программного обеспечения постоянно меняется, и за последние годы вокруг нас появилось очень много новых инструментов. '
                 'Каждый месяц выходят новые сервисы, библиотеки и подходы, и за всем этим сложно уследить. В этой статье я хочу поделиться своими мыслями '
                 'и впечатлениями, которые накопились за долгое время работы. Возможно, кому-то они покажутся знакомыми, а кому-то помогут взглянуть на привычные вещи иначе.')

bodies = {
    '910001': [('p', 'Три недели подряд планировщик задач терял часть событий между двумя и четырьмя часами ночи. Ошибок в логах не было, метрики очереди выглядели нормально, но утром пользователи находили незапущенные задачи.'),
               ('h2', 'Как мы искали проблему'), ('p', 'Сначала подозревали брокер. Потом выяснилось, что в это окно срабатывает перенос партиций, и воркер подтверждал сообщение до записи результата.'),
               ('code', 'go', 'msg.Ack()\nif err := store.Save(result); err != nil {\n    return err\n}'),
               ('p', 'После переноса подтверждения за запись потери исчезли: за 14 дней наблюдения 0 потерянных событий против 30–40 в сутки раньше.'),
               ('h2', 'Почему это не ловили тесты'), ('p', 'Интеграционные тесты не перезапускали брокер посреди обработки.'),
               ('img', 'https://habrastorage.org/fixture/scheduler-diagram.png', 'Схема обработки событий', 'Схема до и после исправления'),
               ('h2', 'Что дальше'), ('p', 'Добавим хаос-тест на перенос партиций в CI.')],
    '910002': [('p', 'Мы перенесли полнотекстовый поиск с Elasticsearch на PostgreSQL, чтобы убрать отдельный кластер. Через неделю после переключения запросы на запись начали ждать блокировок по несколько секунд.'),
               ('h2', 'Как было'), ('p', 'Индекс обновлялся асинхронно отдельным сервисом.'),
               ('h2', 'Как стало'), ('p', 'Триггер обновлял tsvector в той же транзакции, что и основная запись, и держал блокировку строки дольше.'),
               ('code', 'sql', 'CREATE INDEX CONCURRENTLY idx_docs_search ON docs USING gin (search);'),
               ('p', 'После выноса обновления в очередь p95 записи вернулся к 40 ms.'),
               ('h2', 'Итоги'), ('p', 'Перенос оправдал себя, но только после изменения схемы обновления.')],
    '910003': [('p', 'Память Go-сервиса росла на 200 MB в сутки, а pprof показывал стабильный heap. Проблема оказалась за пределами того, что видит профилировщик.'),
               ('h2', 'Что показывал pprof'), ('p', 'Heap держался около 300 MB. RSS процесса при этом доходил до 2 GB к концу недели.'),
               ('code', 'go', 'debug.SetGCPercent(50)'),
               ('h2', 'Причина'), ('p', 'Память выделялась через cgo-библиотеку сжатия и не освобождалась при закрытии потока.'),
               ('h2', 'Выводы'), ('p', 'Смотрите на RSS, а не только на heap.')],
    '910004': [('p', 'Сборка монорепозитория занимала 40 минут, и разработчики перестали запускать её локально. Это стало главной проблемой команды.'),
               ('h2', 'Где уходило время'), ('p', 'Около 60% времени занимала повторная установка зависимостей в каждом пакете.'),
               ('code', 'yaml', 'cache:\n  key: deps-{{ checksum "package-lock.json" }}'),
               ('h2', 'Что изменили'), ('p', 'Общий кэш зависимостей и инкрементальная сборка сократили время до 7 минут.'),
               ('h2', 'Что дальше'), ('p', 'Следующий шаг: удалённый кэш артефактов.')],
    '910005': [('p', GENERIC_INTRO), ('p', 'Нейросети стали частью повседневной работы. Я пользуюсь ими каждый день и хочу рассказать о впечатлениях.'),
               ('h2', 'Мои впечатления'), ('p', 'Кажется, что инструменты станут ещё удобнее, а работа разработчика изменится.'),
               ('h2', 'Заключение'), ('p', 'Время покажет, куда всё это приведёт.')],
    '910006': [('p', GENERIC_INTRO), ('p', 'Я решил добавить нейросеть в свой pet-проект, потому что сейчас это делают все.'),
               ('h2', 'Что я сделал'), ('p', 'Подключил API и добавил кнопку, которая отправляет текст в модель.'),
               ('h2', 'Заключение'), ('p', 'Было интересно попробовать.')],
    '910007': [('p', GENERIC_INTRO), ('h2', 'Какие бывают ассистенты'), ('ul', ['автодополнение кода;', 'чат в редакторе;', 'генерация тестов.']),
               ('h2', 'Заключение'), ('p', 'Выбирайте инструмент под свои задачи.')],
    '910008': [('p', GENERIC_INTRO), ('h2', 'Что нас ждёт'), ('p', 'Модели будут становиться лучше, а инструменты удобнее.'), ('h2', 'Заключение'), ('p', 'А как думаете вы?')],
    '910009': [('p', 'В TypeScript 6 появилось несколько новых возможностей. Разберём основные.'),
               ('h2', 'Новые опции компилятора'), ('code', 'json', '{ "compilerOptions": { "strict": true } }'),
               ('h2', 'Изменения в выводе типов'), ('p', 'Вывод типов стал точнее в нескольких сценариях.'),
               ('h2', 'Итоги'), ('p', 'Обновляться стоит.')],
    '910010': [('p', GENERIC_INTRO), ('h2', 'Как это было'), ('p', 'Я попросил модель написать бота, и через вечер он заработал.'), ('h2', 'Заключение'), ('p', 'Попробуйте сами.')],
    '910011': [('p', GENERIC_INTRO), ('h2', 'Инструменты'), ('ul', ['мониторинг;', 'логи;', 'деплой.']), ('h2', 'Заключение'), ('p', 'Список будет пополняться.')],
}
tags = {k: ['разработка'] for k in bodies}

def write(name, content):
    with open(os.path.join(HERE, name), 'w', encoding='utf-8') as f:
        f.write(content)

write('author-list.html', author_list)
write('article-900001.html', article_page(pub1, pub1_blocks, ['obsidian', 'заметки', 'typescript']))
write('article-900002.html', article_page(pub2, pub2_blocks, ['obsidian', 'архитектура', 'typescript']))
# Duplicate item (910001 twice) exercises deduplication.
write('top-weekly.html', list_page(trends[:6] + [trends[0]] + trends[6:], extra=PROMO))
for a in trends:
    write(f'article-{a["id"]}.html', article_page(a, bodies[a['id']], tags[a['id']]))

# Article with no rating/bookmarks and no tags, hubs or JSON-LD: optional metrics missing.
minimal = dict(id='920001', author='fixture_author_z', title='Статья без метрик', date='2026-09-10T10:00:00.000Z', display_date='10 сен в 13:00', hubs=[], rating=None, views=None)
write('article-920001-minimal.html', article_page(minimal, [('p', 'Короткий текст без метрик.')], []).replace('<span class="bookmarks-button__counter"></span>', ''))
write('malformed.html', '<html><body><article class="tm-articles-list__item" id="930001"><h2 class="tm-title"><a class="tm-title__link" href="/ru/articles/930001/"><span>Незакрытая разметка<div><p>текст <b>без закрытия\n<article class="tm-articles-list__item"><div>нет ссылки</div>')

manifest = {
    "comment": "URL -> fixture file. Used by the offline demo to seed the HTTP cache so the real Habr adapter runs without network access.",
    "authorProfile": f"https://habr.com/ru/users/{AUTHOR}/",
    "pages": {
        f"https://habr.com/ru/users/{AUTHOR}/articles/": "author-list.html",
        "https://habr.com/ru/articles/900001/": "article-900001.html",
        "https://habr.com/ru/articles/900002/": "article-900002.html",
        "https://habr.com/ru/articles/top/weekly/": "top-weekly.html",
        **{f"https://habr.com/ru/articles/{a['id']}/": f"article-{a['id']}.html" for a in trends},
    },
}
write('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('ok')
