// Search Engine JavaScript
document.getElementById('searchForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const query = document.getElementById('searchInput').value.trim();
    if (query) {
        await performSearch(query);
    }
});

const resultsListEl = document.getElementById('resultsList');
resultsListEl.addEventListener('click', async function(e) {
    const chip = e.target.closest('.suggestion-chip');
    if (!chip) {
        return;
    }
    const suggestion = chip.getAttribute('data-suggestion');
    if (suggestion) {
        document.getElementById('searchInput').value = suggestion;
        await performSearch(suggestion);
    }
});

async function performSearch(query) {
    const searchResults = document.getElementById('searchResults');
    const resultsList = resultsListEl;
    
    // Show loading state
    searchResults.classList.remove('hidden');
    resultsList.innerHTML = `
        <div class="text-center py-8">
            <div class="spinner mx-auto mb-4"></div>
            <p class="text-gray-600">Searching...</p>
        </div>
    `;

    try {
        const response = await fetch('https://satudata.jakarta.go.id/backend/api/v2/satudata/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                "q": query,
                "halaman": "all",
                "kategori": "all",
                "topik": "all",
                "organisasi": "all",
                "status": "all",
                "sort": "tanggal",
                "page_no": "1",
                "keywords": []
            })
        });

        const data = await response.json();
        await displayResults(data, query);
    } catch (error) {
        console.error('Search error:', error);
        resultsList.innerHTML = `
            <div class="text-center py-8">
                <p class="text-gray-600">Search failed. Please try again.</p>
            </div>
        `;
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeQuery(query) {
    return query
        .trim()
        .split(/[^a-zA-Z0-9\u00C0-\u00FF]+/)
        .filter(Boolean);
}

function highlightQuery(text, query) {
    if (!text || !query) {
        return text || '';
    }
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) {
        return text;
    }
    const pattern = tokens
        .map((token) => escapeRegExp(token))
        .sort((a, b) => b.length - a.length)
        .join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

let kbbiTermsCache = null;
let satuDataListCache = null;

function extractKbbiTerm(line) {
    const match = line.toLowerCase().match(/[a-zA-ZÀ-ÿ]+/);
    return match ? match[0] : '';
}

async function loadKbbiTerms() {
    if (kbbiTermsCache) {
        return kbbiTermsCache;
    }
    try {
        const response = await fetch('/misc/kbbi.txt');
        if (!response.ok) {
            kbbiTermsCache = [];
            return kbbiTermsCache;
        }
        const text = await response.text();
        const terms = text.split(/\r?\n/).map(extractKbbiTerm).filter(Boolean);
        kbbiTermsCache = terms;
        return kbbiTermsCache;
    } catch (error) {
        console.error('KBBI load error:', error);
        kbbiTermsCache = [];
        return kbbiTermsCache;
    }
}

async function loadSatuDataList() {
    if (satuDataListCache) {
        return satuDataListCache;
    }
    try {
        const response = await fetch('/misc/list_satudata.json');
        if (!response.ok) {
            satuDataListCache = [];
            return satuDataListCache;
        }
        const data = await response.json();
        satuDataListCache = Array.isArray(data) ? data : [];
        return satuDataListCache;
    } catch (error) {
        console.error('Satu Data list error:', error);
        satuDataListCache = [];
        return satuDataListCache;
    }
}

async function buildSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
        return [];
    }
    const [kbbiTerms, satuDataList] = await Promise.all([
        loadKbbiTerms(),
        loadSatuDataList()
    ]);
    const queryTokens = q.split(/[^a-zA-ZÀ-ÿ]+/).filter(Boolean);
    const qNorm = q.replace(/[^a-zA-ZÀ-ÿ]+/g, '');
    const correctedTokens = queryTokens.map((token) => {
        if (token.length < 3) {
            return token;
        }
        const candidates = kbbiTerms.filter((term) => term[0] === token[0] && Math.abs(term.length - token.length) <= 3);
        if (candidates.length === 0) {
            return token;
        }
        const best = candidates
            .map((term) => ({ term, score: damerauLevenshtein(token, term) }))
            .sort((a, b) => a.score - b.score)
            .slice(0, 1);
        return best.length > 0 ? best[0].term : token;
    });
    const correctedQuery = correctedTokens.join(' ').trim();
    const correctedNorm = correctedQuery.replace(/[^a-zA-ZÀ-ÿ]+/g, '');
    const kbbiMatches = kbbiTerms.filter((term) => term.startsWith(q) || term.includes(q)).slice(0, 50);
    const results = [];
    const scores = new Map();

    const addResult = (item, score) => {
        const prev = scores.get(item);
        if (prev === undefined || score < prev) {
            scores.set(item, score);
        }
    };

    const tokensFromItem = (item) => item
        .toLowerCase()
        .split(/[^a-zA-ZÀ-ÿ]+/)
        .filter(Boolean);

    satuDataList.forEach((item) => {
        const lower = item.toLowerCase();
        const itemNorm = lower.replace(/[^a-zA-ZÀ-ÿ]+/g, '');
        if (lower.includes(q)) {
            addResult(item, 0);
            return;
        }
        if (correctedTokens.length > 0) {
            let tokenHits = 0;
            correctedTokens.forEach((token) => {
                if (token.length > 2 && lower.includes(token)) {
                    tokenHits += 1;
                }
            });
            if (tokenHits > 0) {
                addResult(item, 1 + Math.max(0, correctedTokens.length - tokenHits));
                return;
            }
        }
        for (const term of kbbiMatches) {
            if (lower.includes(term)) {
                addResult(item, 1);
                break;
            }
        }

        const scoreOriginal = qNorm ? damerauLevenshtein(qNorm, itemNorm) : Number.POSITIVE_INFINITY;
        const scoreCorrected = correctedNorm ? damerauLevenshtein(correctedNorm, itemNorm) : Number.POSITIVE_INFINITY;
        const bestScore = Math.min(scoreOriginal, scoreCorrected);
        if (bestScore < Number.POSITIVE_INFINITY) {
            addResult(item, bestScore + 3);
        }
    });

    if (results.length === 0) {
        const firstChar = q[0];
        const candidates = kbbiTerms.filter((term) => term[0] === firstChar && Math.abs(term.length - q.length) <= 3);
        const nearest = candidates
            .map((term) => ({ term, score: damerauLevenshtein(q, term) }))
            .sort((a, b) => a.score - b.score)
            .slice(0, 10)
            .map((item) => item.term);

        satuDataList.forEach((item) => {
            const lower = item.toLowerCase();
            for (const term of nearest) {
                if (lower.includes(term)) {
                    addResult(item, 1);
                    break;
                }
            }
        });
    }

    if (scores.size === 0) {
        satuDataList.forEach((item) => {
            const tokens = tokensFromItem(item);
            let best = Number.POSITIVE_INFINITY;
            tokens.forEach((token) => {
                if (Math.abs(token.length - q.length) > 3) {
                    return;
                }
                const score = damerauLevenshtein(q, token);
                if (score < best) {
                    best = score;
                }
            });
            if (best < Number.POSITIVE_INFINITY) {
                addResult(item, best + 2);
            }
        });
    }

    scores.forEach((score, item) => {
        results.push({ item, score });
    });

    return results
        .sort((a, b) => a.score - b.score || a.item.length - b.item.length)
        .map((entry) => entry.item)
        .slice(0, 5);
}

function damerauLevenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
            if (
                i > 1 &&
                j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]
            ) {
                dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
            }
        }
    }
    return dp[a.length][b.length];
}

async function displayResults(data, query) {
    const resultsList = resultsListEl;
    
    if (!data.data || data.data.length === 0) {
        let emptyHtml = `
            <div class="text-center py-8">
                <p class="text-gray-600">No results found for "${query}"</p>
            </div>
        `;
        const suggestions = await buildSuggestions(query);
        const suggestionItems = suggestions.length > 0
            ? suggestions.map(item => `
                <span class="suggestion-chip" data-suggestion="${item}">${item}</span>
            `).join('')
            : `<span class="text-gray-600">Tidak ada saran.</span>`;
        emptyHtml += `
            <div class="suggestion-box">
                <p>Mungkin yang anda maksud:</p>
                <div class="suggestion-list">
                    ${suggestionItems}
                </div>
            </div>
        `;
        resultsList.innerHTML = emptyHtml;
        return;
    }

    const results = data.data.map(item => {
        const category = item.category || '';
        const pageUrl = item.url || '';
        const isDataset = category === 'dataset';
        const baseUrl = isDataset
            ? 'https://satudata.jakarta.go.id/open-data/detail'
            : 'https://satudata.jakarta.go.id/statistik-sektoral/detail';
        const dataNoParam = isDataset ? '&data_no=1' : '';
        const detailUrl = `${baseUrl}?kategori=${encodeURIComponent(category)}&page_url=${encodeURIComponent(pageUrl)}${dataNoParam}`;
        const title = highlightQuery(item.title || 'Untitled', query);
        return `
        <article class="result-card">
            <div>
                <h4 class="result-title">
                    <a href="${detailUrl}" target="_blank" class="result-link">
                        ${title}
                    </a>
                </h4>
                <p class="result-date">
                    ${item.date_created ? new Date(item.date_created).toLocaleDateString() : 'No date'}
                </p>
            </div>
            <span class="badge">
                ${item.category || 'No category'}
            </span>
        </article>
    `;
    }).join('');

    resultsList.innerHTML = `
        <div class="results-count">
            Found ${data.data.length} results for "${query}"
        </div>
        ${results}
    `;
}

// Focus on input when page loads
document.getElementById('searchInput').focus();

const searchPage = document.body;
const updateScrollBlur = () => {
    if (window.scrollY > 10) {
        searchPage.classList.add('is-scrolled');
    } else {
        searchPage.classList.remove('is-scrolled');
    }
};

updateScrollBlur();
window.addEventListener('scroll', updateScrollBlur, { passive: true });
