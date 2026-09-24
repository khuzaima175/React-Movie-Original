# 🎬 CinemaVault

> **The Ultimate Cinematic Vault & AI-Powered Movie Companion**

CinemaVault is a high-performance, feature-rich React application designed for movie enthusiasts. Search global film databases, manage your personal watched history and watchlist, explore deep vault analytics, and consult the Google Gemini AI Oracle for tailored film recommendations—all wrapped in a sleek, cinematic studio glassmorphism interface.

![CinemaVault Screenshot](assets/screenshot.png)

---

## 🎨 UI Elevation & Design Overhaul

CinemaVault features a complete UI redesign built to deliver a **luxurious, theatre-grade desktop and mobile experience**. The interface evolved from standard web lists into an atmospheric cinematic platform:

### 🌟 Key UI/UX Enhancements
- 💎 **Glassmorphism 3-Surface Elevation System**: Architected with strict CSS custom property design tokens (`--surface-base: #090c12`, `--surface-card: #131926`, `--surface-elevated: #1a2336`), gold/cyan glow accents (`#e2b13c`, `#38bdf8`), and high-contrast typography using Google Fonts (**Space Grotesk** & **Plus Jakarta Sans**).
- 🌌 **Ambient Gradient Backdrops & Cinema Glows**: Dynamic ambient radial background glows (`ai-aura-gold`, `ai-aura-cyan`) paired with crisp glass borders for an immersive theatre aesthetic.
- 🚀 **Compact Studio Navigation & Mobile Header**: Height-efficient top header on desktop and mobile (~48px) with real-time status indicators (`10 Films Synced`), eliminating vertical dead space and bringing interactive content above the fold.
- 🍿 **Featured Spotlight Hero Billboard**: Dynamic showcase banner highlighting top trending or featured titles with full backdrop art, IMDb ratings, genre tags, storyline summaries, and instant watched/watchlist action toggles.
- 🏛️ **AI Oracle Cinema Studio Deck**:
  - **Interactive Vibe & Mood Selector**: Dynamic visual mood cards (`✨ Any Vibe`, `🧠 Mind-Bending`, `🌑 Dark Thriller`, `🍿 Fun Popcorn`, `🛋️ Comfort Watch`, `💎 Hidden Gem`) with live contextual micro-descriptions.
  - **Vault Taste Anchor Filmstrip**: Horizontal scrolling mini-poster reel showing your top-rated 8★–10★ anchor movies with gold star rating badges and dominant genre affinity chips.
  - **Compact Taste Genome Bar**: Streamlined glass summary strip with collapsible `[View DNA Breakdown ▾]` drawer for genre affinities and narrative aesthetic summaries.
  - **Responsive 2-Column Cinema Grid & List Toggle**: 2-column Criterion-style card grid on desktop with Grid/List view switcher (`[ ⊞ | ☰ ]`) and instant sorting by Match Score, IMDb rating, or release year.
- 📊 **Decluttered Vault Analytics Dashboard**: Comprehensive collapsible statistics featuring total cinematic watch time (hours/minutes), average user score meter, genre distribution percentages, top directors leaderboard, and rating breakdown charts.
- 🔍 **Command-Palette Search (`Ctrl + K` / `Cmd + K`)**: Global instant-search modal supporting live debounced OMDb queries, title/year filtering, poster previews, and keyboard navigation.
- 📦 **Data Management & Bulk Action Suite**: Full JSON data import/export modal with integrity validation, alongside a bottom floating bulk actions bar (`VaultBulkBar`) for batch operations.
- 🎨 **Luxury SVG Fallback Posters**: Custom inline vector poster generator (`getFallbackPoster`) ensuring zero broken image layout shifts when posters are missing from remote APIs.
- ✨ **Framer Motion Micro-Animations**: Smooth spring page transitions, layout highlight pill transitions, scale-on-hover poster interactions, and responsive modal animations.

---

## 🧠 Recommendation System & AI Algorithms

CinemaVault employs an advanced **Hybrid AI & Statistical Recommendation Pipeline** engineered to eliminate hallucinated recommendations, penalize disliked movie traits, resolve title remake collisions, and deliver hyper-personalized film suggestions.

