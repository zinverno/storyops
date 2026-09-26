"""Fictional Habr-like research datasets for the offline demo and tests.

Three weekly samples (2026-09-03, 09-10, 09-17) in the `storyops research import`
format: metadata, metrics and abstract structural features only (no article
text). Titles are invented. The share of generic AI titles rises week over
week (4, 6, 9 of 20); databases stay moderately active; notes/knowledge
management appears once.
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

AI = [
    "ИИ-агент для код-ревью: первые впечатления", "Как я подключил LLM к своему таск-трекеру", "Нейросети в поддержке: что получилось за месяц", "RAG для внутренней документации: практический опыт",
    "Пишем Telegram-бота с GPT за выходные", "Как ИИ меняет работу тестировщика", "Промпты для программиста: подборка приёмов", "ИИ-ассистент в IDE: полгода спустя",
    "LLM в продакшене: чек-лист перед запуском", "Зачем мне нейросеть в pet-проекте", "ИИ пишет тесты: эксперимент на реальном сервисе", "Нейросеть против легаси: попытка номер два",
    "ChatGPT как напарник: честный отчёт", "Как ИИ помогает мне учить Rust", "Генеративный ИИ в аналитике: где польза", "ИИ-агенты в CI: автоматизация ревью",
    "LLM и поиск по коду: что работает", "Нейросети для документации: обзор инструментов",
]
DB = [
    "PostgreSQL: разбираем план запроса на реальном примере", "SQLite как основное хранилище: опыт двух лет", "Миграции схемы без простоя в PostgreSQL",
    "Индексы в ClickHouse: где мы ошиблись", "Redis как очередь: подводные камни", "Храним события в SQLite: WAL и конкурентный доступ",
    "Как мы переносили данные из MySQL в PostgreSQL", "Партиционирование в PostgreSQL на практике", "Версионирование схемы базы данных в маленьком проекте",
]
OTHER = [
    "Микросервисы или монолит: наш опыт", "Event sourcing в небольшом сервисе", "Почему падал наш деплой по пятницам: разбор", "Профилировщик для Go: что он не показывает",
    "Тестирование конечных автоматов на примере платёжного модуля", "Kubernetes для маленькой команды: стоит ли", "Мониторинг очередей: метрики, которые помогли", "Собеседование на senior: что спрашивают в 2026",
    "Уязвимость в зависимостях: как мы её нашли", "Как устроен планировщик задач изнутри", "Ускоряем сборку фронтенда: кэши и параллелизм", "Логирование без боли: структурированные логи",
    "Рефакторинг легаси-модуля без остановки разработки", "Как мы тестируем миграции данных", "Обзор новых возможностей Python 3.14", "TypeScript: строгие типы в большом проекте",
    "Трассировка запросов в распределённой системе", "Инцидент с кэшем: хронология и выводы", "Как мы перестали терять события в очереди", "Code review в команде из трёх человек",
    "Монорепозиторий: полтора года спустя", "Обработка ошибок в Rust на практике", "Как мы внедряли feature flags", "Карьера разработчика после сорока",
    "Стриминг событий: Kafka или NATS", "Безопасность секретов в CI", "Документация как код: наш процесс", "Конечные автоматы для бизнес-логики",
    "Как мы считали SLO", "Пишем свой линтер", "Шаблоны отказоустойчивости: практический разбор", "Оптимизация холодного старта сервиса",
]
KM = ["Obsidian как база знаний команды"]

WEEKS = [
    ("2026-09-03T12:00:00Z", "2026-08-27", 4, 3, 0),
    ("2026-09-10T12:00:00Z", "2026-09-03", 6, 3, 1),
    ("2026-09-17T12:00:00Z", "2026-09-10", 9, 3, 0),
]
HUBS = {"ai": ["artificial_intelligence"], "db": ["postgresql"], "km": ["personal_productivity"], "other": ["programming"]}

def structure(i, top):
    words = 1400 + (i * 137) % 1800
    return {
        "wordCount": words, "introWords": 60 + (i * 31) % 140, "sectionCount": 4 + i % 5, "codeBlocks": (i * 3) % 6,
        "codeDensity": round(((i * 3) % 6) * 0.03, 3), "images": 1 + i % 4, "imagesPer1000Words": round((1 + i % 4) * 1000 / words, 2),
        "diagramHints": i % 2, "hasMeasurements": top or i % 3 == 0,
        "wordsBeforeFirstTechnicalDetail": 80 + (i * 17) % 200, "wordsBeforeConflict": 40 + (i * 7) % 90 if top else 220 + (i * 13) % 300,
        "conclusionKind": ["summary", "next-steps", "questions", "none"][i % 4], "postmortemStructure": False, "beforeAfterStructure": i % 5 == 0,
        "paragraphs": 18 + i % 9, "listBlocks": i % 4, "quoteBlocks": i % 2,
    }

counter = {"ai": 0, "db": 0, "other": 0, "km": 0}
for w, (collected, start, n_ai, n_db, n_km) in enumerate(WEEKS):
    kinds = ["ai"] * n_ai + ["db"] * n_db + ["km"] * n_km
    kinds += ["other"] * (20 - len(kinds))
    articles = []
    for i, kind in enumerate(kinds):
        pool = {"ai": AI, "db": DB, "km": KM, "other": OTHER}[kind]
        title = pool[counter[kind] % len(pool)]
        counter[kind] += 1
        n = 800000 + w * 100 + i
        day = int(start[8:10]) + (i % 7)
        month = int(start[5:7])
        if day > 31 and month == 8:
            day -= 31; month = 9
        if day > 30 and month == 9:
            day -= 30; month = 10
        published = f"2026-{month:02d}-{day:02d}T{8 + i % 10:02d}:00:00.000Z"
        views = 2500 + ((i * 7919 + w * 104729) % 23000)
        top = views > 15000
        articles.append({
            "id": f"habr:{n}", "url": f"https://habr.com/ru/articles/{n}/", "title": title,
            "author": f"author_{(i * 5 + w * 3) % 37:02d}", "publishedAt": published, "hubs": HUBS[kind], "tags": [],
            "metrics": {"views": views, "viewsApproximate": True, "rating": 3 + (views // 700) % 60, "bookmarks": 5 + (views // 300) % 140, "comments": 2 + (views // 900) % 70},
            "structure": structure(i + w * 20, top),
        })
    data = {"schemaVersion": 1, "platform": "habr", "collectedAt": collected, "label": f"fixture weekly sample {collected[:10]}", "window": "weekly", "articles": articles}
    with open(os.path.join(HERE, f"habr-weekly-{collected[:10]}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
print("ok")
