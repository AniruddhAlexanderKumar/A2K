# A2K Personal Portfolio

A responsive personal portfolio for Aniruddh Alexander Kumar, built with semantic HTML, CSS and JavaScript.

The interactive “Places That Shaped Me” map uses MapLibre GL JS and OpenFreeMap's Positron basemap. It requires an internet connection but no API key or environment-variable configuration. Edit the central `locations` array in `portfolio.js` to update the timeline, coordinates, descriptions or optional photo URLs.

The supplied portrait is used in the homepage hero, and the supplied kayaking photo accompanies the Adventures transition. Football and taekwondo highlight videos are stored under `assets/football/` and `assets/taekwondo/`. The Projects & research card links to the standalone paper at `/research/aerospace-supply-chain/`. Its self-hosted PDF.js reader, direct-open link and download all use the same original PDF in `assets/research/`. The links also work without JavaScript.

## Solution Velocity

The same repository also contains **Solution Velocity**, an AI-powered Product Development
Lifecycle Management platform built around a Journey-first architecture. It lives in
[`solution-velocity/`](solution-velocity/README.md) and is independent of this portfolio site.

```bash
cd solution-velocity
npm install
npm run dev
```

See [`solution-velocity/README.md`](solution-velocity/README.md) for the architecture, and
[`solution-velocity/docs/REDESIGN.md`](solution-velocity/docs/REDESIGN.md) for the design
decisions behind the three-destination structure.

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
- `research/aerospace-supply-chain/index.html` — standalone paper at `/research/aerospace-supply-chain/`, linked from Projects & research
- `research/paper.css` — publication layout and responsive reader styling
- `research-viewer.js` — PDF reader controls, rendering and search; loaded only on the research page
- `assets/portrait-hero.png` — homepage portrait
- `assets/adventure-transition.webp` — supplied kayaking photo used in the Adventures transition
- `assets/solution-velocity-logo.png` — supplied Solution Velocity logo
- `assets/research/` — research paper PDF
- `assets/vendor/pdfjs/` — self-hosted PDF.js and reader resources
- `assets/football/` and `assets/taekwondo/` — sports highlight videos
- `football.html` and `taekwondo.html` — sports highlight pages