```mermaid
graph TD
    A[User Rating History & Watchlist] --> B[Statistical Taste Profiler]
    A --> C[Stratified Tier Sampler & Anchor Weights]
    A --> D[Composite Title-Year Collision Filter]
    B --> E[CSV Injection Sanitizer & Encoder]
    C --> E
    F[Watchlist Intent & Mood Signals] --> E
    G[Negative Feedback & Dismissal Penalty Log] --> E
    E --> H[Multi-Model AI Engine\nGemini 3.6 / 2.5 / 2.0 Flash]
    H --> I[Dual-Pass Self-Critique Step]
    I --> J[OMDb Entity Verification & Anti-Hallucination]
    J --> K[Hybrid Score Ranking & Sorting]
    K --> L[Verified 6-Film Curated Recommendations]
```

### 🔬 Core Algorithms & Hardening Implemented

| Algorithm / Technique | Primary Module | Description & Technical Implementation |
| :--- | :--- | :--- |
| **1. Composite ID & Title Remake Collision Prevention** | [`watchedKeySet` & `watchlistKeySet`](file:///g:/Important%20Projects/movie-ratings/src/components/MovieRecommendations.jsx) | Eliminates title collisions where prequels and remakes with identical titles (e.g. *The Thing* 1982 vs 2011, *A Star is Born* 1954 vs 2018) were previously blocked by title-only lookups. Tracks composite keys (`title::year`) alongside `imdbID`. |
| **2. CSV Injection Sanitization & Safe Encoding** | [`cleanStr`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js#L8) | Strips delimiter characters (`\|`, `\r`, `\n`, `\t`) and excessive whitespace from user titles, notes, and genre tags before encoding into pipe-delimited CSV, preventing prompt injection or payload parsing breakdown. |
| **3. Statistical Taste Profiling & Feature Vector Extraction** | [`buildTasteAnalytics`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Computes mean ratings, top genre distributions (% affinity across 7+ rated films), and top director leaderboards (filtered by minimum 2 films and calculated average rating) prior to AI context construction. |
| **4. Stratified Tier Sampling & Priority Anchor Weighting** | [`getMovieRecommendations`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Segments movies into distinct buckets: **Elite Anchors (9-10/10)** are priority-preserved uncapped, **Supporting (7-8/10)** are sampled up to 15 titles, and **Recency** samples the 10 most recent entries. |
| **5. Anti-Pattern & Disqualification Penalty Algorithm** | [`antiPatternSummary`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Isolates low-rated films (≤ 5/10) along with specific user criticism notes. Instructs the AI engine to strictly penalize and disqualify candidate films exhibiting similar structural or thematic flaws. |
| **6. Negative Feedback Loop & Adaptive Dismissals** | [`aiFeedbackLog` & `handleDismiss`](file:///g:/Important%20Projects/movie-ratings/src/components/MovieRecommendations.jsx) | User dismissals (*"Not for me"* with reasons like *Too slow*, *Not my genre*, *Predictable*) are recorded in `aiFeedbackLog` and injected into subsequent prompts to steer the AI away from rejected tropes. |
| **7. Watchlist Implicit Intent Mining** | [`watchlistTitles`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Extracts titles in the user's watchlist as implicit curiosity vectors to infer genre/style preferences without recommending already-saved movies. |
| **8. Multi-Model Dynamic Fallback Routing** | [`MODELS` Routing](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Implements an automated failover loop (`gemini-3.6-flash` → `gemini-2.5-flash` → `gemini-2.0-flash`). Guarantees recommendation delivery during high API load, model deprecation, or rate limiting. |
| **9. Dual-Pass LLM Self-Critique & Quality Verification** | [`critiquePrompt`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Performs a second-pass AI review step evaluating candidate recommendations against user anti-patterns and elite anchors. Adjusts confidence scores (0-100%) and appends caution warnings for low-confidence fits. |
| **10. OMDb Real-Data Verification & Anti-Hallucination** | [`fetchRealOMDBData`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Queries the live OMDb API for every AI-suggested title to replace hallucinated ratings with real IMDb ratings, IMDb vote counts, posters, and plots. Implements a Title+Year retry fallback without year constraint to handle release date mismatches. |
| **11. Deterministic Input Hashing & Cache Management** | [`generateInputHash`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) | Calculates a string fingerprint hash of watched ratings, notes, and selected mood to provide instant 0ms cached recommendations while invalidating cleanly on vault updates. |
| **12. Hybrid Score Ranking & Dual-Tier Sorting** | Ranking Logic | Ranks output suggestions primarily by AI Match Score alignment (0-100%) and secondarily by live IMDb user ratings. |
| **13. Context-Bounded Conversational Companion** | [`sendChatMessage`](file:///g:/Important%20Projects/movie-ratings/src/services/geminiChatService.js) | Conversational cinema assistant with strict domain-bounding rules and watched-history context injection. |

---

## ✨ Key Features

- 🍿 **Featured Spotlight Hero**: Immersive dynamic showcase hero banner displaying detailed metadata, backdrop art, IMDb ratings, and quick vault action toggles.
- 🤖 **AI Oracle Cinema Studio**: Smart AI recommender powered by `@google/genai` featuring mood presets, interactive taste anchors filmstrip, taste genome overview, and Criterion-grade 2-column card grid.
- 🏛️ **Personal Movie Vault**: Manage your **Watched** films and **Watchlist** queue with ease. Add custom user ratings, notes, favorite markers, and tags.
- 🔍 **Command-Palette Search**: Global quick-search modal accessible via keyboard shortcut (`Ctrl + K` or `Cmd + K`) with real-time debounced OMDb API queries.
- 📊 **Deep Vault Analytics**: View comprehensive statistics on your cinematic journey, including total watch time (hours/minutes), average rating, genre distributions, and favorite directors.
- 🎲 **Watchlist Randomizer**: Can't decide what to watch tonight? Use the interactive random picker to select a random title from your saved collection.
- 💾 **Data Export & Backup**: Full JSON import/export capabilities so your personal movie collection remains safe and portable.
- 🎨 **Cinematic Glassmorphism UI**: Built with dark-mode aesthetic principles, sleek glow highlights, smooth Framer Motion transitions, and Lucide React icons.

---

## 🛠️ Tech Stack

| Category | Technology |
| :--- | :--- |
| **Framework** | [React 18](https://react.dev/) with [Vite 5](https://vitejs.dev/) |
| **Routing** | [React Router v6](https://reactrouter.com/) |
| **AI Engine** | [Google Gemini API](https://ai.google.dev/) (`@google/genai`) |
| **Data Source** | [OMDb API](http://www.omdbapi.com/) |
| **Animations** | [Framer Motion](https://www.framer.com/motion/) |
| **Styling** | Vanilla CSS with Custom Design Tokens & Modern Layouts |
| **Icons** | [Lucide React](https://lucide.dev/) |

---

## 🚀 Getting Started

### 1. Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (v16 or higher) installed. You will also need API keys for:
- **OMDb API**: Get a free key at [omdbapi.com](http://www.omdbapi.com/apikey.aspx)
- **Google Gemini API**: Get an API key at [Google AI Studio](https://aistudio.google.com/)

### 2. Installation

Clone the repository and install project dependencies:

```bash
git clone https://github.com/khuzaima175/React-Movie-Original.git
cd movie-ratings
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory (or copy from `.env.example`):

```env
VITE_OMDB_KEY=your_omdb_api_key_here
VITE_GEMINI_KEY=your_gemini_api_key_here
```

### 4. Run Development Server

Start the Vite development server:

```bash
npm start
```

Open `http://localhost:3000` (or the port indicated by Vite) in your browser to explore CinemaVault!

### 5. Build for Production

To create an optimized production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run serve
```

---

## 📁 Project Structure

```text
movie-ratings/
├── assets/                 # Static documentation assets (screenshots, images)
├── public/                 # Web assets & favicon
├── src/
│   ├── components/         # Reusable UI components (NavBar, HeroBillboard, MovieCard, SearchModal, etc.)
│   ├── context/            # Global AppContext state management
│   ├── hooks/              # Custom React hooks (useMovies, useLocalStorageState, etc.)
│   ├── pages/              # Application views (DashboardPage, VaultPage, AIPage, MoviePage)
│   ├── services/           # External API integrations (geminiService, omdbService, geminiChatService)
│   ├── App.jsx             # Router layout and main app root
│   ├── index.css           # Design tokens, keyframe animations, & modern studio CSS
│   └── index.jsx           # React DOM entrypoint
├── .env.example            # Sample environment file configuration
├── package.json            # Dependencies and scripts
└── README.md               # Project documentation
```

---

## 📜 License & Acknowledgments

Built with ❤️ by [Khuzaima](https://github.com/khuzaima175)

If you find CinemaVault helpful, give it a ⭐️ on GitHub!