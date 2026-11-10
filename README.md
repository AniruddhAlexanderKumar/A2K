# A2K Personal Portfolio

A responsive personal portfolio for Aniruddh Alexander Kumar, built with semantic HTML, CSS and JavaScript.

The interactive “Places That Shaped Me” map uses MapLibre GL JS and OpenFreeMap's Positron basemap. It requires an internet connection but no API key or environment-variable configuration. Edit the central `locations` array in `portfolio.js` to update the timeline, coordinates, descriptions or optional photo URLs.

The supplied portrait is used in the homepage hero, and the supplied kayaking photo accompanies the Adventures transition. Football and taekwondo highlight videos are stored under `assets/football/` and `assets/taekwondo/`. The research paper is served locally with its PDF.js viewer assets.

## Preview locally

From the project root:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Files

- `index.html` — portfolio structure and content
- `portfolio.css` — white visual theme, responsive layout and map styling
- `portfolio.js` — navigation, reveal animations and interactive map
- `research-viewer.js` — embedded PDF reader controls, rendering and search
- `assets/portrait-hero.png` — homepage portrait
- `assets/adventure-transition.webp` — supplied kayaking photo used in the Adventures transition
- `assets/solution-velocity-logo.png` — supplied Solution Velocity logo
- `assets/research/` — research paper PDF
- `assets/vendor/pdfjs/` — self-hosted PDF.js and reader resources
- `assets/football/` and `assets/taekwondo/` — sports highlight videos
- `football.html` and `taekwondo.html` — sports highlight pages
