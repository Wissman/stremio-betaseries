import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Helpers for BetaSeries API requests
async function makeBetaSeriesRequest(endpoint, method, headers, params = {}, body = null) {
  const url = new URL(`https://api.betaseries.com${endpoint}`);
  url.searchParams.append('v', '3.0');
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      url.searchParams.append(key, val);
    }
  }

  const options = {
    method: method,
    headers: {
      'X-BetaSeries-Version': '3.0',
      ...headers
    }
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  console.log(`[BetaSeries API] Requesting ${method} ${url.pathname}${url.search}`);
  const response = await fetch(url.toString(), options);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[BetaSeries API] Error ${response.status}: ${errorText}`);
    throw new Error(`BetaSeries API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// 1. POST /api/login: Authenticate user using legacy login/password to get token
app.post('/api/login', async (req, res) => {
  const { apiKey, username, password } = req.body;

  if (!apiKey || !username || !password) {
    return res.status(400).json({ error: 'Veuillez fournir la clé API, l\'identifiant et le mot de passe.' });
  }

  try {
    // Generate MD5 hash of the password as required by BetaSeries members/auth
    const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

    // Call /members/auth
    const url = new URL('https://api.betaseries.com/members/auth');
    url.searchParams.append('v', '3.0');
    url.searchParams.append('key', apiKey);
    url.searchParams.append('login', username);
    url.searchParams.append('password', hashedPassword);

    console.log(`[Auth] Attempting login for user: ${username}`);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-BetaSeries-Version': '3.0',
        'X-BetaSeries-Key': apiKey
      }
    });

    const data = await response.json();

    if (!response.ok || (data.errors && data.errors.length > 0)) {
      const errMsg = data.errors?.[0]?.text || 'Échec de l\'authentification.';
      console.error(`[Auth] Error for ${username}: ${errMsg}`);
      return res.status(response.status || 400).json({ error: errMsg });
    }

    const token = data.token;
    if (!token) {
      return res.status(500).json({ error: 'Token non reçu de BetaSeries.' });
    }

    console.log(`[Auth] Login successful for user: ${username}`);
    return res.json({ token, login: data.user?.login || username });
  } catch (err) {
    console.error('[Auth] Internal error:', err);
    return res.status(500).json({ error: 'Erreur interne lors de l\'authentification.' });
  }
});

// 2. GET /:apiKey/:token/manifest.json: Custom manifest for user
app.get('/:apiKey/:token/manifest.json', (req, res) => {
  const { apiKey, token } = req.params;

  const manifest = {
    id: 'org.betaseries.stremio',
    version: '1.0.0',
    name: 'BetaSeries Tracker',
    description: 'Affiche votre liste "À voir" BetaSeries et marque automatiquement les films/épisodes comme vus lors de la lecture.',
    resources: [
      'catalog',
      'meta',
      'stream'
    ],
    types: ['movie', 'series'],
    catalogs: [
      {
        id: 'betaseries-planning',
        type: 'series',
        name: 'BetaSeries : Séries à voir',
        extra: [
          { name: 'search', isRequired: false }
        ]
      },
      {
        id: 'betaseries-watchlist-movies',
        type: 'movie',
        name: 'BetaSeries : Films à voir',
        extra: [
          { name: 'search', isRequired: false }
        ]
      }
    ],
    idPrefixes: ['tt']
  };

  res.json(manifest);
});

