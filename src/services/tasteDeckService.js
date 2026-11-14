import { buildSeenCollisionSet } from "./dashboardService.js";

export const TASTE_ONBOARDING_DISMISSED_KEY = "cinemavault_taste_onboarding_dismissed_v1";

export const CORE_TASTE_DECK = [
  // Sci-Fi
  {
    imdbID: "tt0816692",
    tmdbId: 157336,
    title: "Interstellar",
    year: "2014",
    primaryGenre: "Sci-Fi",
    genre: "Sci-Fi, Drama, Adventure",
    director: "Christopher Nolan",
    runtime: "169 min",
    imdbRating: "8.7",
    poster: "https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_SX300.jpg",
    plot: "When Earth becomes uninhabitable, an ex-NASA pilot leads an interstellar expedition across a wormhole to secure humanity's survival."
  },
  {
    imdbID: "tt1856101",
    tmdbId: 335984,
    title: "Blade Runner 2049",
    year: "2017",
    primaryGenre: "Sci-Fi",
    genre: "Sci-Fi, Mystery, Drama",
    director: "Denis Villeneuve",
    runtime: "164 min",
    imdbRating: "8.0",
    poster: "https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_QL75_UX380_CR0,0,380,562_.jpg",
    plot: "A replicant officer uncovers a buried secret with the power to shatter what remains of society and seeks former runner Rick Deckard."
  },
  {
    imdbID: "tt15239678",
    tmdbId: 693134,
    title: "Dune: Part Two",
    year: "2024",
    primaryGenre: "Sci-Fi",
    genre: "Sci-Fi, Adventure, Drama",
    director: "Denis Villeneuve",
    runtime: "166 min",
    imdbRating: "8.5",
    poster: "https://m.media-amazon.com/images/M/MV5BNTc0YmQxMjEtODI5MC00NjFiLTlkMWUtOGQ5NjFmYWUyZGJhXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family."
  },

  // Action
  {
    imdbID: "tt1392190",
    tmdbId: 76341,
    title: "Mad Max: Fury Road",
    year: "2015",
    primaryGenre: "Action",
    genre: "Action, Adventure, Sci-Fi",
    director: "George Miller",
    runtime: "120 min",
    imdbRating: "8.1",
    poster: "https://m.media-amazon.com/images/M/MV5BZDRkODJhOTgtOTc1OC00NTgzLTk4NjItNDgxZDY4YjlmNDY2XkEyXkFqcGc@._V1_SX300.jpg",
    plot: "In a stark wasteland, Imperator Furiosa leads a high-speed rebellion across the desert alongside Max Rockatansky."
  },
  {
    imdbID: "tt0133093",
    tmdbId: 603,
    title: "The Matrix",
    year: "1999",
    primaryGenre: "Action",
    genre: "Action, Sci-Fi",
    director: "Lana & Lilly Wachowski",
    runtime: "136 min",
    imdbRating: "8.7",
    poster: "https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "A computer hacker learns from mysterious rebels that reality is a simulation and joins their fight against its controllers."
  },
  {
    imdbID: "tt1745960",
    tmdbId: 361743,
    title: "Top Gun: Maverick",
    year: "2022",
    primaryGenre: "Action",
    genre: "Action, Drama",
    director: "Joseph Kosinski",
    runtime: "130 min",
    imdbRating: "8.2",
    poster: "https://m.media-amazon.com/images/M/MV5BMDBkZDNjMWEtOTdmMi00NmExLTg5MmMtNTFlYTJlNWY5YTdmXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "After thirty years of service, Pete Mitchell is recalled to train an elite detachment of graduates for an impossible mission."
  },

  // Crime
  {
    imdbID: "tt0468569",
    tmdbId: 155,
    title: "The Dark Knight",
    year: "2008",
    primaryGenre: "Crime",
    genre: "Action, Crime, Drama",
    director: "Christopher Nolan",
    runtime: "152 min",
    imdbRating: "9.0",
    poster: "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg",
    plot: "When the Joker unleashes chaos across Gotham City, Batman must confront his greatest psychological and moral test."
  },
  {
    imdbID: "tt0068646",
    tmdbId: 238,
    title: "The Godfather",
    year: "1972",
    primaryGenre: "Crime",
    genre: "Crime, Drama",
    director: "Francis Ford Coppola",
    runtime: "175 min",
    imdbRating: "9.2",
    poster: "https://m.media-amazon.com/images/M/MV5BNGEwYjgwOGQtYjg5ZS00Njc1LTk2ZGEtM2QwZWQ2NjdhZTE5XkEyXkFqcGc@._V1_QL75_UY562_CR8,0,380,562_.jpg",
    plot: "The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant youngest son."
  },
  {
    imdbID: "tt0099685",
    tmdbId: 769,
    title: "GoodFellas",
    year: "1990",
    primaryGenre: "Crime",
    genre: "Biography, Crime, Drama",
    director: "Martin Scorsese",
    runtime: "145 min",
    imdbRating: "8.7",
    poster: "https://m.media-amazon.com/images/M/MV5BN2E5NzI2ZGMtY2VjNi00YTRjLWI1MDUtZGY5OWU1MWJjZjRjXkEyXkFqcGc@._V1_QL75_UX380_CR0,3,380,562_.jpg",
    plot: "The rise and fall of Henry Hill and his associates inside the New York mob spanning three turbulent decades."
  },

  // Drama
  {
    imdbID: "tt0111161",
    tmdbId: 278,
    title: "The Shawshank Redemption",
    year: "1994",
    primaryGenre: "Drama",
    genre: "Drama",
    director: "Frank Darabont",
    runtime: "142 min",
    imdbRating: "9.3",
    poster: "https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg",
    plot: "Wrongfully imprisoned banker Andy Dufresne builds an enduring friendship and quiet hope inside Shawshank State Penitentiary."
  },
  {
    imdbID: "tt15398776",
    tmdbId: 872585,
    title: "Oppenheimer",
    year: "2023",
    primaryGenre: "Drama",
    genre: "Biography, Drama, History",
    director: "Christopher Nolan",
    runtime: "180 min",
    imdbRating: "8.3",
    poster: "https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTJmNTM5MjVmYTQ4XkEyXkFqcGc@._V1_SX300.jpg",
    plot: "J. Robert Oppenheimer leads the Manhattan Project to build the atomic bomb and faces the political fallout that follows."
  },
  {
    imdbID: "tt2582802",
    tmdbId: 244786,
    title: "Whiplash",
    year: "2014",
    primaryGenre: "Drama",
    genre: "Drama, Music",
    director: "Damien Chazelle",
    runtime: "106 min",
    imdbRating: "8.5",
    poster: "https://m.media-amazon.com/images/M/MV5BMDFjOWFkYzktYzhhMC00NmYyLTkwY2EtYjViMDhmNzg0OGFkXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "An ambitious jazz drummer enrolls at a cutthroat conservatory where a relentless conductor pushes him to the brink."
  },

  // Thriller
  {
    imdbID: "tt6751668",
    tmdbId: 496243,
    title: "Parasite",
    year: "2019",
    primaryGenre: "Thriller",
    genre: "Drama, Thriller",
    director: "Bong Joon Ho",
    runtime: "132 min",
    imdbRating: "8.5",
    poster: "https://m.media-amazon.com/images/M/MV5BYjk1Y2U4MjQtY2ZiNS00OWQyLWI3MmYtZWUwNmRjYWRiNWNhXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "All members of a struggling Seoul household scheme their way into working for a wealthy family with unforeseen consequences."
  },
  {
    imdbID: "tt0114369",
    tmdbId: 807,
    title: "Se7en",
    year: "1995",
    primaryGenre: "Thriller",
    genre: "Crime, Drama, Mystery",
    director: "David Fincher",
    runtime: "127 min",
    imdbRating: "8.6",
    poster: "https://m.media-amazon.com/images/M/MV5BY2IzNzMxZjctZjUxZi00YzAxLTk3ZjMtODFjODdhMDU5NDM1XkEyXkFqcGc@._V1_SX300.jpg",
    plot: "Two detectives hunt a methodical killer using the seven deadly sins as motifs across a rain-soaked city."
  },
  {
    imdbID: "tt1392214",
    tmdbId: 146233,
    title: "Prisoners",
    year: "2013",
    primaryGenre: "Thriller",
    genre: "Crime, Drama, Mystery",
    director: "Denis Villeneuve",
    runtime: "153 min",
    imdbRating: "8.1",
    poster: "https://m.media-amazon.com/images/M/MV5BMTg0NTIzMjQ1NV5BMl5BanBnXkFtZTcwNDc3MzM5OQ@@._V1_SX300.jpg",
    plot: "When two young girls vanish, a desperate father takes matters into his own hands as a detective races every lead."
  },

  // Animation
  {
    imdbID: "tt9362722",
    tmdbId: 569094,
    title: "Spider-Man: Across the Spider-Verse",
    year: "2023",
    primaryGenre: "Animation",
    genre: "Animation, Action, Adventure",
    director: "Joaquim Dos Santos",
    runtime: "140 min",
    imdbRating: "8.5",
    poster: "https://m.media-amazon.com/images/M/MV5BNThiZjA3MjItZGY5Ni00ZmJhLWEwN2EtOTBlYTA4Y2E0M2ZmXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "Miles Morales traverses the Multiverse and collides with an elite Spider-Society determined to preserve canon."
  },
  {
    imdbID: "tt0245429",
    tmdbId: 129,
    title: "Spirited Away",
    year: "2003",
    primaryGenre: "Animation",
    genre: "Animation, Adventure, Family",
    director: "Hayao Miyazaki",
    runtime: "125 min",
    imdbRating: "8.6",
    poster: "https://m.media-amazon.com/images/M/MV5BNTEyNmEwOWUtYzkyOC00ZTQ4LTllZmUtMjk0Y2YwOGUzYjRiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg",
    plot: "During her family's move, ten-year-old Chihiro wanders into a spirit realm and must work in a magical bathhouse to free her parents."
  },
  {
    imdbID: "tt0910970",
    tmdbId: 10681,
    title: "WALL·E",
    year: "2008",
    primaryGenre: "Animation",
    genre: "Animation, Adventure, Sci-Fi",
    director: "Andrew Stanton",
    runtime: "98 min",
    imdbRating: "8.4",
    poster: "https://m.media-amazon.com/images/M/MV5BMjExMTg5OTU0NF5BMl5BanBnXkFtZTcwMjMxMzMzMw@@._V1_SX300.jpg",
    plot: "Centuries into cleaning an abandoned Earth, a lonely waste-compacting robot embarks on a cosmic journey for love."
  },

  // Mystery
  {
    imdbID: "tt1375666",
    tmdbId: 27205,
    title: "Inception",
    year: "2010",
    primaryGenre: "Mystery",
    genre: "Action, Sci-Fi, Mystery",
    director: "Christopher Nolan",
    runtime: "148 min",
    imdbRating: "8.8",
    poster: "https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_SX300.jpg",
    plot: "A specialist in dream-sharing espionage takes on one final heist: planting an original idea deep within a target's mind."
  },
  {
    imdbID: "tt0482571",
    tmdbId: 1124,
    title: "The Prestige",
    year: "2006",
    primaryGenre: "Mystery",
    genre: "Drama, Mystery, Sci-Fi",
    director: "Christopher Nolan",
    runtime: "130 min",
    imdbRating: "8.5",
    poster: "https://m.media-amazon.com/images/M/MV5BZWU0NWZhYzMtZmNlYy00MjA1LTgyZWEtYmNjNzdjYmRkOTkzXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "After a tragic mishap in Victorian London, two rival stage magicians wage an escalating war of obsession and sacrifice."
  },
  {
    imdbID: "tt0209144",
    tmdbId: 77,
    title: "Memento",
    year: "2000",
    primaryGenre: "Mystery",
    genre: "Mystery, Thriller",
    director: "Christopher Nolan",
    runtime: "113 min",
    imdbRating: "8.4",
    poster: "https://m.media-amazon.com/images/M/MV5BMGQ3Y2Q4NjktN2E4Ny00Y2Q2LTliZDUtZTNiNjRhY2I0NGIyXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "A man suffering from short-term memory loss relies on Polaroids and tattoos to hunt down his wife's killer."
  },

  // Comedy
  {
    imdbID: "tt6710474",
    tmdbId: 545611,
    title: "Everything Everywhere All at Once",
    year: "2022",
    primaryGenre: "Comedy",
    genre: "Action, Adventure, Comedy",
    director: "Daniel Kwan & Daniel Scheinert",
    runtime: "139 min",
    imdbRating: "7.8",
    poster: "https://m.media-amazon.com/images/M/MV5BOWNmMzAzZmQtNDQ1NC00Nzk5LTkyMmUtNGI2N2NkOWM4MzEyXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "An exhausted laundromat owner discovers she must connect with alternate versions of herself across infinite universes."
  },
  {
    imdbID: "tt8946378",
    tmdbId: 546554,
    title: "Knives Out",
    year: "2019",
    primaryGenre: "Comedy",
    genre: "Comedy, Crime, Drama",
    director: "Rian Johnson",
    runtime: "130 min",
    imdbRating: "7.9",
    poster: "https://m.media-amazon.com/images/M/MV5BZDU5ZTRkYmItZjg0Mi00ZTQwLThjMWItNWM3MTMxMzVjZmVjXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "Private detective Benoit Blanc investigates the suspicious death of a celebrated crime novelist inside his eccentric estate."
  },
  {
    imdbID: "tt0211915",
    tmdbId: 194,
    title: "Amélie",
    year: "2001",
    primaryGenre: "Comedy",
    genre: "Comedy, Romance",
    director: "Jean-Pierre Jeunet",
    runtime: "122 min",
    imdbRating: "8.3",
    poster: "https://m.media-amazon.com/images/M/MV5BOTNmYzY0MWQtZGZmNy00Y2Y4LWFmMDQtMTZjYTdiYzEwZGQ2XkEyXkFqcGc@._V1_SX300.jpg",
    plot: "A whimsical Parisian waitress decides to secretly orchestrate small acts of joy in the lives of everyone around her."
  },

  // Horror
  {
    imdbID: "tt0078748",
    tmdbId: 348,
    title: "Alien",
    year: "1979",
    primaryGenre: "Horror",
    genre: "Horror, Sci-Fi",
    director: "Ridley Scott",
    runtime: "117 min",
    imdbRating: "8.5",
    poster: "https://m.media-amazon.com/images/M/MV5BN2NhMDk2MmEtZDQzOC00MmY5LThhYzAtMDdjZGFjOGZjMjdjXkEyXkFqcGc@._V1_QL75_UX380_CR0,6,380,562_.jpg",
    plot: "The crew of the commercial towing vessel Nostromo encounters a relentless biomechanical predator in deep space."
  },
  {
    imdbID: "tt5052448",
    tmdbId: 419430,
    title: "Get Out",
    year: "2017",
    primaryGenre: "Horror",
    genre: "Horror, Mystery, Thriller",
    director: "Jordan Peele",
    runtime: "104 min",
    imdbRating: "7.8",
    poster: "https://m.media-amazon.com/images/M/MV5BMjUxMDQwNjcyNl5BMl5BanBnXkFtZTgwNzcwMzc0MTI@._V1_SX300.jpg",
    plot: "A young photographer uncovers a chilling conspiracy during a weekend visit to his girlfriend's family estate."
  },
  {
    imdbID: "tt0102926",
    tmdbId: 274,
    title: "The Silence of the Lambs",
    year: "1991",
    primaryGenre: "Horror",
    genre: "Crime, Drama, Thriller",
    director: "Jonathan Demme",
    runtime: "118 min",
    imdbRating: "8.6",
    poster: "https://m.media-amazon.com/images/M/MV5BNDdhOGJhYzctYzYwZC00YmI2LWI0MjctYjg4ODdlMDExYjBlXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg",
    plot: "An FBI trainee seeks insights from imprisoned psychiatrist Hannibal Lecter to catch another sadistic serial killer."
  },

  // Romance
  {
    imdbID: "tt3783958",
    tmdbId: 313369,
    title: "La La Land",
    year: "2016",
    primaryGenre: "Romance",
    genre: "Comedy, Drama, Romance",
    director: "Damien Chazelle",
    runtime: "128 min",
    imdbRating: "8.0",
    poster: "https://m.media-amazon.com/images/M/MV5BMDllYjliOTUtMDJjZC00ODIzLWJmNGMtOWI2NzQxMjA2NzdlXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "A jazz pianist and an aspiring actress fall in love while chasing artistic ambitions across modern Los Angeles."
  },
  {
    imdbID: "tt13238346",
    tmdbId: 666277,
    title: "Past Lives",
    year: "2023",
    primaryGenre: "Romance",
    genre: "Drama, Romance",
    director: "Celine Song",
    runtime: "106 min",
    imdbRating: "7.8",
    poster: "https://m.media-amazon.com/images/M/MV5BYjQyMTNhNjUtN2VmYy00NWRhLTkwOTctMGVmNTBmNDIxYjZhXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "Two deeply connected childhood friends reunite in New York after twenty years apart to confront destiny and choices."
  },
  {
    imdbID: "tt0118694",
    tmdbId: 843,
    title: "In the Mood for Love",
    year: "2000",
    primaryGenre: "Romance",
    genre: "Drama, Romance",
    director: "Wong Kar-wai",
    runtime: "98 min",
    imdbRating: "8.1",
    poster: "https://m.media-amazon.com/images/M/MV5BN2Q4NjllMDgtOTk2Zi00YzM1LWJmOTMtNmRiZDgyZGJmMjQzXkEyXkFqcGc@._V1_SX300.jpg",
    plot: "In 1962 Hong Kong, two neighbors form an intimate, restrained bond after suspecting their spouses of infidelity."
  }
];

