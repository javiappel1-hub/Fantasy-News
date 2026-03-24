# Fantasy Intel — Deploy en Vercel

## Pasos para deployar (todo desde el browser, sin terminal)

### 1. Crear cuenta en GitHub
- Entrá a github.com y creá una cuenta si no tenés

### 2. Crear repositorio
- En GitHub hacé click en "New repository"
- Nombre: `fantasy-intel`
- Público, sin README
- Click en "Create repository"

### 3. Subir los archivos
- En tu nuevo repo, click en "uploading an existing file"
- Subí estos archivos manteniendo la estructura de carpetas:
  ```
  vercel.json
  package.json
  api/news.js
  api/extract.js
  public/index.html
  ```

### 4. Conectar con Vercel
- Entrá a vercel.com
- "Sign up" con tu cuenta de GitHub
- Click en "New Project"
- Importá el repo `fantasy-intel`
- Click en "Deploy"

### 5. Configurar variables de entorno
En Vercel, antes de hacer deploy:
- Click en "Environment Variables"
- Agregá:
  - `ANTHROPIC_API_KEY` = tu API key de Anthropic (platform.anthropic.com)
  - `NEWS_API_KEY` = tu API key de newsapi.org (gratis, registrate en newsapi.org)

### 6. Listo
- Vercel te da una URL tipo `fantasy-intel-xxx.vercel.app`
- Entrá y probalo

## Sin NewsAPI (solo Claude)
Si no querés registrarte en NewsAPI, la app funciona igual
usando solo Claude para generar las noticias.
Solo agregá `ANTHROPIC_API_KEY` y listo.

## Velocidad esperada
- Con NewsAPI: noticias reales en ~1-2 segundos por jugador
- Sin NewsAPI: noticias generadas por IA en ~2-3 segundos por jugador
- Las noticias se precargan todas en paralelo al cargar el equipo
- Al tocar un jugador → aparecen instantáneamente si ya están precargadas