// 3. GET /:apiKey/:token/catalog/series/betaseries-planning.json: Catalog for series in progress (maintaining BetaSeries chronological order)
app.get('/:apiKey/:token/catalog/series/betaseries-planning.json', async (req, res) => {
  const { apiKey, token } = req.params;

  try {
    const data = await makeBetaSeriesRequest('/episodes/list', 'GET', {
      'X-BetaSeries-Key': apiKey,
      'Authorization': `Bearer ${token}`
    }, {
      limit: 100,
      released: 1 // Only show already released episodes
    });

    const episodes = data.episodes || [];
    const showMap = new Map();

    for (const ep of episodes) {
      const show = ep.show;
      if (!show || !show.imdb_id || !show.imdb_id.startsWith('tt')) continue;

      if (!showMap.has(show.id)) {
        showMap.set(show.id, {
          id: show.imdb_id,
          type: 'series',
          name: show.title,
          poster: show.images?.poster || show.images?.show || '',
          description: show.description || `Prochain épisode à voir : Saison ${ep.season} Épisode ${ep.episode} - "${ep.title}"`
        });
      }
    }

    const metas = Array.from(showMap.values());
    console.log(`[Catalog] Returned ${metas.length} series in original planning order for user`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog] Series error:', err);
    res.json({ metas: [] });
  }
});

// 4. GET /:apiKey/:token/catalog/movie/betaseries-watchlist-movies.json: Catalog for movies to watch
app.get('/:apiKey/:token/catalog/movie/betaseries-watchlist-movies.json', async (req, res) => {
  const { apiKey, token } = req.params;

  try {
    const data = await makeBetaSeriesRequest('/movies/member', 'GET', {
      'X-BetaSeries-Key': apiKey,
      'Authorization': `Bearer ${token}`
    }, {
      state: 0 // Only movies to watch (state = 0)
    });

    const movies = data.movies || [];
    const metas = movies.map(m => {
      const movie = m.movie || m;
      if (!movie || !movie.imdb_id || !movie.imdb_id.startsWith('tt')) return null;

      return {
        id: movie.imdb_id,
        type: 'movie',
        name: movie.title,
        poster: movie.images?.poster || '',
        description: movie.description || movie.synopsis || 'Aucun synopsis disponible.'
      };
    }).filter(Boolean);

    console.log(`[Catalog] Returned ${metas.length} movies in watchlist for user`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog] Movie error:', err);
    res.json({ metas: [] });
  }
});