function normalizeLiveDeckMovie(raw = {}) {
  const firstGenre = String(raw.genre || "Drama")
    .split(/[,•|/]/)
    .map((g) => g.trim())
    .find(Boolean) || "Drama";
  return {
    ...raw,
    imdbID: raw.imdbID || raw.id || (raw.tmdbId ? `tmdb_${raw.tmdbId}` : ""),
    primaryGenre: raw.primaryGenre || firstGenre,
    poster: raw.poster || raw.Poster || ""
  };
}

function interleaveByGenre(items = [], limit = 30) {
  const buckets = new Map();
  for (const item of items) {
    const genre = item.primaryGenre || "Drama";
    if (!buckets.has(genre)) buckets.set(genre, []);
    buckets.get(genre).push(item);
  }

  const ordered = [];
  const queues = [...buckets.values()];
  while (ordered.length < limit) {
    let pushedInRound = false;
    for (const queue of queues) {
      if (queue.length > 0 && ordered.length < limit) {
        ordered.push(queue.shift());
        pushedInRound = true;
      }
    }
    if (!pushedInRound) break;
  }
  return ordered;
}

/**
 * Builds an interleaved multi-genre deck excluding already-watched films and topping up from livePool.
 */
export function buildTasteDeck({
  watched = [],
  watchlist = [],
  livePool = [],
  deckSize = 30
} = {}) {
  const watchedSet = buildSeenCollisionSet(watched, []);
  const watchlistSet = buildSeenCollisionSet([], watchlist);
  const placed = new Set();
  const candidates = [];

  const tryPush = (raw) => {
    const item = normalizeLiveDeckMovie(raw);
    if (!item.imdbID || !item.title || !item.poster || item.poster === "N/A") return;
    const keys = [...buildSeenCollisionSet([item], [])];
    if (keys.some((k) => watchedSet.has(k) || placed.has(k))) return;
    keys.forEach((k) => placed.add(k));
    candidates.push({
      ...item,
      inWatchlist: keys.some((k) => watchlistSet.has(k))
    });
  };

  CORE_TASTE_DECK.forEach(tryPush);
  (livePool || []).forEach(tryPush);

  return interleaveByGenre(candidates, deckSize);
}

/**
 * Shows first-visit taste onboarding only when vault has < 3 rated films and user has not dismissed.
 */
export function shouldAutoShowTasteOnboarding({
  watchedCount = 0,
  dismissedFlag = null
} = {}) {
  return Number(watchedCount) < 3 && dismissedFlag !== "true";
}
