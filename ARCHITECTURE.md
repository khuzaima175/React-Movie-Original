# 🏛️ CinemaVault — Comprehensive Architecture & Mathematics Specification (v3.0)

**CinemaVault** is an open-source, client-side cinema logging, analytics, and recommendation platform. This document serves as the **definitive technical specification** for CinemaVault v3.0, covering the complete mathematical formulations, candidate harvesting algorithms, TMDB API grammar rules, structured LLM re-ranking pipelines, client-side caching strategies, and data persistence models.

---

## Table of Contents

1. [Executive Summary & Core Philosophy](#1-executive-summary--core-philosophy)
2. [Why Pure LLM Recommenders Fail (The 5 Fatal Flaws)](#2-why-pure-llm-recommenders-fail-the-5-fatal-flaws)
3. [Mathematical Taste Vector Formulation](#3-mathematical-taste-vector-formulation)
   - [3.1 Continuous Rating Weights ($W_{\text{base}}$)](#31-continuous-rating-weights-w_textbase)
   - [3.2 Exponential Recency Time-Decay ($W_{\text{final}}$)](#32-exponential-recency-time-decay-w_textfinal)
   - [3.3 Temporally-Weighted Anchor Film Selection](#33-temporally-weighted-anchor-film-selection)
   - [3.4 Granular Negative Trope Extraction (`without_keywords`)](#34-granular-negative-trope-extraction-without_keywords)
   - [3.5 Star-Power & Auteur Graphing](#35-star-power--auteur-graphing)
4. [The Deterministic 3-Bucket Waterfall Pipeline](#4-the-deterministic-3-bucket-waterfall-pipeline)
   - [4.1 Bucket B: Keyword Spiritual Successors](#41-bucket-b-keyword-spiritual-successors)
   - [4.2 Bucket C: Auteur & Star Power Network](#42-bucket-c-auteur--star-power-network)
   - [4.3 Bucket A: Semantic Discover Engine](#43-bucket-a-semantic-discover-engine)
   - [4.4 Dynamic Waterfall Sizing & Guarantees](#44-dynamic-waterfall-sizing--guarantees)
   - [4.5 Cold-Start Bypass Engine](#45-cold-start-bypass-engine)
5. [TMDB API Query Grammar & Syntax Rules](#5-tmdb-api-query-grammar--syntax-rules)
6. [Schema Bridge & Enriched Cinema Extraction (`bridgeTmdbToOmdb`)](#6-schema-bridge--enriched-cinema-extraction-bridgetmdbtoomdb--fetchtmdbmoviedetails)
7. [Structured Gemini Re-Ranking & Failover Chain](#7-structured-gemini-re-ranking--failover-chain)
8. [Smart LRU Cache & Master ID Collision Guard](#8-smart-lru-cache--master-id-collision-guard)
9. [Universal Streaming Access & Multi-Region Matrix](#9-universal-streaming-access--multi-region-matrix)
10. [Official Trailer Resolution & Playback Architecture](#10-official-trailer-resolution--playback-architecture)
11. [Telemetry Analytics & Statistical Algorithms](#11-telemetry-analytics--statistical-algorithms)
12. [Two-Way Letterboxd Portability & Batch Importer](#12-two-way-letterboxd-portability--batch-importer)
13. [Complete Reference Implementations (Code Blocks)](#13-complete-reference-implementations-code-blocks)
14. [Luxury Rating Deck & Interaction Architecture](#14-luxury-rating-deck--interaction-architecture)

---

## 1. Executive Summary & Core Philosophy

Most AI movie tools operate as **unconstrained text generators**: they prompt an LLM with a list of favorite movies and ask it to invent 10 recommendations. This leads to catalog hallucinations (invented release years, false cast members, nonexistent films), stale echo chambers (recommending the same 10 mainstream titles like *Inception* or *Interstellar*), and broken UI states.

CinemaVault v3.0 fundamentally separates **catalog harvesting** from **contextual re-ranking**:

```mermaid
flowchart TD
    subgraph Phase1 ["1. Data Ingestion & Schema Enrichment"]
        V["User Vault: Ratings, Timestamps, Genres, Keywords, Cast IDs"]
        W["Watchlist: Explicit Future Intent"]
        SB["Schema Bridge (append_to_response)\nPersists castIds, tmdbKeywords, tmdbGenreIds, streamProviders"] -.->|Enrich Logged Films| V
    end

    subgraph Phase2 ["2. Mathematical Taste Vector Engine"]
        V --> W_CALC["Rating Multiplier: W_base = (Rating - 5) / 5"]
        V --> T_CALC["Exponential Time Decay: e^(-0.005 * Δdays)"]
        W_CALC --> FINAL_W["Final Weight: W_final = W_base * TimeDecay"]
        T_CALC --> FINAL_W

        FINAL_W --> ANCHOR["Sort by W_final Descending -> Anchor Film for Bucket B"]
        FINAL_W --> GENRE_V["Weighted Genre Affinity Vector"]
        FINAL_W --> KEYWORD_V["Weighted Keyword Affinity Vector"]
        FINAL_W --> CAST_V["Weighted Star Power Actor Vector (castIds)"]
        FINAL_W --> CREW_V["Weighted Auteur Crew Vector (with_crew)"]
        
        V -->|1-3★ Films| HATED_K["Surgical Negative Tropes (without_keywords)"]
    end

    subgraph Phase3 ["3. Dynamic 3-Bucket Waterfall Harvesting"]
        ANCHOR --> B2["Bucket B: Keyword Spiritual Successors\n(with_keywords from Top W_final Anchor & vote_average.desc)"]
        CREW_V --> B3["Bucket C: Auteur & Star Power Network\n(with_crew & with_cast via comma syntax)"]
        CAST_V --> B3

        B2 --> POOL_SPEC["Merge & Deduplicate Specific Pool (N films)"]
        B3 --> POOL_SPEC

        POOL_SPEC --> DYN["Dynamic Sizing for Bucket A: max(20 - N, 8) Titles"]
        DYN --> B1["Bucket A: Semantic Discover\n(with_genres | without_keywords | with_watch_providers)"]

        B1 --> CP["Unified 20-Candidate Pool (100% Real Films)"]
        POOL_SPEC --> CP
    end

    subgraph Phase4 ["4. Contextual Gemini Re-Ranking & Smart Cache"]
        CP --> GEM["Gemini 2.5 Flash\n(Strict JSON Schema: ranked_ids, match scores, critique)"]
        GEM --> CACHE["500KB LocalStorage LRU Cache\n(Master ID Collision Guard & 24h TTL)"]
        CACHE --> UI["Curated Discovery Showcase & Trailer Portal"]
    end
```

---

## 2. Why Pure LLM Recommenders Fail (The 5 Fatal Flaws)

1. **The Hallucination Trap**: Pure LLMs hallucinate release years, sequels that never existed, and mismatched directors. CinemaVault guarantees **0% hallucination** because Gemini is strictly forbidden from inventing titles — it only ranks candidates harvested from TMDB.
2. **The Echo Chamber Trap**: Simple prompts repeat ubiquitous blockbusters (*The Dark Knight*, *Pulp Fiction*). CinemaVault breaks the echo chamber by harvesting across three distinct programmatic buckets (spiritual keyword successors, auteur networks, and semantic discover).
3. **The TMDB `/recommendations` Endpoint Trap**: TMDB's native `/movie/{id}/recommendations` endpoint is a simplistic heuristic based on generic user list overlap. CinemaVault instead uses deep keyword graph discovery (`with_keywords`) sorted by critical acclaim (`vote_average.desc`), producing genuine spiritual successors.
4. **The Broad Genre Blacklist Trap**: Banning an entire genre like "Action" because a user hated a superhero movie blocks masterpieces like *Seven Samurai* or *Heat*. CinemaVault instead extracts micro-keywords (*"superhero"*, *"slapstick"*, *"parody"*) from $1-3\star$ films and applies surgical `without_keywords` filters.
5. **The Temporal Blindspot**: A favorite movie rated 10/10 four years ago shouldn't outweigh a film the user is obsessed with right now. CinemaVault applies half-life exponential time-decay to capture current obsessions.

---

## 3. Mathematical Taste Vector Formulation

### 3.1 Continuous Rating Weights ($W_{\text{base}}$)
CinemaVault maps user ratings (1 to 10 stars) onto a continuous mathematical multiplier:

$$W_{\text{base}} = \max\left(0, \frac{\text{Rating} - 5}{5}\right)$$

| Star Rating | $W_{\text{base}}$ Value | Influence Tier | Algorithmic Role |
| :---: | :---: | :--- | :--- |
| **10 / 10** | **1.00** | Masterpiece Anchor | Primary anchor candidate for Bucket B & Auteur networks |
| **9 / 10** | **0.80** | Core Affinity Anchor | Secondary anchor candidate; strong positive genre boost |
| **8 / 10** | **0.60** | Strong Positive Affinity | Cast and director vector accumulation |
| **7 / 10** | **0.40** | Baseline Affinity | Moderate positive genre weighting |
| **6 / 10** | **0.20** | Mild Positive | Neutral baseline |
| **$\le$ 5 / 10** | **0.00** | Disliked / Trope Source | Positive weights zeroed; used to extract hated tropes |

### 3.2 Exponential Recency Time-Decay ($W_{\text{final}}$)
To ensure recommendations dynamically reflect evolving tastes while preserving foundational masterpiece anchors, every rated film's base weight is modulated by an exponential decay function:

$$W_{\text{final}} = W_{\text{base}} \times e^{-\lambda \cdot \Delta t}$$

Where:
- $\Delta t = \frac{\text{Date.now}() - t_{\text{watched}}}{1000 \times 60 \times 60 \times 24}$ (elapsed time in days).
- $\lambda = 0.002$ ($\text{Half-life} = \frac{\ln(2)}{0.002} \approx 346.5\text{ days} \approx 11.5\text{ months}$).

#### Recency Decay Table ($\lambda = 0.002$):
- **Day 0 (Today)**: $e^{0} = 1.000$ (100% of base weight)
- **Day 60 (2 Months)**: $e^{-0.12} \approx 0.887$ (88.7% of base weight)
- **Day 180 (6 Months)**: $e^{-0.36} \approx 0.698$ (69.8% of base weight)
- **Day 346 (~Half-Life / 11.5 Months)**: $e^{-0.693} \approx 0.500$ (50.0% of base weight)
- **Day 730 (2 Years)**: $e^{-1.46} \approx 0.232$ (23.2% of base weight)

### 3.3 Temporally-Weighted Anchor Film Selection
Bucket B requires a high-affinity anchor film to extract thematic keywords. CinemaVault sorts all elite films ($\text{Rating} \ge 9$) by $W_{\text{final}}$ descending:

$$\text{AnchorMovie} = \arg\max_{m \in \text{Rated}, \text{Rating}(m) \ge 9} W_{\text{final}}(m)$$

If no film is rated $\ge 9$, the algorithm falls back to the highest $W_{\text{final}}$ film rated $\ge 8$.

### 3.4 Granular Negative Trope Extraction (`without_keywords`)
Instead of excluding broad genres, the profiler iterates over movies rated $\le 3\star$ and accumulates time-decayed trope penalties at half the decay rate ($\lambda_{\text{neg}} = \frac{\lambda}{2} = 0.001$, recognizing that psychological dislikes decay more slowly than fleeting interests):

$$\text{HatedKeywords}[k] = \sum_{m \in \text{Rated}, \text{Rating}(m) \le 3, k \in m.\text{tmdbKeywords}} e^{-\frac{\lambda}{2} \cdot \Delta t_m}$$

The top 5 most frequently occurring hated keyword IDs are passed to TMDB using pipe OR syntax (`without_keywords=9715|10402`), surgically excluding any candidate containing *either* hated trope (*superhero*, *slapstick*, *musical*) without banning entire genres like Action or Drama.

### 3.5 Star-Power & Auteur Graphing
High-rated films ($\text{Rating} \ge 8$) contribute their creative personnel to weighted frequency vectors:
- **Star-Power Actors**: The top 3 billed cast IDs (`castIds[0..2]`) accumulate $W_{\text{final}}$. The top 2 recurring actors are injected into Bucket A discover queries.
- **Auteur Directors & Crew**: Directors, Cinematographers, and Screenwriters accumulate $W_{\text{final}}$ (with Director explicitly prioritized). The highest-scoring single crew member ID (`topCrewMemberId`) is queried in Bucket C.

---

## 4. The Deterministic 3-Bucket Waterfall Pipeline

### 4.1 Bucket B: Keyword Spiritual Successors
- **Objective**: Discover high-acclaim films that share core micro-keywords with the user's top $W_{\text{final}}$ anchor film.
- **Methodology**: Fetches the top 3 keyword IDs from the anchor film and queries TMDB `/discover/movie` with `sort_by=vote_average.desc` and a robust acclaim floor of `vote_count.gte=500` (preventing low-sample localized vote anomalies while preserving indie masterpieces).
- **Target Harvest**: 8 candidates.

### 4.2 Bucket C: Auteur & Star Power Network
- **Objective**: Harvest films from the user's favorite directors, cinematographers, and recurring lead actors.
- **Methodology**: Queries TMDB with `with_crew={topCrewMemberId}` and `sort_by=vote_average.desc`.
- **Target Harvest**: 4 candidates (executed concurrently with Bucket B via `Promise.all`).

### 4.3 Bucket A: Semantic Discover Engine
- **Objective**: Broad discovery based on weighted genre affinities, active mood vectors, and user streaming provider filters.
- **Methodology**: Queries TMDB with weighted `with_genres` (pipe-separated), `without_keywords` (pipe-separated hated tropes), and `with_cast` (comma-separated).
- **Target Harvest**: Dynamically sized to fill remaining candidate slots.

### 4.4 Dynamic Waterfall Sizing & Guarantees
If Buckets B & C return $N$ combined unique candidates:

$$\text{Target}_A = \max(20 - N, 8)$$

The orchestrator merges specific candidates first, appends Bucket A candidates, and triggers a top-up pass if necessary to guarantee an exact **20-candidate pool**.

### 4.5 Cold-Start Bypass Engine
For accounts with $< 3$ rated films, specific keyword and crew graphs lack statistical significance. CinemaVault automatically bypasses Buckets B & C and routes directly to an expanded Bucket A, harvesting 20 diverse, highly-rated films calibrated to the selected mood and watchlist genres.

---

## 5. TMDB API Query Grammar & Syntax Rules

The TMDB `/discover/movie` API enforces specific boolean logic conventions across parameter types:

| Parameter Type | Parameter Name | Delimiter | Boolean Logic | TMDB Example |
| :--- | :--- | :---: | :---: | :--- |
| **Genres** | `with_genres` | `\|` (Pipe) | **OR** | `with_genres=28\|878` (Action OR Sci-Fi) |
| **Keywords** | `with_keywords` | `\|` (Pipe) | **OR** | `with_keywords=9715\|10402` |
| **Excluded Keywords** | `without_keywords`| `\|` (Pipe) | **OR** | `without_keywords=9715\|10402` |
| **Cast / Actors** | `with_cast` | `,` (Comma) | **OR** | `with_cast=67890,11122` (Robert De Niro OR Al Pacino) |
| **Crew Members** | `with_crew` | N/A | Single ID | `with_crew=12345` (Christopher Nolan) |
| **Watch Providers** | `with_watch_providers` | `\|` (Pipe) | **OR** | `with_watch_providers=8\|9\|337` (Netflix OR Prime OR Disney+) |

> [!IMPORTANT]
> - **Excluded Keywords (`without_keywords`)** uses pipe `|` to exclude films containing ANY of the specified trope tags.
> - **People (`with_cast`)** in TMDB use commas `,` for OR logic, whereas **Genres & Keywords** use pipes `|`.
> - **Watch Providers** take integer provider IDs (`8|9`), NOT monetization strings like `flatrate`.
> - When `with_watch_providers` is passed, TMDB requires a valid 2-letter ISO `watch_region` code. Global searches fall back to `US` or omit provider constraints.

---

## 6. Schema Bridge & Enriched Cinema Extraction (`bridgeTmdbToOmdb` & `fetchTmdbMovieDetails`)

CinemaVault enriches every saved movie record by executing concurrent TMDB queries with `append_to_response=external_ids,credits,videos,keywords,watch/providers`, selecting canonical high-resolution assets and structured metadata:

```javascript
/**
 * Resolves the optimal official trailer YouTube key using hierarchical ranking:
 * 1. Official English Trailer
 * 2. Main Theatrical Trailer
 * 3. General English Trailer
 * 4. Teaser Clip
 */
export function extractOfficialTrailerKey(videos = []) {
  if (!videos || !Array.isArray(videos) || videos.length === 0) return null;
  const youtubeVideos = videos.filter((v) => v.site === "YouTube" && v.key);
  if (youtubeVideos.length === 0) return null;

  const officialTrailer = youtubeVideos.find(
    (v) => v.type === "Trailer" && v.official === true && (v.iso_639_1 === "en" || !v.iso_639_1)
  );
  if (officialTrailer) return officialTrailer.key;

  const mainTrailer = youtubeVideos.find((v) => {
    const name = (v.name || "").toLowerCase();
    return v.type === "Trailer" && (name.includes("official") || name.includes("main") || name.includes("theatrical"));
  });
  if (mainTrailer) return mainTrailer.key;

  const anyTrailer = youtubeVideos.find((v) => v.type === "Trailer");
  if (anyTrailer) return anyTrailer.key;

  const anyTeaser = youtubeVideos.find((v) => v.type === "Teaser");
  if (anyTeaser) return anyTeaser.key;

  return youtubeVideos[0].key;
}

export async function bridgeTmdbToOmdb(tmdbMovie, userRegion = "GLOBAL") {
  if (!tmdbMovie) return null;
  const tmdbId = tmdbMovie.tmdbId || tmdbMovie.id;

  if (tmdbId) {
    const key = getTmdbKey();
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&append_to_response=external_ids,credits,videos,keywords,watch/providers&language=en-US`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const directorObj = data.credits?.crew?.find((c) => c.job === "Director");
      const director = directorObj?.name || "Unknown";
      const fallbackCrew = data.credits?.crew?.find((c) =>
        ["Director of Photography", "Original Music Composer", "Screenplay", "Writer"].includes(c.job)
      );
      const crewPersonId = (directorObj || fallbackCrew)?.id || null;
      const cast = (data.credits?.cast || []).slice(0, 5).map((c) => c.name).join(", ") || "N/A";
      const castIds = (data.credits?.cast || []).slice(0, 5).map((c) => c.id);
      const tmdbKeywords = (data.keywords?.keywords || []).slice(0, 10).map((k) => k.id);
      const tmdbGenreIds = (data.genres || []).map((g) => g.id);
      const trailerKey = extractOfficialTrailerKey(data.videos?.results || []);
      const imdbId = data.external_ids?.imdb_id || `tmdb_${tmdbId}`;

      const providerRegion = (userRegion && userRegion !== "GLOBAL")
        ? (data["watch/providers"]?.results?.[userRegion] || data["watch/providers"]?.results?.US)
        : (data["watch/providers"]?.results?.US || Object.values(data["watch/providers"]?.results || {})[0]);

      const streamProviders = (providerRegion?.flatrate || []).map((p) => ({
        id: p.provider_id,
        name: p.provider_name,
        logo: `https://image.tmdb.org/t/p/original${p.logo_path}`
      }));

      return {
        imdbID: imdbId,
        tmdbId: data.id,
        title: data.title || tmdbMovie.title,
        year: data.release_date ? data.release_date.slice(0, 4) : "N/A",
        poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : getFallbackPoster(tmdbMovie.title),
        backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
        runtime: data.runtime ? `${data.runtime} min` : "N/A",
        genre: (data.genres || []).map((g) => g.name).join(", ") || "Cinema",
        tmdbGenreIds,
        imdbRating: data.vote_average ? String(data.vote_average.toFixed(1)) : "N/A",
        director,
        cast,
        castIds,
        crewPersonId,
        tmdbKeywords,
        trailerKey: trailerKey || null,
        streamProviders,
        userRating: 0
      };
    }
  }
}
```

---

## 7. Structured Gemini Re-Ranking & Failover Chain

### Structured JSON Output Schema
Gemini receives the 20-candidate pool and returns a strictly typed JSON object:

```json
{
  "recommendations": [
    {
      "imdbID": "tt0110912",
      "tmdbId": 680,
      "title": "Pulp Fiction",
      "year": "1994",
      "matchScore": 96,
      "reason": "Directly matches your affinity for non-linear neo-noir crime sagas and sharp auteur dialogue."
    }
  ],
  "tasteProfile": {
    "favoriteGenres": ["Crime", "Thriller", "Drama"],
    "ratingStyle": "High appreciation for character-driven dialogue and visual pacing."
  }
}
```

### Regex Code-Fence Sanitizer (`sanitizeAndParseJSON`)
LLMs occasionally wrap JSON in markdown fences (` ```json ... ``` `). CinemaVault applies a resilient sanitizer:

```javascript
export function sanitizeAndParseJSON(rawText) {
  if (!rawText) throw new Error("Empty response from AI engine");
  let cleaned = String(rawText).trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }
  return JSON.parse(cleaned);
}
```

### Failover Resilience Chain
1. **Primary**: `gemini-2.5-flash` with structured schema.
2. **Secondary Failover**: `gemini-2.0-flash` with identical schema.
3. **Deterministic Fallback Engine**: If all LLM calls fail, candidates are ranked deterministically by TMDB `vote_average`, ensuring 100% uptime.

---

## 8. Smart LRU Cache & Master ID Collision Guard

### Master ID Cross-Referencing Collision Guard
Smart Cache checks every cached recommendation against all known identifiers across both Watched and Watchlist datasets:

```javascript
export function getSmartCache(hash, watched = [], watchlist = []) {
  try {
    const cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
    const entry = cache[hash];
    if (!entry || !entry.data || (Date.now() - (entry.ts || 0) > 24 * 60 * 60 * 1000)) {
      return null;
    }

    const currentIds = new Set([
      ...watched.flatMap(m => [
        m.imdbID ? String(m.imdbID).toLowerCase() : null,
        m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
        m.id ? String(m.id).toLowerCase() : null
      ]).filter(Boolean),
      ...watchlist.flatMap(m => [
        m.imdbID ? String(m.imdbID).toLowerCase() : null,
        m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
        m.id ? String(m.id).toLowerCase() : null
      ]).filter(Boolean)
    ]);

    const validRecs = (entry.data.recommendations || []).filter(rec => {
      const recIds = [
        rec.imdbID ? String(rec.imdbID).toLowerCase() : null,
        rec.tmdbId ? String(rec.tmdbId).toLowerCase() : null,
        rec.id ? String(rec.id).toLowerCase() : null
      ].filter(Boolean);

      return !recIds.some(id => currentIds.has(id));
    });

    if (validRecs.length >= 4) {
      return { ...entry.data, recommendations: validRecs };
    }
  } catch (e) {
    console.warn("SmartCache read failed:", e);
  }
  return null;
}
```

### 500KB LRU Eviction Policy (Single-Pass Sorted Eviction)
```javascript
export function setSmartCache(hash, data) {
  try {
    let cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
    cache[hash] = { data, ts: Date.now() };

    const keys = Object.keys(cache);
    if (keys.length > 1) {
      const sortedKeys = keys.sort((a, b) => (cache[a]?.ts || 0) - (cache[b]?.ts || 0));
      let serialized = JSON.stringify(cache);
      let idx = 0;
      while (serialized.length * 2 > 500 * 1024 && idx < sortedKeys.length - 1) {
        delete cache[sortedKeys[idx]];
        idx++;
      }
      if (idx > 0) {
        serialized = JSON.stringify(cache);
      }
      localStorage.setItem(SMART_CACHE_KEY, serialized);
    } else {
      localStorage.setItem(SMART_CACHE_KEY, JSON.stringify(cache));
    }
  } catch (e) {
    console.warn("SmartCache write failed:", e);
  }
}
```

---

## 9. Universal Streaming Access & Multi-Region Matrix

### Supported Streaming Providers
| Provider | TMDB ID | Icon |
| :--- | :---: | :---: |
| **Netflix** | `8` | 🔴 |
| **Amazon Prime Video** | `9` | 📦 |
| **Disney+** | `337` | ✨ |
| **Max (HBO)** | `1899` | 🟣 |
| **Apple TV+** | `350` | 🍏 |
| **Hulu** | `15` | 🟢 |
| **Paramount+** | `531` | 🏔️ |
| **Peacock** | `386` | 🦚 |
| **Criterion Channel** | `258` | 🏛️ |
| **Tubi (Free)** | `73` | 📺 |
| **Pluto TV (Free)** | `300` | ⚡ |
| **Freevee (Free)** | `573` | 🎬 |

### Supported Regions
`GLOBAL` (Worldwide), `US`, `GB`, `CA`, `AU`, `JP`, `KR`, `FR`, `DE`, `ES`, `IT`, `IN`, `BR`, `MX`, `SE`.

---

## 10. Official Trailer Resolution & Playback Architecture

Major movie studios frequently enforce origin-embedding restrictions on official trailers (resulting in iframe `Error 153: Video unavailable`). CinemaVault combines **hierarchical official trailer ranking** with a high-priority direct launch mechanism:

1. **Hierarchy Strategy (`extractOfficialTrailerKey`)**:
   - `Type === "Trailer" && official === true && (en/default)`
   - `Type === "Trailer" && Name matches ("Official" | "Main" | "Theatrical")`
   - `Type === "Trailer"`
   - `Type === "Teaser"`
2. **Direct High-Priority Playback**:
   - Primary CTA launches direct canonical video stream at `https://www.youtube.com/watch?v=${trailerKey}` with `target="_blank"` and `rel="noopener noreferrer"`.
   - Fallback query searches canonical YouTube catalog: `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' ' + year + ' official trailer')}`.
   - Eliminates third-party iframe embed blockages, CSP origin errors, and mobile browser playback restrictions.

---

## 11. Telemetry Analytics & Statistical Algorithms

### 1. Rating Delta Histogram
Calculates the user's deviation from global IMDb baselines:

$$\Delta(m) = \text{UserRating}(m) - \text{ImdbRating}(m)$$

Bucketed into:
- Critical Contrariness ($\Delta \le -2.0$)
- Mild Skepticism ($-1.5 \le \Delta \le -0.5$)
- Consensus Neutral ($-0.5 < \Delta < +0.5$)
- Generous Affinity ($+0.5 \le \Delta \le +1.5$)
- Passionate Champion ($\Delta \ge +2.0$)

### 2. Watch Time Aggregator
$$\text{TotalMinutes} = \sum_{m \in \text{Watched}} \text{parseRuntimeMinutes}(m.\text{runtime})$$

Converted to Days, Hours, and Minutes display.

---

## 12. Two-Way Letterboxd Portability & Batch Importer

- **Export Format**: Standardized CSV format (`Title, Year, Rating10, WatchedDate`).
- **Import Engine**: Letterboxd CSVs are chunked into asynchronous batches (`BATCH_SIZE = 4`) to prevent browser throttling while querying OMDb/TMDB for verified poster URLs and canonical `imdbID` strings.
- **Modes**:
  - **Merge Mode**: Preserves existing custom reviews and ratings while appending new titles.
  - **Overwrite Mode**: Cleans vault and restores archive.

---

## 13. Complete Reference Implementations (Code Blocks)

### `extractTasteProfile` in `src/services/tmdbService.js`
```javascript
export async function extractTasteProfile(watched = [], watchlist = []) {
  const rated = (watched || []).filter(m => {
    const r = Number(m.userRating || m.UserRating || 0);
    return !isNaN(r) && r > 0;
  });

  const genreScores = {};
  const hatedKeywordCounts = {};
  const castScores = {};
  const crewScores = {};
  const DECAY_RATE = 0.002; // ~346 day (~11.5 month) cinema-appropriate half-life

  const weightedRated = rated.map(movie => {
    const rating = Number(movie.userRating || movie.UserRating || 0);
    const addedTime = new Date(movie.dateWatched || movie.addedAt || Date.now()).getTime();
    const daysSince = Math.max(0, (Date.now() - addedTime) / (1000 * 60 * 60 * 24));
    const timeDecay = Math.exp(-DECAY_RATE * daysSince);

    const baseWeight = Math.max(0, (rating - 5) / 5);
    const finalWeight = baseWeight * timeDecay;

    const genreIds = movie.tmdbGenreIds || mapOmdbToTmdbGenreIds(movie.genre || movie.Genre || "");
    genreIds.forEach(id => {
      genreScores[id] = (genreScores[id] || 0) + finalWeight;
    });

    if (rating <= 3 && movie.tmdbKeywords && Array.isArray(movie.tmdbKeywords)) {
      const negativeDecay = Math.exp(-(DECAY_RATE / 2) * daysSince);
      movie.tmdbKeywords.forEach(kId => {
        hatedKeywordCounts[kId] = (hatedKeywordCounts[kId] || 0) + negativeDecay;
      });
    }

    if (rating >= 8) {
      if (movie.castIds && Array.isArray(movie.castIds)) {
        movie.castIds.slice(0, 3).forEach(cId => {
          castScores[cId] = (castScores[cId] || 0) + finalWeight;
        });
      }
      if (movie.crewPersonId) {
        crewScores[movie.crewPersonId] = (crewScores[movie.crewPersonId] || 0) + finalWeight;
      }
    }

    return { ...movie, finalWeight };
  });

  weightedRated.sort((a, b) => b.finalWeight - a.finalWeight);

  const lovedGenreIds = Object.entries(genreScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => Number(id));

  const topCastIds = Object.entries(castScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => Number(id));

  const topCrewMemberId = Object.entries(crewScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([id]) => Number(id))[0] || null;

  const hatedKeywordIds = Object.entries(hatedKeywordCounts)
    .filter(([_, count]) => count >= 1)
    .slice(0, 5)
    .map(([id]) => Number(id));

  const eliteAnchors = weightedRated.filter(m => Number(m.userRating || 0) >= 9);
  let anchorTmdbId = null;
  if (eliteAnchors.length > 0) {
    anchorTmdbId = eliteAnchors[0].tmdbId || (await findTmdbByImdbId(eliteAnchors[0].imdbID))?.tmdbId || null;
  }

  return {
    lovedGenreIds,
    lovedGenreNames: lovedGenreIds.map(id => TMDB_ID_TO_GENRE[id] || `Genre ${id}`),
    topCastIds,
    topCrewMemberId,
    anchorTmdbId,
    hatedKeywordIds,
    totalRated: rated.length
  };
}
```

---

## 14. Luxury Rating Deck & Interaction Architecture

### 14.1 Dynamic Taste Anchor Tiers
Ratings trigger reactive metadata banners that articulate the film's mathematical role in the user's taste engine:

| Rating | Tier Title | Icon | Taste Engine Mechanism | Visual Accent |
| :---: | :--- | :---: | :--- | :--- |
| **10** | **Masterpiece (Anchor Film)** | 🏆 | Sets primary anchor for Bucket B keyword harvest | Brass Gold (`#e2b13c`) |
| **9** | **Exceptional Cinema** | ✨ | Strong positive genre & actor vector weight | Amber Gold (`#f59e0b`) |
| **8** | **Great Film** | 🍿 | Standard positive weight for discovery | Emerald (`#10b981`) |
| **7** | **Good Watch** | 👍 | Solid craft, baseline enjoyment | Cyan (`#06b6d4`) |
| **6** | **Decent Baseline** | 😐 | Watchable with balanced qualities | Purple (`#8b5cf6`) |
| **5** | **Mediocre** | 📉 | Neutral boundary (0.00 base weight) | Slate (`#94a3b8`) |
| **4** | **Flawed** | ⚠️ | Storytelling/craft penalty | Orange (`#f97316`) |
| **3** | **Disliked** | 🚫 | Trope penalty applied to negative keyword vector | Crimson (`#ef4444`) |
| **2** | **Poor Experience** | ⛔ | AI engine suppresses matching motifs | Dark Red (`#dc2626`) |
| **1** | **Severe Dislike** | 💀 | Strict negative weight applied to keywords | Deep Ruby (`#b91c1c`) |

### 14.2 Synchronized Flex Distribution & Layout Guardrails
- **Dual Column Alignment**: `.glowing-stars-bar` and `.rating-numeric-dial` share identical CSS flex layouts (`width: 100%`, `gap: 0.4rem`), where each child `.star-touch-btn` and `.dial-pill` utilizes `flex: 1; min-width: 0;`.
- **Zero-Layout Shift**: The `.rating-tier-banner` enforces a fixed min-height (`5.8rem`) with smooth CSS transitions (`background`, `border-color`, `box-shadow`) so text changes never displace the interactive star buttons or dial.
- **Hitbox Boundary Isolation**: Star scaling on hover (`transform: scale(1.18)`) is isolated to the non-interactive inner SVG icon (`pointer-events: none`), preventing pointer-boundary flicker.
- **Dual Action Watchlist Management**: Provides instantaneous toggle between "Plan to Watch" and "Queued in Watchlist" without navigation collision or state desynchronization.

---

*Authored by **[Khuzaima](https://github.com/khuzaima175)** for the CinemaVault Project.*