// 4.5. GET /:apiKey/:token/meta/:type/:id.json: Meta enricher with BetaSeries watched status
app.get('/:apiKey/:token/meta/:type/:id.json', async (req, res) => {
  const { apiKey, token, type, id } = req.params;
  console.log(`[Meta] Requesting metadata for type: ${type}, id: ${id}`);

  try {
    // Fetch official metadata from Cinemeta
    const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`;
    const response = await fetch(cinemetaUrl);
    const data = await response.json();

    if (!data.meta) {
      return res.json(data);
    }

    const meta = data.meta;
    const authHeaders = {
      'X-BetaSeries-Key': apiKey,
      'Authorization': `Bearer ${token}`
    };

    if (type === 'series' && meta.videos && meta.videos.length > 0) {
      // Find show on BetaSeries using the IMDB ID
      const showData = await makeBetaSeriesRequest('/shows/display', 'GET', authHeaders, {
        imdb_id: id
      }).catch(() => null);

      const show = showData?.show;
      if (show && show.id) {
        // Fetch episodes list with user watched status
        const epsData = await makeBetaSeriesRequest('/shows/episodes', 'GET', authHeaders, {
          id: show.id
        }).catch(() => null);

        const betaEpisodes = epsData?.episodes || [];

        // Modify episode titles to show watched/unwatched status
        meta.videos = meta.videos.map(video => {
          const matchingEp = betaEpisodes.find(
            e => e.season === video.season && e.episode === video.number
          );

          if (matchingEp) {
            const isSeen = matchingEp.user?.seen;
            const prefix = isSeen ? '🟢 ' : '🔴 ';
            return {
              ...video,
              name: `${prefix}${video.name}`
            };
          }
          return video;
        });
      }
    } else if (type === 'movie') {
      const movieData = await makeBetaSeriesRequest('/movies/movie', 'GET', authHeaders, {
        imdb_id: id
      }).catch(() => null);

      const movie = movieData?.movie;
      if (movie && movie.user) {
        const isSeen = movie.user.state === 1;
        const prefix = isSeen ? '🟢 ' : '🔴 ';
        meta.name = `${prefix}${meta.name}`;
      }
    }

    res.json({ meta });
  } catch (err) {
    console.error('[Meta] Enrich error:', err);
    res.json({ meta: null });
  }
});

// 5. GET /:apiKey/:token/stream/:type/:id.json: Stream scrobbler/tracker hook
app.get('/:apiKey/:token/stream/:type/:id.json', async (req, res) => {
  const { apiKey, token, type, id } = req.params;
  const decodedId = decodeURIComponent(id); // Can contain colons like tt12345:1:1

  console.log(`[Scrobbler] Received stream request for type: ${type}, id: ${decodedId}`);

  // Return empty streams array immediately so Stremio can look for streams in other addons
  res.json({ streams: [] });

  // Handle scrobbling asynchronously so we do not block Stremio's stream search
  (async () => {
    try {
      const authHeaders = {
        'X-BetaSeries-Key': apiKey,
        'Authorization': `Bearer ${token}`
      };

      if (type === 'movie') {
        // Find movie on BetaSeries using IMDB ID
        console.log(`[Scrobbler] Finding movie: ${decodedId}`);
        const movieData = await makeBetaSeriesRequest('/movies/movie', 'GET', authHeaders, {
          imdb_id: decodedId
        });

        const movie = movieData.movie;
        if (movie && movie.id) {
          console.log(`[Scrobbler] Found movie "${movie.title}" (BetaSeries ID: ${movie.id}). Marking as watched.`);
          // Mark as watched (state = 1)
          await makeBetaSeriesRequest('/movies/movie', 'POST', authHeaders, {}, {
            id: movie.id,
            state: 1
          });
          console.log(`[Scrobbler] Movie "${movie.title}" successfully marked as watched.`);
        } else {
          console.warn(`[Scrobbler] Movie with IMDB ID ${decodedId} not found on BetaSeries.`);
        }
      } else if (type === 'series') {
        // Parsing IMDB ID, season and episode (e.g. tt1234567:1:5)
        const parts = decodedId.split(':');
        if (parts.length >= 3) {
          const imdbId = parts[0];
          const season = parts[1];
          const episodeNum = parts[2];

          console.log(`[Scrobbler] Finding show with IMDB ID: ${imdbId}`);
          // Find show details to get show.id
          const showData = await makeBetaSeriesRequest('/shows/display', 'GET', authHeaders, {
            imdb_id: imdbId
          });

          const show = showData.show;
          if (show && show.id) {
            console.log(`[Scrobbler] Found show "${show.title}" (BetaSeries ID: ${show.id}). Fetching episodes list.`);
            // Fetch show episodes list to find the episode ID
            const epsData = await makeBetaSeriesRequest('/shows/episodes', 'GET', authHeaders, {
              id: show.id
            });

            const episodes = epsData.episodes || [];
            const matchingEp = episodes.find(e => e.season === Number(season) && e.episode === Number(episodeNum));

            if (matchingEp && matchingEp.id) {
              console.log(`[Scrobbler] Found episode "${matchingEp.title}" (ID: ${matchingEp.id}, S${season}E${episodeNum}). Marking as watched.`);
              // Mark episode as watched
              await makeBetaSeriesRequest('/episodes/watched', 'POST', authHeaders, {}, {
                id: matchingEp.id
              });
              console.log(`[Scrobbler] Episode S${season}E${episodeNum} successfully marked as watched.`);
            } else {
              console.warn(`[Scrobbler] Episode S${season}E${episodeNum} not found in show "${show.title}".`);
            }
          } else {
            console.warn(`[Scrobbler] Show with IMDB ID ${imdbId} not found on BetaSeries.`);
          }
        } else {
          console.error(`[Scrobbler] Invalid series ID format: ${decodedId}`);
        }
      }
    } catch (err) {
      console.error('[Scrobbler] Failed to mark as watched:', err);
    }
  })();
});

// Fallback to serve index.html for undefined routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express server if not in serverless environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[Server] Stremio-BetaSeries addon server running on port ${PORT}`);
    console.log(`[Server] Access the configuration page at http://localhost:${PORT}`);
  });
}

export default app;
