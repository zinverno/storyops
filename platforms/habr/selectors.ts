/**
 * Every Habr-specific CSS selector lives here and only here. When Habr changes
 * its markup, update this file and the fixtures in fixtures/habr/.
 *
 * Each field lists selectors in order of preference; the parser uses the
 * first one that yields a value and records a warning when none do.
 */
export const HABR_SELECTORS = {
  list: {
    item: ['article.tm-articles-list__item', 'article[data-test-id="articles-list-item"]', 'div.tm-articles-list > article'],
    titleLink: ['a.tm-title__link', 'h2.tm-title a', 'h2 a[data-article-link]'],
    author: ['a.tm-user-info__username', '.tm-user-info__user a'],
    time: ['time[datetime]', '.tm-article-datetime-published time'],
    hubLink: ['a.tm-publication-hub__link', '.tm-publication-hubs a'],
    rating: ['.tm-votes-meter__value', '.tm-votes-lever__score-counter'],
    views: ['.tm-icon-counter[title*="просмотр" i] .tm-icon-counter__value', '.tm-icon-counter[title*="view" i] .tm-icon-counter__value', '.tm-data-icons .tm-icon-counter__value', '.tm-icon-counter__value'],
    bookmarks: ['.bookmarks-button__counter'],
    comments: ['.tm-article-comments-counter-link__value', '.tm-article-comments-counter-link a'],
    readingTime: ['.tm-article-reading-time__label'],
    nextPage: ['a[data-pagination-next-page]', 'a.tm-pagination__navigation-link[rel="next"]', 'a#pagination-next-page'],
    paginationLinks: ['a.tm-pagination__page', '.tm-pagination a'],
  },
  article: {
    title: ['h1.tm-title span', 'h1.tm-title', 'h1[data-test-id="articleTitle"]', 'h1'],
    author: ['.tm-article-presenter__header a.tm-user-info__username', 'a.tm-user-info__username'],
    time: ['.tm-article-presenter__header time[datetime]', '.tm-article-datetime-published time', 'time[datetime]'],
    body: ['#post-content-body .article-formatted-body', '.article-formatted-body', '#post-content-body', '.tm-article-body'],
    metaList: ['.tm-article-presenter__meta .tm-separated-list', '.tm-separated-list'],
    metaListTitle: ['.tm-separated-list__title'],
    metaListLink: ['a'],
    rating: ['.tm-article-presenter__footer .tm-votes-meter__value', '.tm-votes-meter__value', '.tm-votes-lever__score-counter'],
    views: ['.tm-article-presenter__header .tm-icon-counter__value', '.tm-icon-counter[title*="просмотр" i] .tm-icon-counter__value', '.tm-icon-counter__value'],
    bookmarks: ['.bookmarks-button__counter'],
    comments: ['.tm-article-comments-counter-link__value', '.tm-comments-wrapper__comments-count'],
    readingTime: ['.tm-article-reading-time__label'],
    jsonLd: ['script[type="application/ld+json"]'],
  },
} as const;
